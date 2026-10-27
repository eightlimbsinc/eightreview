// AI copy assistant: turns a reviewer's note or draft copy into SEO-ready options.
//   POST /api/seo { pageId, note, current, tag, sectionLabel }
//   -> { interpretation, variants: [{ text, rationale }], tips }
import Anthropic from "@anthropic-ai/sdk";
import { store, json, error, readBody, clip, handle, isAdmin } from "./_lib/store.mjs";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const SYSTEM = `You are a senior SEO copywriter helping a client review copy on their staging website.
The client leaves a note on one element of the page. The note is either replacement copy they wrote, or an instruction about what the copy should say (e.g. "pls select 4: ...").
Write 3 alternative versions of the final copy for that element that:
- keep the client's meaning, facts, numbers and brand voice; never invent claims, stats or awards
- work naturally with the page's target keywords where they fit (no stuffing)
- respect the element type: H1 ~ 40-60 characters and includes the primary keyword; H2/H3 short and scannable; body copy clear, specific, 1-3 sentences unless the original is longer; stat labels a few words; buttons 2-4 words, action-led
- read at roughly a grade 8-10 level
If the note asks for a selection of items (e.g. "pick 4 of these"), return the chosen items in the format the element uses.
Variant 1 should stay closest to the client's own wording.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["interpretation", "variants", "tips"],
  properties: {
    interpretation: {
      type: "string",
      description: "One short sentence: how you read the client's note.",
    },
    variants: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "rationale"],
        properties: {
          text: { type: "string" },
          rationale: { type: "string", description: "One short sentence on the SEO/UX reasoning." },
        },
      },
    },
    tips: { type: "string", description: "Optional one-line SEO tip for this element, or empty." },
  },
};

export default handle(async (req) => {
  if (req.method !== "POST") return error(405, "Method not allowed");
  // Every call costs API credit, so only the team can run it (clients approve or edit what the team generated).
  if (!isAdmin(req)) return error(401, "Team sign-in required");
  if (!process.env.ANTHROPIC_API_KEY) return error(503, "ANTHROPIC_API_KEY is not set on the server");

  const body = await readBody(req);
  const note = clip(body.note, 3000).trim();
  if (!note) return error(400, "Write a note or some copy first");
  const page = body.pageId ? await store().get(`pages/${body.pageId}`) : null;
  if (!page) return error(404, "Page not found");
  const project = page.projectId ? await store().get(`projects/${page.projectId}`) : null;
  const keywords = page.keywords || project?.keywords;

  const prompt = [
    `Page: ${page.name}${project?.client ? ` (client: ${project.client})` : ""}`,
    `URL: ${page.url}`,
    `Target keywords: ${keywords || "none set; infer sensible ones from the page and copy"}`,
    `Section: ${clip(body.sectionLabel, 200) || "unknown"}`,
    `Element type: ${clip(body.tag, 20) || "text"}`,
    `Current copy on the page:\n"""${clip(body.current, 3000) || "(empty)"}"""`,
    `Client's note:\n"""${note}"""`,
  ].join("\n\n");

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") return error(422, "The AI declined this request");
    const text = response.content.find((b) => b.type === "text")?.text;
    const result = JSON.parse(text || "{}");
    result.variants = (result.variants || []).slice(0, 3);
    return json(result);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return error(429, "AI is busy, try again in a moment");
    if (e instanceof Anthropic.APIError) return error(502, `AI request failed (${e.status ?? "network"})`);
    if (e instanceof SyntaxError) return error(502, "AI returned an unexpected response");
    throw e;
  }
});

export const config = { path: "/api/seo" };
