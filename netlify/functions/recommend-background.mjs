// Recommended SEO/AEO copy for a highlighted section, written then scored, in the background.
//   POST /.netlify/functions/recommend-background
//        { pageId, sectionKey, label, items: [{ tag, text }] }   (team only)
//        { pageId, sectionKey, scoreOnly: true }                  re-score the existing copy
// Netlify answers 202 straight away (background function, up to 15 min). Progress is written
// to flags/<pageId>[sectionKey].recommendation, which the overlay polls:
//   status "writing" -> "scoring" (copy ready) -> "ready" (scores ready) | "error"
import Anthropic from "@anthropic-ai/sdk";
import { store, readBody, isAdmin, clip, handle, json } from "./_lib/store.mjs";
import { RUBRIC_PROMPT, RUBRIC_SCHEMA, RUBRIC_OUTPUT_NOTE, reconcile } from "./_lib/rubric.mjs";

const MODEL = "claude-opus-5-5";

const WRITER = `You are Blend360's SEO and AEO (answer-engine optimization) copywriter.
You rewrite the copy of one section of a web page so it ranks in search and gets quoted by AI answer engines,
while staying true to Blend360's brand: professional, clear, confident, practical enterprise B2B voice.

Your copy will be scored by Blend360's Content Dashboard Rubric (SEO, AEO, Brand Voice, Content Quality). Write to it:
- Put the primary keyword in the section's main heading and early in its first paragraph when natural.
- Where a heading can naturally be a question people ask, phrase it as a question and make the next sentence answer it directly.
- Use plain, active sentences; define acronyms; spell the company "Blend360".
- Never invent statistics, client names, awards, product names or claims. Keep every number and fact from the current copy unless the team note says otherwise.
- Keep each element's role and rough length: headings short; stat labels a few words; buttons 2-4 words, action-led; paragraphs 1-3 sentences unless the original is longer.

Return exactly one recommended text per input element, in the same order (same index).
Choose 2-5 SEO keywords (short head terms) and 2-5 AEO long-tail phrases (natural question-style or conversational phrases).
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

const client = new Anthropic();

async function ask(system, content, schema) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
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

  try {
    let out, longtail, primary;
    if (scoreOnly) {
      out = existing.items;
      longtail = existing.aeo_longtail || [];
      primary = existing.primary_keyword || "";
    } else {
      // 1) Write the recommended copy.
      const brief = [
        `Page: ${page.name}${project?.client ? ` (client: ${project.client})` : ""}`,
        `URL: ${page.url}`,
        `Target keywords from the team: ${keywords || "none given; choose them from the page topic"}`,
        `Section: ${clip(body.label, 200) || "unnamed"}`,
        `Team note: ${clip(body.note, 300) || "none"}`,
        `Current copy, one element per line as [index] <tag> text:`,
        ...items.map((it, i) => `[${i}] <${it.tag}> ${it.original}`),
      ].join("\n");
      const written = await ask(WRITER, brief, WRITER_SCHEMA);
      const byIndex = new Map((written.items || []).map((x) => [x.index, x.recommended]));
      out = items.map((it, i) => ({ ...it, recommended: clip(byIndex.get(i) ?? it.original, 1200) }));
      const all = out.map((x) => x.recommended.toLowerCase()).join(" \n ");
      // Only keep phrases that really appear, so every highlight is real.
      const used = (list) => [...new Set((list || []).map((k) => String(k).trim()).filter((k) => k && all.includes(k.toLowerCase())))].slice(0, 8);
      const seo = used(written.seo_keywords);
      longtail = used(written.aeo_longtail);
      primary = written.primary_keyword || "";
      if (!(await update(pageId, key, { status: "scoring", items: out, primary_keyword: clip(written.primary_keyword, 120), seo_keywords: seo, aeo_longtail: longtail, rationale: clip(written.rationale, 600) }))) {
        return json({ ok: false });
      }
    }

    // 2) Score it with the Blend360 rubric, as an independent evaluator.
    const article = [
      `Content type: Web page section (not a full article). Criteria that need article-only inputs below may be unavailable.`,
      `Section title: ${clip(body.label, 200)}`,
      `Primary keyword: ${primary || "not specified"}`,
      `Recommended long-tail keywords: ${longtail.join("; ") || "none"}`,
      `Target audience: enterprise decision-makers evaluating Blend360 (not otherwise specified)`,
      `Meta title: not provided`,
      `Meta description: not provided`,
      `URL slug: ${new URL(page.url).pathname}`,
      `Cover image: not provided`,
      ``,
      `ARTICLE (HTML):`,
      asHtml(out, "recommended"),
    ].join("\n");
    const evaluation = reconcile(await ask(RUBRIC_PROMPT, `${article}\n\n${RUBRIC_OUTPUT_NOTE}`, RUBRIC_SCHEMA));
    await update(pageId, key, {
      status: "ready",
      evaluation: {
        seo: evaluation.seo.score,
        aeo: evaluation.aeo.score,
        brand_voice: evaluation.brand_voice.score,
        content_quality: evaluation.content_quality.score,
        overall: evaluation.overall_assessment.overall_score,
        editorial_status: clip(evaluation.overall_assessment.editorial_status, 200),
        summary: clip(evaluation.overall_assessment.summary, 1000),
        improvements: (evaluation.overall_assessment.priority_improvements || []).slice(0, 5).map((x) => clip(x, 300)),
        rubric: evaluation.rubric_criteria,
      },
    });
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
    await update(pageId, key, done ? { status: "ready", evaluation: null, error: `Score unavailable: ${message}` } : { status: "error", error: message });
  }
  return json({ ok: true });
});
