// Recommended SEO/AEO copy for a highlighted section, written then scored, in the background.
//   POST /.netlify/functions/recommend-background
//        { pageId, sectionKey, label, items: [{ tag, text }] }   (team only)
//        { pageId, sectionKey, scoreOnly: true }                  re-score the existing copy
// Netlify answers 202 straight away (background function, up to 15 min). Progress is written
// to flags/<pageId>[sectionKey].recommendation, which the overlay polls:
//   status "writing" -> "scoring" -> ("improving" -> "scoring") -> "ready" | "error"
// Pipeline: write (high effort) -> proofread -> score with the Blend360 rubric -> while the section
// score is under TARGET (4 out of 5), revise using the rubric's feedback -> proofread -> re-score
// (up to MAX_REVISIONS times), keeping whichever version scored best. A suggestion that still misses
// the target is saved with belowTarget and shown to the team only.
import Anthropic from "@anthropic-ai/sdk";
import { store, readBody, isAdmin, clip, stripTags, handle, json } from "./_lib/store.mjs";
import { RUBRIC_PROMPT, RUBRIC_SCHEMA, RUBRIC_OUTPUT_NOTE, SECTION_MODE_NOTE, ARTICLE_ONLY, reconcile, sectionScores, sectionGaps } from "./_lib/rubric.mjs";

const MODEL = "claude-opus-5-5";
const TARGET = 80; // section score out of 100, shown as 4 out of 5
const MAX_REVISIONS = 4;

const WRITER = `You are Blend360's SEO and AEO (answer-engine optimization) copywriter.
You rewrite the copy of one section of a web page so it ranks in search and gets quoted by AI answer engines,
while staying true to Blend360's brand: professional, clear, confident, practical enterprise B2B voice.

Your copy will be scored by Blend360's Content Dashboard Rubric (SEO, AEO, Brand Voice, Content Quality) in
section mode. It must reach a section score of at least 4 out of 5 (80/100); aim for full marks on every
check below. The rubric points are in brackets.
SEO
- [15] The primary keyword, or a close natural variant, is in the section's heading (when it has one).
- [10] The primary keyword or a close variant is in the first sentence of the body copy.
- [10] At least three AEO long-tail phrases are worked in naturally.
AEO
- [10] It is clear who the section is for (for example enterprise leaders or decision-makers) and what they get.
- [20] If a heading is a question, the very next sentence answers it directly. Where a heading can naturally be
  a question people ask, consider phrasing it as one.
Brand voice
- [30] Professional, clear, confident, practical enterprise B2B tone.
- [20] Consistent terms, every acronym defined on first use (for example "artificial intelligence (AI)"),
  the company spelled "Blend360", no invented product or client names, no unexplained jargon.
- [25] No unsupported claims, exaggeration or promotional superlatives ("leading", "best", "world-class",
  "unparalleled", "cutting-edge"). Say what Blend360 does, not how great it is.
- [25] Plain, active sentences, mostly under 25 words, easy for a busy executive to scan.
Content quality
- [25] Clear flow for the section's role: heading, supporting copy, then labels or a call to action where it has them.
- [25] Says enough for its job on the page, without filler.
- [25] Concrete and specific: name the actual services, capabilities, examples or numbers already in the current
  copy rather than generic phrases. Never invent statistics, client names, awards, product names or claims; keep
  every number and fact from the current copy unless the team note says otherwise.
- [25] Flawless grammar, spelling and punctuation.
Keep each element's role and rough length: headings short; stat labels a few words; buttons 2-4 words, action-led;
paragraphs 1-3 sentences unless the original is longer.

Before answering, re-read every sentence you wrote: it must be grammatical and natural when read aloud
(subject-verb agreement, no doubled or missing words, no awkward keyword insertion). Never force a keyword
in where it breaks the sentence; rephrase the sentence instead.

Return exactly one recommended text per input element, in the same order (same index).
Choose 2-5 SEO keywords (short head terms) and 3-5 AEO long-tail phrases (natural question-style or conversational phrases).
IMPORTANT: every keyword and long-tail phrase you list must appear word-for-word in your recommended copy, because the
reviewer sees them highlighted and is told not to change them. Do not list phrases you did not use.`;

const WRITER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["primary_keyword", "seo_keywords", "aeo_longtail", "items", "rationale"],
  properties: {
    primary_keyword: { type: "string" },
    seo_keywords: { type: "array", items: { type: "string" } },
    aeo_longtail: { type: "array", items: { type: "string" } },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "recommended"],
        properties: { index: { type: "integer" }, recommended: { type: "string" } },
      },
    },
    rationale: { type: "string", description: "One or two plain sentences for a non-expert on why this copy is better." },
  },
};

