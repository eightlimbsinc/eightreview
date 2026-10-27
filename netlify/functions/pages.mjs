// Review pages: one entry per staging URL, grouped under a project.
//   GET    /api/pages?project=ID   list (admin)
//   POST   /api/pages              create one { projectId, url, name, keywords }
//                                  or many  { projectId, pages: [{ url, name? }] } (admin)
//   GET    /api/pages/:id          one page (public; used by the overlay)
//   PATCH  /api/pages/:id          update fields (admin)
//   DELETE /api/pages/:id          delete page + its feedback (admin)
import { store, listJSON, newId, json, error, readBody, isAdmin, clip, handle } from "./_lib/store.mjs";
import { pageSummary, projectPages, nameFromUrl, urlKey } from "./_lib/summary.mjs";

const pageKey = (id) => `pages/${id}`;

function parseUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new Error(`Not a full URL: ${String(raw).slice(0, 80)}`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("URLs must be http(s)");
  url.hash = "";
  return url.toString();
}

function cleanFields(body) {
  const out = {};
  if (body.name !== undefined) out.name = clip(body.name, 200);
  if (body.keywords !== undefined) out.keywords = clip(body.keywords, 1000);
  if (body.order !== undefined && Number.isFinite(body.order)) out.order = body.order;
  // Blank wireframe: the client reviews the page's layout with the copy removed.
  if (body.blank !== undefined) out.blank = Boolean(body.blank);
  if (body.url !== undefined) out.url = parseUrl(body.url);
  return out;
}

export default handle(async (req, context) => {
  const s = store();
  const id = context.params?.id;

  if (req.method === "GET" && id) {
    const page = await s.get(pageKey(id));
    return page ? json(page) : error(404, "Page not found");
  }

  if (!isAdmin(req)) return error(401, "Team sign-in required");

  if (req.method === "GET") {
    const projectId = new URL(req.url).searchParams.get("project");
    const pages = projectId ? await projectPages(projectId) : await listJSON("pages/");
    return json(await Promise.all(pages.map(pageSummary)));
  }

  if (req.method === "POST" && !id) {
    const body = await readBody(req);
    const project = body.projectId && (await s.get(`projects/${body.projectId}`));
    if (!project) return error(400, "Pick a project first");

    const items = Array.isArray(body.pages) ? body.pages.slice(0, 200) : [body];
    const existing = await projectPages(project.id);
    const seen = new Set(existing.map((p) => urlKey(p.url)));
    const created = [];
    const skipped = [];
    let order = existing.length;
    for (const item of items) {
      let fields;
      try {
        fields = cleanFields(item);
      } catch (e) {
        if (items.length === 1) return error(400, e.message);
        skipped.push({ url: item.url, reason: e.message });
        continue;
      }
      if (!fields.url) continue;
      if (seen.has(urlKey(fields.url))) {
        skipped.push({ url: fields.url, reason: "Already in this project" });
        continue;
      }
      seen.add(urlKey(fields.url));
      const page = {
        id: newId(),
        projectId: project.id,
        name: fields.name || nameFromUrl(fields.url),
        keywords: fields.keywords || "",
        url: fields.url,
        blank: Boolean(fields.blank ?? body.blank),
        order: order++,
        createdAt: new Date().toISOString(),
      };
      await s.setJSON(pageKey(page.id), page);
      created.push(page);
    }
    if (items.length === 1 && !created.length) return error(409, skipped[0]?.reason || "Nothing to add");
    return json({ created, skipped }, 201);
  }

  const page = id && (await s.get(pageKey(id)));
  if (!page) return error(404, "Page not found");

  if (req.method === "PATCH") {
    let fields;
    try {
      fields = cleanFields(await readBody(req));
    } catch (e) {
      return error(400, e.message);
    }
    const updated = { ...page, ...fields, updatedAt: new Date().toISOString() };
    await s.setJSON(pageKey(id), updated);
    return json(updated);
  }

  if (req.method === "DELETE") {
    const { blobs } = await s.list({ prefix: `comments/${id}/` });
    await Promise.all(blobs.map((b) => s.delete(b.key)));
    await Promise.all([s.delete(`status/${id}`), s.delete(`sections/${id}`), s.delete(`flags/${id}`), s.delete(pageKey(id))]);
    return json({ ok: true });
  }

  return error(405, "Method not allowed");
});

export const config = { path: ["/api/pages", "/api/pages/:id"] };
