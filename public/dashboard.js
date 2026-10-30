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
  if (res.status === 401) {
    if (auth?.googleClientId) renderSignIn("Your session ended. Sign in again.");
    else $("#token-btn").hidden = false;
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Blank wireframe pages are reviewed side by side with the live page (/c/).
const reviewLink = (p) => `${location.origin}/${p.blank ? "c" : "r"}/${p.id}`;

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

const app = $("#app");
const portalLink = (p) => `${location.origin}/p/${p.id}`;
const STATE = {
  approved: ["Approved", "green"],
  needs_edits: ["Needs edits", "amber"],
  in_progress: ["In progress", "blue"],
  not_started: ["Not started", ""],
};
const stateTag = (st) => {
  const [l, c] = STATE[st] || STATE.not_started;
  return `<span class="tag ${c}">${l}</span>`;
};

// ---------- projects ----------
async function renderProjects() {
  app.innerHTML = `<div class="row head"><div><h1>Projects</h1>
      <p class="muted">One project per client or site. Each gets a single review link listing all of its staging pages.</p></div></div>
    <form id="new-project" class="card new">
      <h2>New project</h2>
      <div class="grid">
        <label>Project name<input name="name" required placeholder="Blend360 website redesign"></label>
        <label>Client<input name="client" placeholder="Blend360"></label>
        <label>Default SEO keywords <small>(optional, used by the AI)</small><input name="keywords" placeholder="enterprise AI consulting, data science services"></label>
        <label>Staging password <small>(if the Webflow staging site is password protected)</small><input name="password" type="password" autocomplete="off" placeholder="Webflow site password"></label>
      </div>
      <div class="row"><span class="sp"></span><button class="btn primary">Create project</button></div>
      <p class="err" hidden></p>
    </form>
    <div id="projects" class="pages"><p class="muted">Loading…</p></div>`;

  $("#new-project").onsubmit = async (e) => {
    e.preventDefault();
    const err = $(".err", e.target);
    try {
      const p = await api("/api/projects", { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
      location.hash = `#/project/${p.id}`;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  };

  const box = $("#projects");
  try {
    const projects = await api("/api/projects");
    box.innerHTML = projects.length
      ? projects
          .map((p) => {
            const open = p.pages.reduce((n, x) => n + x.counts.open, 0);
            const edits = p.pages.filter((x) => x.state === "needs_edits").length;
            return `<div class="card page">
          <div><h3><a href="#/project/${p.id}">${esc(p.name)}</a> ${p.client ? `<span class="tag">${esc(p.client)}</span>` : ""}</h3>
            <div class="stats">
              <span class="tag">${p.pages.length} page${p.pages.length === 1 ? "" : "s"}</span>
              <span class="tag green">${p.progress.approved} approved</span>
              <span class="tag amber">${edits} need edits</span>
              <span class="tag blue">${open} open comment${open === 1 ? "" : "s"}</span>
            </div></div>
          <div class="actions">
            <button class="btn light sm" data-copy="${esc(portalLink(p))}">Copy client link</button>
            <a class="btn primary sm" href="#/project/${p.id}">Open</a>
          </div></div>`;
          })
          .join("")
      : `<p class="muted">No projects yet. Create one above, then add its staging pages.</p>`;
  } catch (e) {
    box.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

// ---------- one project ----------
let addTab = "paste";

function parseLines(text) {
  // One page per line: "https://…" or "Name | https://…" or "Name, https://…"
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.*?)[|,\t]\s*(https?:\/\/\S+)\s*$/);
      return m ? { name: m[1].trim(), url: m[2] } : { url: l };
    });
}

async function addPages(projectId, pages, msgEl, blank = false) {
  const { created, skipped } = await api("/api/pages", { method: "POST", body: { projectId, pages, blank } });
  msgEl.hidden = false;
  msgEl.className = skipped.length ? "err" : "muted";
  msgEl.textContent =
    `Added ${created.length} page${created.length === 1 ? "" : "s"}.` +
    (skipped.length ? ` Skipped ${skipped.length}: ${skipped.map((x) => `${x.url} (${x.reason})`).join("; ")}` : "");
  return created.length;
}

async function renderProject(id) {
  app.innerHTML = `<p class="muted" style="margin-top:24px">Loading…</p>`;
  let project;
  try {
    project = await api(`/api/projects/${id}`);
  } catch (e) {
    app.innerHTML = `<a class="back" href="#/">← Projects</a><p class="err">${esc(e.message)}</p>`;
    return;
  }
  const { pages } = project;
  const firstUrl = pages[0]?.url;

  app.innerHTML = `<a class="back" href="#/">← Projects</a>
    <div class="row">
      <div><h1>${esc(project.name)}</h1><div class="muted">${esc(project.client || "")}${project.keywords ? ` · Keywords: ${esc(project.keywords)}` : ""} · ${project.hasPassword ? "🔒 Staging password saved" : "No staging password"}</div></div>
      <span class="sp"></span>
      <button class="btn primary sm" data-copy="${esc(portalLink(project))}">Copy client link</button>
      <a class="btn light sm" href="${esc(portalLink(project))}" target="_blank" rel="noopener">Preview as client</a>
      <button class="btn light sm" id="edit-kw">Edit keywords</button>
      <button class="btn light sm" id="edit-pw">${project.hasPassword ? "Change" : "Set"} staging password</button>
      <button class="btn light sm" id="del" style="color:var(--red)">Delete</button>
    </div>
    <div class="card progress-card" style="margin-top:16px">
      <div class="row"><b>${project.progress.approved} of ${pages.length} pages approved</b><span class="sp"></span>
        <span class="muted" style="font-size:12px">Send the client link: it lists every page below and tracks their progress.</span></div>
      <div class="bar"><span style="width:${pages.length ? Math.round((project.progress.approved / pages.length) * 100) : 0}%"></span></div>
    </div>

    <div class="card new bulk">
      <h2 style="margin:0">Add staging pages</h2>
      <div class="tabs">
        <button class="btn light sm ${addTab === "paste" ? "on" : ""}" data-tab="paste">Paste URLs</button>
        <button class="btn light sm ${addTab === "sitemap" ? "on" : ""}" data-tab="sitemap">Import from sitemap</button>
      </div>
      ${addTab === "paste"
        ? `<form id="paste" class="bulk">
            <textarea name="urls" rows="5" placeholder="One per line. Optionally name them:\nhttps://blend360new.webflow.io/about-v2\nServices | https://blend360new.webflow.io/services-v2"></textarea>
            <div class="row"><label class="check" title="The client sees the page's layout with all copy blanked out, next to the live page, and comments on it">
              <input type="checkbox" name="blank"> Blank wireframe (layout without copy, side by side with live)</label>
              <span class="sp"></span><button class="btn primary">Add pages</button></div></form>`
        : `<form id="sitemap" class="bulk">
            <div class="row" style="flex-wrap:nowrap"><input name="url" type="url" required placeholder="https://blend360new.webflow.io" value="${esc(firstUrl ? new URL(firstUrl).origin : "")}">
            <button class="btn light">Find pages</button></div>
            <div id="sm-results"></div></form>`}
      <p class="muted" id="add-msg" hidden></p>
    </div>

    <h2>Pages</h2>
    ${pages.length ? `<div class="ptable">${pages
      .map((p) => `<div class="prow">
        <span class="dot ${p.state}"></span>
        <div><div class="name"><a href="#/page/${p.id}">${esc(p.name)}</a>${p.versionOf ? ` <span class="tag orange">Extra blank version</span>` : p.blank ? ` <span class="tag">Blank wireframe</span>` : ""}</div><div class="url">${esc(p.url)}</div></div>
        <div class="stats" style="margin:0">${stateTag(p.state)}${p.counts.flagged ? `<span class="tag orange">${p.counts.flagged} flagged</span>` : ""}${p.counts.open ? `<span class="tag blue">${p.counts.open} open</span>` : ""}</div>
        <div class="actions">
          <a class="btn light sm" href="/${p.blank ? "c" : "r"}/${p.id}?team=1" target="_blank" rel="noopener" title="Opens in team mode, where you can flag sections for the client">Open</a>
          ${p.blank ? `<button class="btn light sm" data-version="${p.id}" title="Add another blank copy of this page with its own comments (Blank 2, Blank 3…)">+ Blank version</button>` : ""}
          <button class="btn light sm" data-blank="${p.id}" data-val="${!p.blank}" ${p.versionOf ? "hidden" : ""} title="${p.blank ? "Review the real page copy instead" : "Review the layout with copy blanked out, next to the live page"}">${p.blank ? "Use real copy" : "Make blank"}</button>
          <button class="btn light sm" data-rename="${p.id}" data-name="${esc(p.name)}">Rename</button>
          <a class="btn light sm" href="#/page/${p.id}">Feedback</a>
          <button class="btn light sm" data-delpage="${p.id}" data-name="${esc(p.name)}" style="color:var(--red)">✕</button>
        </div></div>`)
      .join("")}</div>` : `<p class="muted">No pages yet. Paste staging URLs or import the sitemap above.</p>`}`;

  const msg = $("#add-msg");
  app.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => ((addTab = b.dataset.tab), renderProject(id))));

  $("#paste")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const items = parseLines(e.target.urls.value);
    if (!items.length) return;
    try {
      if (await addPages(id, items, msg, e.target.blank.checked)) setTimeout(() => renderProject(id), 900);
    } catch (ex) {
      msg.hidden = false;
      msg.className = "err";
      msg.textContent = ex.message;
    }
  });

  $("#sitemap")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $("#sm-results");
    out.innerHTML = `<p class="muted">Reading sitemap…</p>`;
    try {
      const have = new Set(pages.map((p) => new URL(p.url).pathname.replace(/\/+$/, "")));
      const { urls } = await api("/api/sitemap", { method: "POST", body: { url: e.target.url.value, projectId: id } });
      const fresh = urls.filter((u) => !have.has(new URL(u).pathname.replace(/\/+$/, "")));
      if (!fresh.length) {
        out.innerHTML = `<p class="muted">Found ${urls.length} URLs; all are already in this project.</p>`;
        return;
      }
      out.innerHTML = `<div class="row" style="margin:6px 0"><span class="muted">${fresh.length} new pages found. Tick the ones to review.</span><span class="sp"></span>
          <button type="button" class="btn light sm" id="sm-all">Select all</button>
          <input id="sm-filter" placeholder="Filter, e.g. -v2" style="width:180px"></div>
        <div class="pick">${fresh.map((u) => `<label><input type="checkbox" value="${esc(u)}"> ${esc(new URL(u).pathname)}</label>`).join("")}</div>
        <div class="row" style="margin-top:8px"><span class="sp"></span><button type="button" class="btn primary" id="sm-add">Add selected</button></div>`;
      const boxes = () => [...out.querySelectorAll(".pick label")].filter((l) => l.style.display !== "none").map((l) => l.querySelector("input"));
      $("#sm-filter").oninput = (ev) => {
        const q = ev.target.value.toLowerCase();
        out.querySelectorAll(".pick label").forEach((l) => (l.style.display = l.textContent.toLowerCase().includes(q) ? "" : "none"));
      };
      $("#sm-all").onclick = () => {
        const bs = boxes();
        const on = !bs.every((b) => b.checked);
        bs.forEach((b) => (b.checked = on));
      };
      $("#sm-add").onclick = async () => {
        const picked = [...out.querySelectorAll(".pick input:checked")].map((b) => ({ url: b.value }));
        if (!picked.length) return;
        if (await addPages(id, picked, msg)) setTimeout(() => renderProject(id), 900);
      };
    } catch (ex) {
      out.innerHTML = `<p class="err">${esc(ex.message)}</p>`;
    }
  });

  app.querySelectorAll("[data-version]").forEach(
    (b) =>
      (b.onclick = async () => {
        await api(`/api/pages/${b.dataset.version}/versions`, { method: "POST" });
        renderProject(id);
      }),
  );
  app.querySelectorAll("[data-blank]").forEach(
    (b) =>
      (b.onclick = async () => {
        await api(`/api/pages/${b.dataset.blank}`, { method: "PATCH", body: { blank: b.dataset.val === "true" } });
        renderProject(id);
      }),
  );
  app.querySelectorAll("[data-rename]").forEach(
    (b) =>
      (b.onclick = async () => {
        const name = prompt("Page name:", b.dataset.name);
        if (!name) return;
        await api(`/api/pages/${b.dataset.rename}`, { method: "PATCH", body: { name } });
        renderProject(id);
      }),
  );
  app.querySelectorAll("[data-delpage]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm(`Remove "${b.dataset.name}" and its feedback?`)) return;
        await api(`/api/pages/${b.dataset.delpage}`, { method: "DELETE" });
        renderProject(id);
      }),
  );
  $("#edit-kw").onclick = async () => {
    const keywords = prompt("Default SEO keywords for this project (comma separated):", project.keywords || "");
    if (keywords === null) return;
    await api(`/api/projects/${id}`, { method: "PATCH", body: { keywords } });
    renderProject(id);
  };
  $("#edit-pw").onclick = async () => {
    const password = prompt("Webflow staging site password (leave empty to remove):", "");
    if (password === null) return;
    await api(`/api/projects/${id}`, { method: "PATCH", body: { password: password.trim() } });
    renderProject(id);
  };
  $("#del").onclick = async () => {
    if (!confirm(`Delete "${project.name}", all ${pages.length} pages and all feedback? This can't be undone.`)) return;
    await api(`/api/projects/${id}`, { method: "DELETE" });
    location.hash = "#/";
  };
}

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
    lines.push(`### #${c.n} · ${c.sectionLabel || "Page"}${c.card ? ` · Card ${c.card}` : ""} — ${c.author}`);
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
  const view = app;
  view.innerHTML = `<p class="muted" style="margin-top:24px">Loading…</p>`;
  let page, comments, status, flags;
  try {
    [page, comments, status, { flags }] = await Promise.all([
      api(`/api/pages/${id}`),
      api(`/api/comments?page=${id}`),
      api(`/api/status?page=${id}`),
      api(`/api/flags?page=${id}`),
    ]);
  } catch (e) {
    view.innerHTML = `<a class="back" href="#/">← Projects</a><p class="err">${esc(e.message)}</p>`;
    return;
  }

  const shown = comments.filter((c) =>
    filter === "open" ? !c.resolved : filter === "copy" ? c.copy?.proposed : filter === "resolved" ? c.resolved : true,
  );
  // Only highlighted sections are reviewed; older auto-marked sections are left out.
  const sections = Object.entries(status).filter(([key]) => flags?.[key]);

  const back = page.projectId ? `#/project/${page.projectId}` : "#/";
  view.innerHTML = `<a class="back" href="${back}">← Project</a>
    <div class="row">
      <div><h1>${esc(page.name)}</h1><div class="muted">${esc(page.url)}</div></div>
      <span class="sp"></span>
      <button class="btn light sm" data-copy="${esc(reviewLink(page))}">Copy page link</button>
      <a class="btn light sm" href="${esc(reviewLink(page))}?team=1" target="_blank" rel="noopener">Open in team mode</a>
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
          ${c.card ? `<span class="tag">Card ${c.card}</span>` : ""}
          ${c.viewport ? `<span>${c.viewport < 768 ? "📱" : "🖥"} ${c.viewport}px</span>` : ""}
          <span>${when(c.createdAt)}</span><span class="sp"></span>
          <a class="btn light sm" href="${location.origin}/r/${page.id}#comment-${c.id}" target="_blank" rel="noopener">View on page</a>
          <button class="btn light sm" data-resolve="${c.id}" data-val="${!c.resolved}">${c.resolved ? "Reopen" : "Resolve"}</button>
          <button class="btn light sm" data-delcomment="${c.id}" data-n="${c.n}" style="color:var(--red)" title="Delete this comment">Delete</button>
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
    location.hash = back;
  };
  view.querySelectorAll("[data-filter]").forEach((b) => (b.onclick = () => ((filter = b.dataset.filter), renderDetail(id))));
  view.querySelectorAll("[data-delcomment]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm(`Delete comment #${b.dataset.n}? This can't be undone.`)) return;
        await api(`/api/comments/${b.dataset.delcomment}?page=${id}`, { method: "DELETE" });
        renderDetail(id);
      }),
  );
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

