// Client portal: every page in a project, with where the review stands.
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const STATE = {
  approved: ["Approved", "green"],
  needs_edits: ["Needs edits", "amber"],
  in_progress: ["In progress", "blue"],
  not_started: ["Not started", ""],
};
const root = document.getElementById("portal");
const id = location.pathname.split("/").filter(Boolean)[1];

async function render() {
  let project;
  try {
    const res = await fetch(`/api/projects/${id}`);
    project = await res.json();
    if (!res.ok) throw new Error(project.error || "Not found");
  } catch (e) {
    root.innerHTML = `<p class="err" style="margin-top:24px">This review link isn't valid (${esc(e.message)}).</p>`;
    return;
  }
  document.title = `${project.name} · Website review`;
  const { pages } = project;
  const approved = pages.filter((p) => p.state === "approved").length;
  const pct = pages.length ? Math.round((approved / pages.length) * 100) : 0;
  const next = pages.find((p) => p.state === "not_started") || pages.find((p) => p.state !== "approved");

  root.innerHTML = `
    <div class="head">
      <h1>${esc(project.name)}</h1>
      <p class="muted">Open each page, then approve its sections or click <b>Needs edits</b> and leave a comment right on the page.
      Type your copy changes in the comment; <b>✨ SEO-optimize</b> will suggest search-friendly versions.</p>
    </div>
    <div class="card progress-card">
      <div class="row"><b>${approved} of ${pages.length} pages approved</b><span class="sp"></span>
        ${next ? `<a class="btn primary" href="/${next.blank ? "c" : "r"}/${next.id}">${next.state === "not_started" ? "Start" : "Continue"}: ${esc(next.name)} →</a>` : `<span class="tag green">All done, thank you!</span>`}</div>
      <div class="bar"><span style="width:${pct}%"></span></div>
    </div>
    <div class="pages">${pages
      .map((p, i) => {
        const [label, color] = STATE[p.state] || STATE.not_started;
        const sec = p.counts.sections
          ? `${p.counts.approved + p.counts.needsEdits}/${p.counts.sections} sections reviewed`
          : "";
        return `<a class="card page link-card" href="/${p.blank ? "c" : "r"}/${p.id}">
          <div><h3>${i + 1}. ${esc(p.name)}${p.blank ? ` <span class="tag">Layout review</span>` : ""}</h3>
            <div class="url">${esc(new URL(p.url).pathname)}</div>
            <div class="stats"><span class="tag ${color}">${label}</span>
              ${p.counts.open ? `<span class="tag">${p.counts.open} open comment${p.counts.open === 1 ? "" : "s"}</span>` : ""}
              ${sec ? `<span class="muted" style="font-size:12px">${sec}</span>` : ""}</div></div>
          <span class="btn light sm">Review →</span></a>`;
      })
      .join("")}</div>`;
}
render();
