// Pinned comments on a review page.
//   GET    /api/comments?page=ID         list for a page
//   POST   /api/comments                 create { pageId, author, body, anchor, sectionKey, copy }
//   PATCH  /api/comments/:id             { pageId, resolved?, reply?: {author, body}, body? }
//   DELETE /api/comments/:id?page=ID    the comment's author (same browser) or the team
// Each browser sends a random x-reviewer-id. It's stored privately on the comments it creates,
// never returned; responses only say whether a comment is "mine".
import { store, listJSON, newId, json, error, readBody, clip, handle, isAdmin } from "./_lib/store.mjs";

const key = (pageId, id) => `comments/${pageId}/${id}`;
const reviewerId = (req) => clip(req.headers.get("x-reviewer-id") || "", 64);

function forViewer(comment, req) {
  const { authorKey, ...rest } = comment;
  const me = reviewerId(req);
  return { ...rest, mine: Boolean(authorKey && me && authorKey === me) };
}

function cleanAnchor(a = {}) {
  const num = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  return {
    selector: clip(a.selector, 1000),
    xPct: num(a.xPct),
    yPct: num(a.yPct),
    text: clip(a.text, 300),
    tag: clip(a.tag, 20),
  };
}

function cleanCopy(c) {
  if (!c || typeof c !== "object") return null;
  return {
    current: clip(c.current, 4000),
    proposed: clip(c.proposed, 4000),
    source: c.source === "ai" ? "ai" : "reviewer",
    rationale: clip(c.rationale, 1000),
  };
}

export default handle(async (req, context) => {
  const s = store();
  const url = new URL(req.url);
  const id = context.params?.id;

  if (req.method === "GET") {
    const pageId = url.searchParams.get("page");
    if (!pageId) return error(400, "page is required");
    const comments = await listJSON(`comments/${pageId}/`);
    comments.sort((a, b) => a.n - b.n);
    return json(comments.map((c) => forViewer(c, req)));
  }

  const body = req.method === "DELETE" ? {} : await readBody(req);
  const pageId = body.pageId || url.searchParams.get("page");
  if (!pageId) return error(400, "pageId is required");
  if (!(await s.get(`pages/${pageId}`))) return error(404, "Page not found");

  if (req.method === "POST" && !id) {
    const text = clip(body.body, 4000).trim();
    const copy = cleanCopy(body.copy);
    if (!text && !copy?.proposed) return error(400, "Comment is empty");
    const existing = await s.list({ prefix: `comments/${pageId}/` });
    const comment = {
      id: newId(),
      pageId,
      n: existing.blobs.length + 1,
      author: clip(body.author, 80) || "Reviewer",
      body: text,
      anchor: cleanAnchor(body.anchor),
      sectionKey: clip(body.sectionKey, 120),
      sectionLabel: clip(body.sectionLabel, 200),
      // Card of a tab / click-list switcher on a blank page (1-based), when the comment is on one.
      card: Number.isInteger(body.card) && body.card > 0 && body.card < 100 ? body.card : null,
      viewport: Number.isFinite(body.viewport) ? Math.round(body.viewport) : null,
      copy,
      resolved: false,
      replies: [],
      authorKey: reviewerId(req),
      createdAt: new Date().toISOString(),
    };
    await s.setJSON(key(pageId, comment.id), comment);
    return json(forViewer(comment, req), 201);
  }

  if (!id) return error(405, "Method not allowed");
  const comment = await s.get(key(pageId, id));
  if (!comment) return error(404, "Comment not found");

  if (req.method === "PATCH") {
    if (typeof body.resolved === "boolean") comment.resolved = body.resolved;
    if (typeof body.body === "string") comment.body = clip(body.body, 4000);
    if (body.copy !== undefined) comment.copy = cleanCopy(body.copy);
    if (body.reply?.body) {
      comment.replies.push({
        id: newId(6),
        author: clip(body.reply.author, 80) || "Reviewer",
        body: clip(body.reply.body, 4000),
        createdAt: new Date().toISOString(),
      });
    }
    comment.updatedAt = new Date().toISOString();
    await s.setJSON(key(pageId, id), comment);
    return json(forViewer(comment, req));
  }

  if (req.method === "DELETE") {
    const own = comment.authorKey && comment.authorKey === reviewerId(req);
    if (!own && !isAdmin(req)) return error(403, "You can only delete your own comments");
    await s.delete(key(pageId, id));
    return json({ ok: true });
  }

  return error(405, "Method not allowed");
});

export const config = { path: ["/api/comments", "/api/comments/:id"] };