const PROOFREADER = `You are a meticulous copy editor for Blend360's website.
Fix only grammar, spelling, punctuation, subject-verb agreement, doubled or missing words and clearly awkward phrasing.
Do not change meaning, facts, numbers, tone or length. Keep every protected phrase exactly as written (same words,
same order); if a protected phrase makes a sentence ungrammatical, rephrase the words around it instead.
Return every element with the same index, even when nothing needed fixing.`;

const PROOF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "text"],
        properties: { index: { type: "integer" }, text: { type: "string" } },
      },
    },
  },
};

const client = new Anthropic();

async function ask(system, content, schema, effort = "medium") {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The AI declined this request");
  if (msg.stop_reason === "max_tokens") throw new Error("The AI response was cut off; try a smaller area");
  const text = msg.content.find((b) => b.type === "text")?.text;
  return JSON.parse(text || "{}");
}

// Re-read before each write so a teammate's flag change in the meantime isn't overwritten.
async function update(pageId, key, patch) {
  const s = store();
  const flags = (await s.get(`flags/${pageId}`)) || {};
  if (!flags[key]) return false; // highlight was removed while we worked
  flags[key].recommendation = { ...(flags[key].recommendation || {}), ...patch, at: new Date().toISOString() };
  await s.setJSON(`flags/${pageId}`, flags);
  return true;
}

const asHtml = (items, field) =>
  items.map((it) => `<${it.tag}>${String(it[field]).replace(/</g, "&lt;")}</${it.tag}>`).join("\n");

const TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "a", "button", "blockquote", "figcaption", "label", "td", "th", "dt", "dd", "span", "div", "strong", "em"]);

