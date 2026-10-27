// Sections the team has flagged for client review ("needs your review", "updated copy").
//   GET  /api/flags?page=ID   -> { flags: { [sectionKey]: { label, note, at } }, admin }
//   POST /api/flags           { pageId, sectionKey, label, note, flagged, anchor? }   (admin)
//   (anchor = { selector, text, tag } for areas the team picked by hand rather than detected sections)
// Re-flagging a section clears the client's earlier verdict so it goes back to "waiting".
import { store, json, error, readBody, isAdmin, clip, handle } from "./_lib/store.mjs";
import { sessionUser } from "./_lib/auth.mjs";

export default handle(async (req) => {
  const s = store();
  if (req.method === "GET") {
    const pageId = new URL(req.url).searchParams.get("page");
    if (!pageId) return error(400, "page is required");
    const admin = isAdmin(req);
    return json({ flags: (await s.get(`flags/${pageId}`)) || {}, admin, user: admin ? sessionUser(req) : null });
  }
  if (req.method !== "POST") return error(405, "Method not allowed");
  if (!isAdmin(req)) return error(401, "Team sign-in required");

  const body = await readBody(req);
  const sectionKey = clip(body.sectionKey, 120);
  if (!body.pageId || !sectionKey) return error(400, "pageId and sectionKey are required");
  if (!(await s.get(`pages/${body.pageId}`))) return error(404, "Page not found");

  const flags = (await s.get(`flags/${body.pageId}`)) || {};
  if (body.flagged) {
    const prev = flags[sectionKey];
    flags[sectionKey] = {
      label: clip(body.label, 200) || prev?.label || "",
      note: body.note !== undefined ? clip(body.note, 300) : prev?.note || "",
      at: new Date().toISOString(),
      by: sessionUser(req)?.name || "Team",
    };
    // Hand-picked areas carry an anchor (like comments) so the overlay can find the element again.
    const a = body.anchor || prev?.anchor;
    if (a) flags[sectionKey].anchor = { selector: clip(a.selector, 1000), text: clip(a.text, 300), tag: clip(a.tag, 20) };
    const status = (await s.get(`status/${body.pageId}`)) || {};
    if (status[sectionKey]) {
      delete status[sectionKey];
      await s.setJSON(`status/${body.pageId}`, status);
    }
  } else {
    delete flags[sectionKey];
  }
  await s.setJSON(`flags/${body.pageId}`, flags);
  return json({ flags, admin: true, user: sessionUser(req) });
});

export const config = { path: "/api/flags" };
