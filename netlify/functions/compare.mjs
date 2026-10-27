// Side-by-side review for blank wireframe pages.
//   GET /c/:id   live page (reference) next to the blank version, scrolling together.
// Both panes are same-origin /r/ pages, so the shell can sync their scroll positions.
import { store, error, handle } from "./_lib/store.mjs";
import { projectPages } from "./_lib/summary.mjs";

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export default handle(async (req, context) => {
  const page = await store().get(`pages/${context.params.id}`);
  if (!page) return error(404, "Review page not found");
  const team = new URL(req.url).searchParams.has("team");
  // Team-mode page loads don't carry the shared-password header (Google sessions do), so show the
  // button in team mode and let /api/pages/:id/versions reject anyone who isn't on the team.
  const canEdit = team;
  // All blank versions of this live page, in order: the first one plus its extra versions.
  const rootId = page.versionOf || page.id;
  const versions = page.projectId
    ? (await projectPages(page.projectId)).filter((p) => p.id === rootId || p.versionOf === rootId)
    : [page];
  const qs = team ? "?team=1" : "";
  const vIndex = Math.max(0, versions.findIndex((v) => v.id === page.id));
  const title = (versions[0] || page).name;
  const live = `/r/${page.id}?view=live`;
  const blank = `/r/${page.id}${team ? "?team=1" : ""}`;
  const back = page.projectId ? `/p/${page.projectId}` : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" href="/brand/favicon-32.png"><title>${esc(title)} · Blank Page ${vIndex + 1}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #1e1e1e; font: 13px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; }
  header { height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-bottom: 1px solid #333; }
  header .brand { width: 28px; height: 28px; border-radius: 6px; display: block; }
  header .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header a { color: #bbb; text-decoration: none; }
  header a:hover { color: #fff; }
  .sp { flex: 1; }
  .seg { display: flex; background: #2c2c2c; border-radius: 9px; padding: 3px; }
  .seg button { border: 0; background: transparent; color: #ccc; font: inherit; padding: 6px 12px; border-radius: 7px; cursor: pointer; white-space: nowrap; }
  .seg button.on { background: #0d99ff; color: #fff; }
  .sync { display: flex; align-items: center; gap: 6px; color: #bbb; white-space: nowrap; }
  .versions { display: flex; align-items: center; gap: 4px; overflow-x: auto; max-width: 46vw; }
  .versions a, .versions button { border: 0; background: #2c2c2c; color: #ccc; font: inherit; padding: 6px 11px; border-radius: 8px;
    text-decoration: none; white-space: nowrap; cursor: pointer; }
  .versions a.on { background: #ffc700; color: #1e1e1e; font-weight: 700; }
  .versions a:hover { color: #fff; }
  .versions a.on:hover { color: #1e1e1e; }
  .versions .add { background: transparent; border: 1px dashed #555; }
  main { position: absolute; top: 48px; left: 0; right: 0; bottom: 0; display: flex; }
  .pane { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .pane + .pane { border-left: 2px solid #333; }
  /* Floating title on each pane, e.g. "BlendX · Blank Page 1". */
  .label { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2; background: rgba(30,30,30,.9); color: #fff;
    font-size: 13px; font-weight: 700; padding: 7px 14px; border-radius: 999px; pointer-events: none; white-space: nowrap;
    max-width: calc(100% - 24px); overflow: hidden; text-overflow: ellipsis; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
  .label.blank { background: #ffc700; color: #1e1e1e; }
  .label small { font-weight: 500; opacity: .75; margin-left: 6px; }
  iframe { flex: 1; width: 100%; border: 0; background: #fff; }
  main[data-view="blank"] .pane.live, main[data-view="live"] .pane.blank { display: none; }
  @media (max-width: 760px) { .sync, header .back { display: none; } .seg button { padding: 6px 9px; } }
</style></head>
<body>
<header>
  <img class="brand" src="/brand/mark-64.png" alt="Eight Limbs"><span class="name">${esc(title)}</span>
  ${back ? `<a class="back" href="${back}">All pages</a>` : ""}
  <span class="sp"></span>
  ${versions.length > 1 || canEdit
    ? `<nav class="versions" aria-label="Blank versions">${versions
        .map((v, i) => `<a href="/c/${v.id}${qs}" class="${v.id === page.id ? "on" : ""}" title="${esc(title)} · Blank Page ${i + 1}">Blank ${i + 1}</a>`)
        .join("")}${canEdit ? `<button class="add" id="add-version" title="Add another blank copy of this page, with its own comments">+ New blank</button>` : ""}</nav>`
    : ""}
  <label class="sync"><input type="checkbox" id="sync" checked> Sync scroll</label>
  <div class="seg" role="tablist">
    <button data-view="split">Side by side</button><button data-view="blank">Blank</button><button data-view="live">Live</button>
  </div>
</header>
<main id="main" data-view="split">
  <div class="pane live"><span class="label">${esc(title)} · Live site</span><iframe id="live" src="${live}" title="Live site"></iframe></div>
  <div class="pane blank"><span class="label blank">${esc(title)} · Blank Page ${vIndex + 1}${versions.length > 1 ? `<small>of ${versions.length}</small>` : ""}</span><iframe id="blank" src="${blank}" title="Blank layout"></iframe></div>
</main>
<script>
(() => {
  const main = document.getElementById("main");
  const frames = [document.getElementById("live"), document.getElementById("blank")];
  const sync = document.getElementById("sync");
  const KEY = "eightreview:compare-view";
  const setView = (v) => {
    main.dataset.view = v;
    document.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
    try { localStorage.setItem(KEY, v); } catch {}
  };
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  setView(saved || (innerWidth < 760 ? "blank" : "split"));
  document.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));

  // Same page, same width => same layout, so matching scroll ratio lines sections up.
  let lock = null;
  const ratio = (w) => {
    const max = w.document.documentElement.scrollHeight - w.innerHeight;
    return max > 0 ? w.scrollY / max : 0;
  };
  function follow(from, to) {
    if (!sync.checked || lock === to || main.dataset.view !== "split") return;
    try {
      const a = from.contentWindow, b = to.contentWindow;
      const max = b.document.documentElement.scrollHeight - b.innerHeight;
      lock = from;
      b.scrollTo(b.scrollX, Math.round(ratio(a) * max));
      requestAnimationFrame(() => requestAnimationFrame(() => (lock = null)));
    } catch {}
  }
  const add = document.getElementById("add-version");
  if (add) add.onclick = async () => {
    add.disabled = true;
    add.textContent = "Adding…";
    try {
      const res = await fetch("/api/pages/${page.id}/versions", { method: "POST", headers: { "content-type": "application/json", "x-admin-token": (() => { try { return localStorage.getItem("eightreview:admin") || ""; } catch { return ""; } })() } });
      const v = await res.json();
      if (!res.ok) throw new Error(v.error || res.status);
      location.href = "/c/" + v.id + "${qs}";
    } catch (e) {
      alert("Couldn't add a blank version: " + e.message);
      add.disabled = false;
      add.textContent = "+ New blank";
    }
  };
  // Keep the scroll position when switching between blank versions.
  try {
    const y = sessionStorage.getItem("eightreview:compare-y");
    if (y) frames.forEach((f) => f.addEventListener("load", () => { try { f.contentWindow.scrollTo(0, +y); } catch {} }, { once: true }));
    sessionStorage.removeItem("eightreview:compare-y");
  } catch {}
  document.querySelectorAll(".versions a").forEach((a) => a.addEventListener("click", () => {
    try { sessionStorage.setItem("eightreview:compare-y", frames[1].contentWindow.scrollY); } catch {}
  }));
  // Shortcuts pressed on this outer screen (C = comment, Esc) go to the blank page's review layer.
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !["c", "C", "Escape"].includes(e.key)) return;
    if (e.target.closest && e.target.closest("input, textarea")) return;
    try {
      frames[1].contentWindow.focus();
      frames[1].contentDocument.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, bubbles: true }));
    } catch {}
  });
  frames.forEach((f, i) => {
    f.addEventListener("load", () => {
      try { f.contentWindow.addEventListener("scroll", () => follow(f, frames[1 - i]), { passive: true }); } catch {}
    });
  });
})();
</script>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
});

export const config = { path: "/c/:id" };
