// Review progress for a page, shared by the dashboard and the client portal.
import { store, listJSON } from "./store.mjs";

export async function pageSummary(page) {
  const s = store();
  const [comments, status, flags] = await Promise.all([
    listJSON(`comments/${page.id}/`),
    s.get(`status/${page.id}`),
    s.get(`flags/${page.id}`),
  ]);
  // When the team has flagged sections, only those count towards the client's progress.
  const flagged = Object.keys(flags || {});
  const st = Object.entries(status || {})
    .filter(([key]) => !flagged.length || flagged.includes(key))
    .map(([, v]) => v);
  const counts = {
    comments: comments.length,
    open: comments.filter((c) => !c.resolved).length,
    approved: st.filter((x) => x.status === "approved").length,
    needsEdits: st.filter((x) => x.status === "needs_edits").length,
    // Only highlighted sections are put to the client (detected sections no longer get a bar).
    sections: flagged.length || null,
    flagged: flagged.length,
  };
  let state = "not_started";
  if (counts.needsEdits || counts.open) state = "needs_edits";
  else if (counts.sections && counts.approved >= counts.sections) state = "approved";
  else if (counts.approved || counts.comments) state = "in_progress";
  return { ...page, counts, state };
}

export async function projectPages(projectId) {
  const pages = (await listJSON("pages/")).filter((p) => p.projectId === projectId);
  pages.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt));
  return pages;
}

// "/services/data-science-v2" -> "Data Science V2"; "/" -> "Home"
export function nameFromUrl(url) {
  const path = new URL(url).pathname.replace(/\/+$/, "");
  const last = path.split("/").pop();
  if (!last) return "Home";
  return decodeURIComponent(last)
    .replace(/\.html?$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Compare URLs ignoring trailing slashes, query strings and hashes.
export const urlKey = (url) => {
  const u = new URL(url);
  return (u.host + u.pathname.replace(/\/+$/, "")).toLowerCase();
};
