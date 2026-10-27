// Projects group a client's staging pages and give them one portal link.
//   GET    /api/projects               list (admin) with page progress
//   POST   /api/projects               create { name, client, keywords } (admin)
//   GET    /api/projects/:id           project + pages with progress (public: powers the client portal)
//   PATCH  /api/projects/:id           update (admin)
//   DELETE /api/projects/:id           delete project, its pages and their feedback (admin)
import { store, listJSON, newId, json, error, readBody, isAdmin, clip } from "./_lib/store.mjs";
import { pageSummary, projectPages } from "./_lib/summary.mjs";

const key = (id) => `projects/${id}`;

function cleanFields(body) {
  const out = {};
  for (const f of ["name", "client"]) if (body[f] !== undefined) out[f] = clip(body[f], 200);
  if (body.keywords !== undefined) out.keywords = clip(body.keywords, 1000);
  if (body.password !== undefined) out.password = clip(body.password, 200);
  return out;
}

// The staging password never leaves the server; the dashboard only learns whether one is set.
function publicProject({ password, ...project }) {
  return { ...project, hasPassword: Boolean(password) };
}

async function withPages(project) {
  const pages = await Promise.all((await projectPages(project.id)).map(pageSummary));
  const done = pages.filter((p) => p.state === "approved").length;
  return { ...publicProject(project), pages, progress: { total: pages.length, approved: done } };
}

export default async (req, context) => {
  const s = store();
  const id = context.params?.id;

  if (req.method === "GET" && id) {
    const project = await s.get(key(id));
    return project ? json(await withPages(project)) : error(404, "Project not found");
  }

  if (!isAdmin(req)) return error(401, "Admin token required");

  if (req.method === "GET") {
    const projects = await listJSON("projects/");
    projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(await Promise.all(projects.map(withPages)));
  }

  if (req.method === "POST" && !id) {
    const fields = cleanFields(await readBody(req));
    if (!fields.name) return error(400, "Project name is required");
    const project = { id: newId(), client: "", keywords: "", ...fields, createdAt: new Date().toISOString() };
    await s.setJSON(key(project.id), project);
    return json(publicProject(project), 201);
  }

  const project = id && (await s.get(key(id)));
  if (!project) return error(404, "Project not found");

  if (req.method === "PATCH") {
    const fields = cleanFields(await readBody(req));
    const updated = { ...project, ...fields, updatedAt: new Date().toISOString() };
    await s.setJSON(key(id), updated);
    // A new password means old login cookies may be stale.
    if (fields.password !== undefined) {
      const hosts = new Set((await projectPages(id)).map((p) => new URL(p.url).host));
      await Promise.all([...hosts].map((h) => s.delete(`auth/${h}`)));
    }
    return json(publicProject(updated));
  }

  if (req.method === "DELETE") {
    for (const page of await projectPages(id)) {
      const { blobs } = await s.list({ prefix: `comments/${page.id}/` });
      await Promise.all(blobs.map((b) => s.delete(b.key)));
      await Promise.all([s.delete(`status/${page.id}`), s.delete(`sections/${page.id}`), s.delete(`pages/${page.id}`)]);
    }
    await s.delete(key(id));
    return json({ ok: true });
  }

  return error(405, "Method not allowed");
};

export const config = { path: ["/api/projects", "/api/projects/:id"] };
