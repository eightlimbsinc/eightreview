// Per-section review status (approved / needs edits).
//   GET  /api/status?page=ID   -> { [sectionKey]: { status, label, author, at } }
//   POST /api/status           { pageId, sectionKey, label, status, author }
import { store, json, error, readBody, clip } from "./_lib/store.mjs";

const STATUSES = new Set(["approved", "needs_edits", "pending"]);

export default async (req) => {
  const s = store();
  if (req.method === "GET") {
    const pageId = new URL(req.url).searchParams.get("page");
    if (!pageId) return error(400, "page is required");
    return json((await s.get(`status/${pageId}`)) || {});
  }
  if (req.method !== "POST") return error(405, "Method not allowed");

  const body = await readBody(req);
  const sectionKey = clip(body.sectionKey, 120);
  if (!body.pageId || !sectionKey) return error(400, "pageId and sectionKey are required");
  if (!STATUSES.has(body.status)) return error(400, "Invalid status");
  if (!(await s.get(`pages/${body.pageId}`))) return error(404, "Page not found");

  const all = (await s.get(`status/${body.pageId}`)) || {};
  if (body.status === "pending") delete all[sectionKey];
  else
    all[sectionKey] = {
      status: body.status,
      label: clip(body.label, 200),
      author: clip(body.author, 80) || "Reviewer",
      at: new Date().toISOString(),
    };
  await s.setJSON(`status/${body.pageId}`, all);
  return json(all);
};

export const config = { path: "/api/status" };
