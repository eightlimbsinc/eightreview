// Side-by-side review for blank wireframe pages.
//   GET /c/:id   live page (reference) next to the blank version, scrolling together.
// Both panes are same-origin /r/ pages, so the shell can sync their scroll positions.
import { store, error, handle } from "./_lib/store.mjs";

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export default handle(async (req, context) => {
  const page = await store().get(`pages/${context.params.id}`);
  if (!page) return error(404, "Review page not found");
  const team = new URL(req.url).searchParams.has("team");
  const live = `/r/${page.id}?view=live`;
  const blank = `/r/${page.id}${team ? "?team=1" : ""}`;
  const back = page.projectId ? `/p/${page.projectId}` : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(page.name)} · Copy review</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #1e1e1e; font: 13px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; }
  header { height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-bottom: 1px solid #333; }
  header .brand { color: #0d99ff; font-weight: 800; }
  header .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header a { color: #bbb; text-decoration: none; }
  header a:hover { color: #fff; }
  .sp { flex: 1; }
  .seg { display: flex; background: #2c2c2c; border-radius: 9px; padding: 3px; }
  .seg button { border: 0; background: transparent; color: #ccc; font: inherit; padding: 6px 12px; border-radius: 7px; cursor: pointer; white-space: nowrap; }
  .seg button.on { background: #0d99ff; color: #fff; }
  .sync { display: flex; align-items: center; gap: 6px; color: #bbb; white-space: nowrap; }
  main { position: absolute; top: 48px; left: 0; right: 0; bottom: 0; display: flex; }
  .pane { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .pane + .pane { border-left: 2px solid #333; }
  .label { position: absolute; top: 8px; left: 8px; z-index: 2; background: rgba(30,30,30,.85); color: #fff; font-size: 11px; font-weight: 700;
    letter-spacing: .4px; text-transform: uppercase; padding: 4px 8px; border-radius: 6px; pointer-events: none; }
  .label.blank { background: #ffc700; color: #1e1e1e; }
  iframe { flex: 1; width: 100%; border: 0; background: #fff; }
  main[data-view="blank"] .pane.live, main[data-view="live"] .pane.blank { display: none; }
  @media (max-width: 760px) { .sync, header .back { display: none; } .seg button { padding: 6px 9px; } }
</style></head>
<body>
<header>
  <span class="brand">8R</span><span class="name">${esc(page.name)}</span>
  ${back ? `<a class="back" href="${back}">All pages</a>` : ""}
  <span class="sp"></span>
  <label class="sync"><input type="checkbox" id="sync" checked> Sync scroll</label>
  <div class="seg" role="tablist">
    <button data-view="split">Side by side</button><button data-view="blank">Blank</button><button data-view="live">Live</button>
  </div>
</header>
<main id="main" data-view="split">
  <div class="pane live"><span class="label">Live site</span><iframe id="live" src="${live}" title="Live site"></iframe></div>
  <div class="pane blank"><span class="label blank">Blank layout · comment here</span><iframe id="blank" src="${blank}" title="Blank layout"></iframe></div>
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
