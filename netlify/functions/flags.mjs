// Sections the team has flagged for client review ("needs your review", "updated copy").
//   GET  /api/flags?page=ID   -> { flags: { [sectionKey]: { label, note, at } }, admin }
//   POST /api/flags           { pageId, sectionKey, label, note, flagged }   (admin)
// Re-flagging a section clears the client's earlier verdict so it goes back to "waiting".
import { store, json, error, readBody, isAdmin, clip, handle } from "./_lib/store.mjs";

export default handle(async (req) => {
  const s = store();
  if (req.method === "GET") {
    const pageId = new URL(req.url).searchParams.get("page");
    if (!pageId) return error(400, "page is required");
    return json({ flags: (await s.get(`flags/${pageId}`)) || {}, admin: isAdmin(req) });
  }
  if (req.method !== "POST") return error(405, "Method not allowed");
  if (!isAdmin(req)) return error(401, "Admin token required");

  const body = await readBody(req);
  const sectionKey = clip(body.sectionKey, 120);
  if (!body.pageId || !sectionKey) return error(400, "pageId and sectionKey are required");
  if (!(await s.get(`pages/${body.pageId}`))) return error(404, "Page not found");

  const flags = (await s.get(`flags/${body.pageId}`)) || {};
  if (body.flagged) {
    flags[sectionKey] = { label: clip(body.label, 200), note: clip(body.note, 300), at: new Date().toISOString() };
    const status = (await s.get(`status/${body.pageId}`)) || {};
    if (status[sectionKey]) {
      delete status[sectionKey];
      await s.setJSON(`status/${body.pageId}`, status);
    }
  } else {
    delete flags[sectionKey];
  }
  await s.setJSON(`flags/${body.pageId}`, flags);
  return json({ flags, admin: true });
});

export const config = { path: "/api/flags" };