// ---------- team sign-in ----------
let auth = null;

function loadGoogle() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load Google sign-in"));
    document.head.appendChild(s);
  });
}

async function renderSignIn(message = "") {
  $("#who").hidden = true;
  app.innerHTML = `<div class="card signin">
      <img class="brand-badge" src="/brand/logo-256.png" alt="Eight Limbs">
      <h1>Team sign-in</h1>
      <p class="muted">Sign in with your <b>@${esc(auth.domain)}</b> Google account (or a Gmail address the team has added) to manage review projects.</p>
      <div id="gsi"></div>
      <p class="err" ${message ? "" : "hidden"}>${esc(message)}</p>
    </div>`;
  try {
    await loadGoogle();
    google.accounts.id.initialize({
      client_id: auth.googleClientId,
      auto_select: true,
      callback: async ({ credential }) => {
        try {
          await api("/api/auth/google", { method: "POST", body: { credential } });
          await start();
        } catch (e) {
          renderSignIn(e.message);
        }
      },
    });
    google.accounts.id.renderButton($("#gsi"), { theme: "filled_black", size: "large", text: "signin_with", shape: "pill" });
  } catch (e) {
    $(".signin .err").hidden = false;
    $(".signin .err").textContent = e.message;
  }
}

function renderWho() {
  const who = $("#who");
  if (!auth?.user) return (who.hidden = true);
  who.hidden = false;
  who.innerHTML = `${auth.user.picture ? `<img src="${esc(auth.user.picture)}" alt="" referrerpolicy="no-referrer">` : ""}
    <span>${esc(auth.user.email)}</span><button class="btn ghost sm" id="signout">Sign out</button>`;
  $("#signout").onclick = async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.google?.accounts?.id?.disableAutoSelect();
    await start();
  };
}

async function start() {
  try {
    auth = await api("/api/auth/me");
  } catch {
    auth = { admin: true };
  }
  if (auth.version) $("#ver").textContent = `v${auth.version}`;
  if (auth.googleClientId && !auth.admin) return renderSignIn();
  renderWho();
  route();
}

function route() {
  const [, kind, id] = location.hash.match(/^#\/(project|page)\/([\w-]+)/) || [];
  if (kind === "project") renderProject(id);
  else if (kind === "page") renderDetail(id);
  else renderProjects();
}
addEventListener("hashchange", () => (auth?.googleClientId && !auth.admin ? renderSignIn() : route()));
start();