export default handle(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isAdmin(req)) return json({ error: "Team sign-in required" }, 401);
  const body = await readBody(req);
  const pageId = clip(body.pageId, 40);
  const key = clip(body.sectionKey, 120);
  const scoreOnly = Boolean(body.scoreOnly);
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 30).map((it) => ({
    tag: TAGS.has(String(it.tag).toLowerCase()) ? String(it.tag).toLowerCase() : "p",
    original: clip(it.text, 800),
  }));
  const s = store();
  const page = await s.get(`pages/${pageId}`);
  const existing = scoreOnly ? ((await s.get(`flags/${pageId}`)) || {})[key]?.recommendation : null;
  if (!page || (scoreOnly ? !existing?.items?.length : !items.length)) return json({ error: "Nothing to write" }, 400);
  const project = page.projectId ? await s.get(`projects/${page.projectId}`) : null;
  const keywords = page.keywords || project?.keywords || "";

  if (!process.env.ANTHROPIC_API_KEY) {
    await update(pageId, key, { status: "error", error: "ANTHROPIC_API_KEY is not set on the server" });
    return json({ ok: false });
  }
  await update(pageId, key, scoreOnly ? { status: "scoring", error: "", evaluation: null } : { status: "writing", error: "", items: [], evaluation: null });

  const brief = [
    `Page: ${page.name}${project?.client ? ` (client: ${project.client})` : ""}`,
    `URL: ${page.url}`,
    `Target keywords from the team: ${keywords || "none given; choose them from the page topic"}`,
    `Section: ${clip(body.label, 200) || "unnamed"}`,
    `Team note: ${clip(body.note, 300) || "none"}`,
    `Current copy, one element per line as [index] <tag> text:`,
    ...items.map((it, i) => `[${i}] <${it.tag}> ${it.original}`),
  ].join("\n");

  // Write (or revise) -> proofread -> keep only keywords that really appear in the copy.
  async function draft(prompt) {
    const written = await ask(WRITER, prompt, WRITER_SCHEMA, "high");
    const byIndex = new Map((written.items || []).map((x) => [x.index, x.recommended]));
    let out = items.map((it, i) => ({ ...it, recommended: clip(stripTags(byIndex.get(i) ?? it.original), 1200) }));
    const protectedTerms = [...(written.seo_keywords || []), ...(written.aeo_longtail || [])];
    const proof = await ask(
      PROOFREADER,
      [`Protected phrases (keep exactly): ${protectedTerms.join(" | ") || "none"}`, ``, ...out.map((x, i) => `[${i}] <${x.tag}> ${x.recommended}`)].join("\n"),
      PROOF_SCHEMA,
      "low",
    );
    const fixed = new Map((proof.items || []).map((x) => [x.index, x.text]));
    out = out.map((x, i) => ({ ...x, recommended: clip(stripTags(fixed.get(i)) || x.recommended, 1200) }));
    const all = out.map((x) => x.recommended.toLowerCase()).join(" \n ");
    // Only keep phrases that really appear, so every highlight is real.
    const used = (list) => [...new Set((list || []).map((k) => String(k).trim()).filter((k) => k && all.includes(k.toLowerCase())))].slice(0, 8);
    return {
      items: out,
      primary_keyword: clip(written.primary_keyword, 120),
      seo_keywords: used(written.seo_keywords),
      aeo_longtail: used(written.aeo_longtail),
      rationale: clip(written.rationale, 600),
    };
  }

  // Score with the Blend360 rubric (independent evaluator), plus the section-level score.
  async function score(rec) {
    const article = [
      `Content type: Web page section (not a full article). See SECTION MODE below.`,
      `Page: ${new URL(page.url).pathname}`,
      `Section title: ${clip(body.label, 200)}`,
      `Primary keyword: ${rec.primary_keyword || "not specified"}`,
      `Recommended long-tail keywords: ${(rec.aeo_longtail || []).join("; ") || "none"}`,
      `Target audience: enterprise decision-makers evaluating Blend360 (not otherwise specified)`,
      ``,
      `SECTION (HTML):`,
      asHtml(rec.items, "recommended"),
    ].join("\n");
    const ev = reconcile(await ask(RUBRIC_PROMPT, `${article}\n\n${SECTION_MODE_NOTE}\n\n${RUBRIC_OUTPUT_NOTE}`, RUBRIC_SCHEMA));
    // Article-only checks never count against a section, whatever the evaluator returned.
    for (const id of ARTICLE_ONLY) ev.rubric_criteria[id] = { ...ev.rubric_criteria[id], assessed: false, earned: 0 };
    const headings = rec.items.filter((x) => /^h[1-6]$/.test(x.tag));
    const shape = { hasHeading: headings.length > 0, hasQuestion: headings.some((x) => x.recommended.trim().endsWith("?")) };
    return {
      section: sectionScores(ev.rubric_criteria, shape),
      gaps: sectionGaps(ev.rubric_criteria, shape),
      seo: ev.seo.score,
      aeo: ev.aeo.score,
      brand_voice: ev.brand_voice.score,
      content_quality: ev.content_quality.score,
      overall: ev.overall_assessment.overall_score,
      editorial_status: clip(ev.overall_assessment.editorial_status, 200),
      summary: clip(ev.overall_assessment.summary, 1000),
      improvements: (ev.overall_assessment.priority_improvements || []).slice(0, 5).map((x) => clip(x, 300)),
      rubric: ev.rubric_criteria,
    };
  }

  try {
    let rec = scoreOnly ? existing : await draft(brief);
    if (!scoreOnly && !(await update(pageId, key, { status: "scoring", ...rec }))) return json({ ok: false });
    let evaluation = await score(rec);

    // Automatic revisions while the section scores under the bar, using the rubric's own feedback.
    for (let round = 0; !scoreOnly && round < MAX_REVISIONS && (evaluation.section.overall ?? 100) < TARGET; round++) {
      await update(pageId, key, { status: "improving" });
      const feedback = [
        brief,
        ``,
        `Your previous draft (same indexes):`,
        ...rec.items.map((x, i) => `[${i}] <${x.tag}> ${x.recommended}`),
        ``,
        `The Blend360 rubric scored this draft ${(evaluation.section.overall / 20).toFixed(1)} out of 5 for a page section; it must reach at least 4 out of 5. Fix these gaps without inventing facts:`,
        ...evaluation.gaps.map((g) => `- ${g}`),
        ...evaluation.improvements.map((g) => `- ${g}`),
        `Ignore article-only requirements (meta title/description, word count, FAQ, cover image, slug).`,
      ].join("\n");
      const revised = await draft(feedback);
      const revisedEval = await score(revised);
      if ((revisedEval.section.overall ?? 0) >= (evaluation.section.overall ?? 0)) {
        rec = revised;
        evaluation = revisedEval;
      }
    }
    const { gaps, ...stored } = evaluation;
    const belowTarget = (evaluation.section.overall ?? 100) < TARGET;
    await update(pageId, key, { status: "ready", ...(scoreOnly ? {} : rec), evaluation: stored, belowTarget });
  } catch (e) {
    console.error("[recommend]", e);
    // Keep the API's own reason (e.g. "Schema is too complex…") so the team can see what went wrong.
    const apiReason = e?.error?.error?.message || e?.error?.message;
    const message =
      e instanceof Anthropic.APIError
        ? `AI request failed (${e.status ?? "network"}${apiReason ? `: ${String(apiReason).slice(0, 200)}` : ""})`
        : e?.message || "Something went wrong";
    const flags = (await s.get(`flags/${pageId}`)) || {};
    const done = flags[key]?.recommendation?.items?.length;
    // If the copy was written but scoring failed, keep the copy and just skip the score.
    await update(pageId, key, done ? { status: "ready", evaluation: null, belowTarget: true, error: `Score unavailable: ${message}` } : { status: "error", error: message });
  }
  return json({ ok: true });
});
