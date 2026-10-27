// Review pages: one entry per staging URL the client should review.
//   GET    /api/pages            list (with comment/status counts)
//   POST   /api/pages            create { name, url, client, keywords }
//   GET    /api/pages/:id        one page
//   PATCH  /api/pages/:id        update fields
//   DELETE /api/pages/:id        delete page + its comments and statuses
import { store, listJSON, newId, json, error, readBody, isAdmin, clip } from "./_lib/store.mjs";

const pageKey = (id) => `pages/${id}`;

function cleanFields(body) {
  const out = {};
  if (body.name !== undefined) out.name = clip(body.name, 200);
  if (body.client !== undefined) out.client = clip(body.client, 200);
  if (body.keywords !== undefined) out.keywords = clip(body.keywords, 1000);
  if (body.url !== undefined) {
    let url;
    try {
      url = new URL(body.url);
    } catch {
      throw new Error("Enter a full staging URL, e.g. https://site.webflow.io/about");
    }
    if (!/^https?:$/.test(url.protocol)) throw new Error("URL must be http(s)");
    out.url = url.toString();
  }
  return out;
}

async function withCounts(page) {
  const [comments, status] = await Promise.all([
    listJSON(`comments/${page.id}/`),
    store().get(`status/${page.id}`),
  ]);
  const sections = Object.values(status || {});
  return {
    ...page,
    counts: {
      comments: comments.length,
      open: comments.filter((c) => !c.resolved).length,
      approved: sections.filter((s) => s.status === "approved").length,
      needsEdits: sections.filter((s) => s.status === "needs_edits").length,
    },
  };
}

export default async (req, context) => {
  const s = store();
  const id = context.params?.id;

  if (req.method === "GET" && !id) {
    const pages = await listJSON("pages/");
    pages.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(await Promise.all(pages.map(withCounts)));
  }

  if (req.method === "GET") {
    const page = await s.get(pageKey(id));
    return page ? json(page) : error(404, "Page not found");
  }

  if (!isAdmin(req)) return error(401, "Admin token required");

  if (req.method === "POST" && !id) {
    const body = await readBody(req);
    let fields;
    try {
      fields = cleanFields(body);
    } catch (e) {
      return error(400, e.message);
    }
    if (!fields.url) return error(400, "Staging URL is required");
    const page = {
      id: newId(),
      name: fields.name || new URL(fields.url).pathname,
      client: fields.client || "",
      keywords: fields.keywords || "",
      url: fields.url,
      createdAt: new Date().toISOString(),
    };
    await s.setJSON(pageKey(page.id), page);
    return json(page, 201);
  }

  if (req.method === "PATCH" && id) {
    const page = await s.get(pageKey(id));
    if (!page) return error(404, "Page not found");
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

  if (req.method === "DELETE" && id) {
    const { blobs } = await s.list({ prefix: `comments/${id}/` });
    await Promise.all(blobs.map((b) => s.delete(b.key)));
    await s.delete(`status/${id}`);
    await s.delete(pageKey(id));
    return json({ ok: true });
  }

  return error(405, "Method not allowed");
};

export const config = { path: ["/api/pages", "/api/pages/:id"] };
