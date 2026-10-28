// Sections the team has flagged for client review ("needs your review", "updated copy").
//   GET  /api/flags?page=ID   -> { flags: { [sectionKey]: { label, note, at } }, admin }
//   POST /api/flags           { pageId, sectionKey, label, note, flagged, anchor?, members? }   (admin)
//   (anchor = { selector, text, tag } for areas the team picked by hand rather than detected sections)
// Re-flagging a section clears the client's earlier verdict so it goes back to "waiting".
import { store, json, error, readBody, isAdmin, clip, stripTags, handle } from "./_lib/store.mjs";
import { sessionUser } from "./_lib/auth.mjs";

export default handle(async (req) => {
  const s = store();
  if (req.method === "GET") {
    const pageId = new URL(req.url).searchParams.get("page");
    if (!pageId) return error(400, "page is required");
    const admin = isAdmin(req);
    const flags = (await s.get(`flags/${pageId}`)) || {};
    // Suggestions written before tags were stripped on save can still start with "<div>".
    for (const f of Object.values(flags)) {
      for (const it of f.recommendation?.items || []) it.recommended = stripTags(it.recommended);
    }
    return json({ flags, admin, user: admin ? sessionUser(req) : null });
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
    // Keep generated copy suggestions when a section is re-flagged ("Ask again").
    if (prev?.recommendation) flags[sectionKey].recommendation = prev.recommendation;
    // Hand-picked areas carry an anchor (like comments) so the overlay can find the element again.
    const a = body.anchor || prev?.anchor;
    const cleanAnchor = (x) => ({ selector: clip(x?.selector, 1000), text: clip(x?.text, 300), tag: clip(x?.tag, 20) });
    if (a) flags[sectionKey].anchor = cleanAnchor(a);
    // A dragged group of cards: each card is anchored so the highlight can wrap them at any screen size.
    const members = Array.isArray(body.members) ? body.members : prev?.members;
    if (members?.length) flags[sectionKey].members = members.slice(0, 40).map(cleanAnchor);
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
