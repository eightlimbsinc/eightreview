// Team dashboard: create review links and read the client's feedback.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hue = (n = "") => [...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 200);
const initials = (n = "?") => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "?";
const avatar = (n) => `<span class="av" style="background:hsl(${hue(n)} 55% 45%)">${esc(initials(n))}</span>`;
const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

const TOKEN_KEY = "eightreview:admin";
const token = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", "x-admin-token": token(), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) $("#token-btn").hidden = false;
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const reviewLink = (p) => `${location.origin}/r/${p.id}`;

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = "Copied ✓";
    setTimeout(() => (btn.textContent = old), 1500);
  } catch {
    prompt("Copy this:", text);
  }
}

// ---------- list ----------
async function renderList() {
  $("#list-view").hidden = false;
  $("#detail-view").hidden = true;
  const box = $("#pages");
  try {
    const pages = await api("/api/pages");
    if (!pages.length) {
      box.innerHTML = `<p class="muted">No review pages yet. Add your first staging URL above.</p>`;
      return;
    }
    box.innerHTML = pages
      .map(
        (p) => `<div class="card page">
        <div>
          <h3><a href="#/page/${p.id}">${esc(p.name)}</a> ${p.client ? `<span class="tag">${esc(p.client)}</span>` : ""}</h3>
          <div class="url">${esc(p.url)}</div>
          <div class="stats">
            <span class="tag blue">${p.counts.open} open comment${p.counts.open === 1 ? "" : "s"}</span>
            <span class="tag green">${p.counts.approved} approved</span>
            <span class="tag amber">${p.counts.needsEdits} need edits</span>
          </div>
        </div>
        <div class="actions">
          <button class="btn light sm" data-copy="${esc(reviewLink(p))}">Copy client link</button>
          <a class="btn light sm" href="${esc(reviewLink(p))}" target="_blank" rel="noopener">Open review</a>
          <a class="btn primary sm" href="#/page/${p.id}">Feedback</a>
        </div></div>`,
      )
      .join("");
  } catch (e) {
    box.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

$("#new-page").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const err = $(".err", form);
  err.hidden = true;
  try {
    const page = await api("/api/pages", { method: "POST", body: Object.fromEntries(new FormData(form)) });
    form.reset();
    location.hash = `#/page/${page.id}`;
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

// ---------- detail ----------
let filter = "open";

function markdownExport(page, comments, status) {
  const lines = [`# ${page.name} — copy feedback`, ``, `Staging: ${page.url}`, ``];
  const sections = Object.values(status);
  if (sections.length) {
    lines.push(`## Section status`, ``);
    for (const s of sections) lines.push(`- ${s.status === "approved" ? "✅" : "✏️"} ${s.label} — ${s.author}`);
    lines.push(``);
  }
  lines.push(`## Comments`, ``);
  for (const c of comments.filter((c) => !c.resolved)) {
    lines.push(`### #${c.n} · ${c.sectionLabel || "Page"} — ${c.author}`);
    if (c.anchor?.text) lines.push(`> On: "${c.anchor.text}"`);
    if (c.body) lines.push(``, c.body);
    if (c.copy?.proposed) {
      lines.push(``, `**New copy${c.copy.source === "ai" ? " (AI-assisted)" : ""}:**`, ``, c.copy.proposed);
      if (c.copy.current) lines.push(``, `_Was:_ ${c.copy.current}`);
    }
    for (const r of c.replies) lines.push(``, `- **${r.author}:** ${r.body}`);
    lines.push(``);
  }
  return lines.join("\n");
}

async function renderDetail(id) {
  $("#list-view").hidden = true;
  const view = $("#detail-view");
  view.hidden = false;
  view.innerHTML = `<p class="muted" style="margin-top:24px">Loading…</p>`;
  let page, comments, status;
  try {
    [page, comments, status] = await Promise.all([
      api(`/api/pages/${id}`),
      api(`/api/comments?page=${id}`),
      api(`/api/status?page=${id}`),
    ]);
  } catch (e) {
    view.innerHTML = `<a class="back" href="#/">← All pages</a><p class="err">${esc(e.message)}</p>`;
    return;
  }

  const shown = comments.filter((c) =>
    filter === "open" ? !c.resolved : filter === "copy" ? c.copy?.proposed : filter === "resolved" ? c.resolved : true,
  );
  const sections = Object.entries(status);

  view.innerHTML = `<a class="back" href="#/">← All pages</a>
    <div class="row">
      <div><h1>${esc(page.name)}</h1><div class="muted">${esc(page.url)}</div></div>
      <span class="sp"></span>
      <button class="btn light sm" data-copy="${esc(reviewLink(page))}">Copy client link</button>
      <a class="btn light sm" href="${esc(reviewLink(page))}" target="_blank" rel="noopener">Open review</a>
      <button class="btn light sm" id="export">Copy as Markdown</button>
      <button class="btn light sm" id="del" style="color:var(--red)">Delete</button>
    </div>
    <h2 style="margin-top:24px">Sections</h2>
    ${sections.length ? `<div class="sections">${sections
      .map(([, s]) => `<div class="sec"><span class="dot ${s.status}"></span><span>${esc(s.label)}</span><span class="sp"></span>
        <span class="muted" style="font-size:12px">${s.status === "approved" ? "Approved" : "Needs edits"}</span></div>`)
      .join("")}</div>` : `<p class="muted">No sections reviewed yet.</p>`}
    <h2>Comments</h2>
    <div class="filters">
      ${[["open", "Open"], ["copy", "Copy changes"], ["resolved", "Resolved"], ["all", "All"]]
        .map(([k, l]) => `<button class="btn light sm ${filter === k ? "on" : ""}" data-filter="${k}">${l}</button>`)
        .join("")}
    </div>
    <div class="comments">${shown.length ? shown
      .map(
        (c) => `<div class="card c ${c.resolved ? "resolved" : ""}">
        <div class="c-h">${avatar(c.author)}<b>${esc(c.author)}</b><span>#${c.n}</span>
          ${c.sectionLabel ? `<span class="tag">${esc(c.sectionLabel)}</span>` : ""}
          ${c.viewport ? `<span>${c.viewport < 768 ? "📱" : "🖥"} ${c.viewport}px</span>` : ""}
          <span>${when(c.createdAt)}</span><span class="sp"></span>
          <a class="btn light sm" href="${esc(reviewLink(page))}#comment-${c.id}" target="_blank" rel="noopener">View on page</a>
          <button class="btn light sm" data-resolve="${c.id}" data-val="${!c.resolved}">${c.resolved ? "Reopen" : "Resolve"}</button>
        </div>
        ${c.anchor?.text ? `<div class="on-text">On: “${esc(c.anchor.text)}”</div>` : ""}
        ${c.body ? `<div class="c-body">${esc(c.body)}</div>` : ""}
        ${c.copy?.proposed ? `<div class="copy"><span class="lbl">${c.copy.source === "ai" ? "✨ New copy · AI-assisted" : "New copy"}</span>
          <p class="new">${esc(c.copy.proposed)}</p>
          ${c.copy.rationale ? `<span class="why">${esc(c.copy.rationale)}</span>` : ""}
          ${c.copy.current ? `<span class="old">Was: ${esc(c.copy.current)}</span>` : ""}
          <div><button class="btn light sm" data-copy="${esc(c.copy.proposed)}">Copy text</button></div></div>` : ""}
        ${c.replies.length ? `<div class="replies">${c.replies.map((r) => `<div><b>${esc(r.author)}:</b> ${esc(r.body)}</div>`).join("")}</div>` : ""}
      </div>`,
      )
      .join("") : `<p class="muted">Nothing here.</p>`}</div>`;

  $("#export").onclick = (e) => copyText(markdownExport(page, comments, status), e.target);
  $("#del").onclick = async () => {
    if (!confirm(`Delete "${page.name}" and all its feedback? This can't be undone.`)) return;
    await api(`/api/pages/${id}`, { method: "DELETE" });
    location.hash = "#/";
  };
  view.querySelectorAll("[data-filter]").forEach((b) => (b.onclick = () => ((filter = b.dataset.filter), renderDetail(id))));
  view.querySelectorAll("[data-resolve]").forEach(
    (b) =>
      (b.onclick = async () => {
        await api(`/api/comments/${b.dataset.resolve}`, {
          method: "PATCH",
          body: { pageId: id, resolved: b.dataset.val === "true" },
        });
        renderDetail(id);
      }),
  );
}

// ---------- shared ----------
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]");
  if (b) copyText(b.dataset.copy, b);
});

$("#token-btn").onclick = () => {
  const t = prompt("Admin token (set as ADMIN_TOKEN in Netlify):", token());
  if (t === null) return;
  try {
    localStorage.setItem(TOKEN_KEY, t.trim());
  } catch {}
  route();
};

function route() {
  const m = location.hash.match(/^#\/page\/([\w-]+)/);
  if (m) renderDetail(m[1]);
  else renderList();
}
addEventListener("hashchange", route);
route();
