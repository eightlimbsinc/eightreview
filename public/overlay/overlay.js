/* EightReview overlay: Figma-style comments + section approvals on a live staging page.
 * Injected by /r/:id. Everything renders inside a shadow root so the site's CSS can't
 * leak in, and pins anchor to real DOM elements so they survive resizes.
 */
(() => {
  const CFG = window.__EIGHTREVIEW__;
  if (!CFG || window.__eightreviewLoaded) return;
  window.__eightreviewLoaded = true;

  const API = CFG.api || "";
  const PAGE = CFG.pageId;
  const NAME_KEY = "eightreview:name";
  const PROJECT = CFG.project;
  const SIBLINGS = CFG.pages || [];
  const pageIndex = SIBLINGS.findIndex((p) => p.id === PAGE);
  const reviewUrl = (id) => `${API}/r/${id}`;
  const urlKey = (u) => {
    try {
      const x = new URL(u, location.href);
      return (x.host + x.pathname.replace(/\/+$/, "")).toLowerCase();
    } catch {
      return "";
    }
  };
  const siblingByUrl = new Map(SIBLINGS.map((p) => [urlKey(p.url), p]));

  const state = {
    comments: [],
    statuses: {},
    sections: [],
    mode: "browse", // "browse" | "comment"
    showResolved: false,
    showSections: true,
    sidebar: false,
    pagesOpen: false,
    projectPages: null, // fetched on demand for the page switcher
    nudged: false,
    openId: null, // open thread id
    draft: null, // { anchor, el, sectionKey, sectionLabel, x, y, ai, copy }
    hoverEl: null,
  };

  // ---------- utilities ----------
  const $ = (sel, root = ui) => root.querySelector(sel);
  const esc = (s = "") =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const getName = () => {
    try {
      return localStorage.getItem(NAME_KEY) || "";
    } catch {
      return "";
    }
  };
  const setName = (n) => {
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {}
  };
  const initials = (n = "?") =>
    n
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join("") || "?";
  const hue = (n = "") => [...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 200);
  const avatar = (n) =>
    `<span class="av" style="background:hsl(${hue(n)} 55% 45%)">${esc(initials(n))}</span>`;
  const ago = (iso) => {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  };
  const slug = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
  const cleanText = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { "content-type": "application/json", ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // ---------- anchoring ----------
  function selectorFor(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(el.id)}`);
        break;
      }
      const tag = el.tagName.toLowerCase();
      let i = 1;
      for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling)
        if (sib.tagName === el.tagName) i++;
      parts.unshift(`${tag}:nth-of-type(${i})`);
      el = el.parentElement;
    }
    if (!parts[0]?.startsWith("#")) parts.unshift("body");
    return parts.join(" > ");
  }

  function resolveAnchor(anchor) {
    let el = null;
    try {
      el = document.querySelector(anchor.selector);
    } catch {}
    const want = (anchor.text || "").slice(0, 60);
    if (want && (!el || !cleanText(el).startsWith(want.slice(0, 30)))) {
      // DOM changed since the comment was left: find the element by its text instead.
      const candidates = document.querySelectorAll(anchor.tag || "*");
      for (const c of candidates) {
        if (host.contains(c)) continue;
        if (cleanText(c).startsWith(want)) {
          el = c;
          break;
        }
      }
    }
    return el;
  }

  function docPoint(el, xPct, yPct) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null; // hidden at this breakpoint
    return { x: r.left + scrollX + r.width * xPct, y: r.top + scrollY + r.height * yPct };
  }

  // ---------- sections ----------
  function findSections() {
    let els = [...document.querySelectorAll("section, [data-review-section]")].filter(
      (el) => !host.contains(el) && !el.parentElement.closest("section, [data-review-section]"),
    );
    if (els.length < 2) {
      const main = document.querySelector("main") || document.querySelector(".page-wrapper") || document.body;
      els = [...main.children].filter((el) => el !== host && !/^(SCRIPT|STYLE|NAV|HEADER)$/.test(el.tagName));
    }
    const used = new Set();
    return els
      .filter((el) => el.getBoundingClientRect().height > 60)
      .map((el, i) => {
        const heading = el.querySelector("h1, h2, h3, h4");
        const label = cleanText(heading).slice(0, 60) || `Section ${i + 1}`;
        let key = el.dataset.reviewSection || slug(label) || `section-${i + 1}`;
        while (used.has(key)) key += "-2";
        used.add(key);
        return { el, key, label, heading };
      });
  }
  const sectionOf = (el) => state.sections.find((s) => s.el.contains(el));

  // ---------- shadow UI ----------
  const host = document.createElement("div");
  host.id = "eightreview-root";
  host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483000;";
  const ui = host.attachShadow({ mode: "open" });
  ui.innerHTML = `<style>${CSS_TEXT()}</style>
    <div class="layer">
      <div class="hover"></div>
      <div class="chips"></div>
      <div class="pins"></div>
      <div class="pop"></div>
    </div>
    <aside class="sidebar" hidden></aside>
    <div class="pages-panel" hidden></div>
    <div class="toolbar">
      <span class="brand" title="EightReview">8R</span>
      ${SIBLINGS.length > 1 ? `<span class="pager">
        <button class="tb arrow" data-act="prev" title="Previous page" ${pageIndex <= 0 ? "disabled" : ""}>‹</button>
        <button class="tb pg" data-act="pages" title="All pages in this review"><span class="pg-name">${esc(CFG.name || "Page")}</span><span class="pg-n">${pageIndex + 1}/${SIBLINGS.length}</span></button>
        <button class="tb arrow" data-act="next" title="Next page" ${pageIndex >= SIBLINGS.length - 1 ? "disabled" : ""}>›</button>
      </span><span class="divider"></span>` : ""}
      <button class="tb mode" data-act="mode" title="Comment (C)">
        <svg viewBox="0 0 24 24"><path d="M4 4h16v12H8l-4 4z"/></svg><span>Comment</span>
      </button>
      <button class="tb" data-act="sections" title="Show section approvals">
        <svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg><span>Sections</span>
      </button>
      <button class="tb" data-act="sidebar" title="All comments">
        <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg><span class="count">0</span>
      </button>
      <span class="progress" title="Sections reviewed"></span>
    </div>
    <div class="toast" hidden></div>
    <div class="modal" hidden></div>`;

  const layer = $(".layer");
  const hoverBox = $(".hover");
  const pinsEl = $(".pins");
  const chipsEl = $(".chips");
  const popEl = $(".pop");
  const sidebarEl = $(".sidebar");

  function toast(msg, ms = 2600) {
    const t = $(".toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), ms);
  }

  let namePrompt = null;
  function askName() {
    if (namePrompt) return namePrompt;
    return (namePrompt = new Promise((resolve) => {
      const m = $(".modal");
      m.hidden = false;
      m.innerHTML = `<form class="card name-card">
        <h3>Welcome to the review</h3>
        <p>Add your name so the team knows who left each comment.</p>
        <input name="n" placeholder="Your name" autocomplete="name" required maxlength="80">
        <button class="btn primary">Start reviewing</button></form>`;
      const input = m.querySelector("input");
      setTimeout(() => input.focus(), 0);
      m.querySelector("form").onsubmit = (e) => {
        e.preventDefault();
        const n = input.value.trim();
        if (!n) return;
        setName(n);
        m.hidden = true;
        namePrompt = null;
        resolve(n);
      };
    }));
  }
  const ensureName = async () => getName() || askName();

  // ---------- render ----------
  function render() {
    const visible = state.comments.filter((c) => state.showResolved || !c.resolved);
    const placed = [];
    pinsEl.innerHTML = "";
    for (const c of visible) {
      const el = resolveAnchor(c.anchor);
      const p = el && docPoint(el, c.anchor.xPct, c.anchor.yPct);
      c._hidden = !p;
      if (!p) continue;
      placed.push(c);
      const pin = document.createElement("button");
      pin.className = `pin${c.resolved ? " resolved" : ""}${state.openId === c.id ? " active" : ""}`;
      pin.style.left = `${p.x}px`;
      pin.style.top = `${p.y}px`;
      pin.dataset.id = c.id;
      pin.innerHTML = `${avatar(c.author)}<b>${c.n}</b>`;
      pin.title = `${c.author}: ${c.body || c.copy?.proposed || ""}`.slice(0, 120);
      pinsEl.appendChild(pin);
    }

    chipsEl.innerHTML = "";
    if (state.showSections) {
      for (const s of state.sections) {
        const r = s.el.getBoundingClientRect();
        if (!r.height) continue;
        const st = state.statuses[s.key]?.status;
        const open = state.comments.filter((c) => c.sectionKey === s.key && !c.resolved).length;
        const chip = document.createElement("div");
        chip.className = `chip ${st || ""}`;
        chip.style.top = `${r.top + scrollY + 12}px`;
        chip.style.left = `${Math.max(12, r.right + scrollX - 12)}px`;
        chip.dataset.key = s.key;
        chip.innerHTML = `<span class="lbl" title="${esc(s.label)}">${esc(s.label)}</span>
          ${open ? `<span class="n">${open}</span>` : ""}
          <button data-act="approve" class="${st === "approved" ? "on" : ""}" title="Approve this section">✓ Approve</button>
          <button data-act="edits" class="${st === "needs_edits" ? "on" : ""}" title="Request edits">✎ Needs edits</button>`;
        chipsEl.appendChild(chip);
      }
    }

    renderPopover();
    if (state.sidebar) renderSidebar();

    const reviewed = state.sections.filter((s) => state.statuses[s.key]).length;
    const prog = $(".progress");
    prog.textContent = state.sections.length ? `${reviewed}/${state.sections.length} sections` : "";
    prog.classList.toggle("done", reviewed && reviewed === state.sections.length);
    $(".count").textContent = state.comments.filter((c) => !c.resolved).length;
    $('.toolbar [data-act="mode"]').classList.toggle("on", state.mode === "comment");
    $('.toolbar [data-act="sections"]').classList.toggle("on", state.showSections);
    $('.toolbar [data-act="sidebar"]').classList.toggle("on", state.sidebar);
    $('.toolbar [data-act="pages"]')?.classList.toggle("on", state.pagesOpen);
    if (reviewed && reviewed === state.sections.length && !state.nudged && load.done) nudgeNext();
    document.documentElement.classList.toggle("eightreview-commenting", state.mode === "comment");
  }

  function placePopover(x, y) {
    const w = Math.min(340, innerWidth - 24);
    let left = x + 18;
    if (left + w > scrollX + innerWidth - 12) left = Math.max(scrollX + 12, x - w - 18);
    popEl.style.left = `${left}px`;
    popEl.style.top = `${Math.max(scrollY + 12, y - 16)}px`;
    popEl.style.width = `${w}px`;
  }

  function copyBlock(copy) {
    if (!copy?.proposed) return "";
    return `<div class="copy">
      <div class="copy-h">${copy.source === "ai" ? "✨ Proposed copy (AI-assisted)" : "Proposed copy"}</div>
      <div class="copy-new">${esc(copy.proposed)}</div>
      ${copy.rationale ? `<div class="copy-why">${esc(copy.rationale)}</div>` : ""}
      ${copy.current ? `<details><summary>Current copy</summary><div class="copy-old">${esc(copy.current)}</div></details>` : ""}
    </div>`;
  }

  function renderPopover() {
    if (state.draft) return renderDraft();
    const c = state.comments.find((x) => x.id === state.openId);
    if (!c) {
      popEl.hidden = true;
      popEl.innerHTML = "";
      return;
    }
    const el = resolveAnchor(c.anchor);
    const p = el && docPoint(el, c.anchor.xPct, c.anchor.yPct);
    if (!p) {
      popEl.hidden = true;
      return;
    }
    // Don't clobber a reply the reviewer is typing when a background refresh re-renders.
    const typing =
      popEl.dataset.for === c.id &&
      (popEl.querySelector("textarea")?.value || popEl.contains(ui.activeElement));
    if (typing) return placePopover(p.x, p.y);

    popEl.hidden = false;
    popEl.dataset.for = c.id;
    placePopover(p.x, p.y);
    popEl.innerHTML = `<div class="card thread">
      <div class="th-h">
        <span>#${c.n}${c.sectionLabel ? ` · ${esc(c.sectionLabel)}` : ""}</span>
        <span class="sp"></span>
        <button class="icon" data-act="resolve" title="${c.resolved ? "Reopen" : "Resolve"}">${c.resolved ? "↺" : "✓"}</button>
        <button class="icon" data-act="close" title="Close">✕</button>
      </div>
      <div class="msg">${avatar(c.author)}<div><div class="who">${esc(c.author)} <time>${ago(c.createdAt)}</time></div>
        ${c.body ? `<div class="body">${esc(c.body)}</div>` : ""}${copyBlock(c.copy)}</div></div>
      ${c.replies
        .map(
          (r) => `<div class="msg">${avatar(r.author)}<div><div class="who">${esc(r.author)} <time>${ago(r.createdAt)}</time></div>
        <div class="body">${esc(r.body)}</div></div></div>`,
        )
        .join("")}
      <form class="reply"><textarea rows="1" placeholder="Reply…"></textarea><button class="btn primary sm">Reply</button></form>
    </div>`;
  }

  function renderDraft() {
    const d = state.draft;
    popEl.hidden = false;
    popEl.dataset.for = "draft";
    placePopover(d.x, d.y);
    if (popEl.querySelector(".draft")) return updateDraftAI();
    const current = cleanText(d.el).slice(0, 600);
    popEl.innerHTML = `<form class="card draft">
      <div class="th-h"><span>New comment${d.sectionLabel ? ` · ${esc(d.sectionLabel)}` : ""}</span><span class="sp"></span>
        <button type="button" class="icon" data-act="cancel" title="Cancel (Esc)">✕</button></div>
      ${current ? `<div class="target" title="${esc(current)}"><span>On:</span> “${esc(current.slice(0, 140))}${current.length > 140 ? "…" : ""}”</div>` : ""}
      <textarea name="body" rows="3" placeholder="Leave a comment, or type the copy you want here…"></textarea>
      <div class="ai"></div>
      <div class="row">
        <button type="button" class="btn ghost sm" data-act="seo" title="Rewrite as SEO-friendly copy options">✨ SEO-optimize</button>
        <span class="sp"></span>
        <button class="btn primary sm">Post</button>
      </div></form>`;
    const ta = popEl.querySelector("textarea");
    setTimeout(() => ta.focus(), 0);
    updateDraftAI();
  }

  function updateDraftAI() {
    const d = state.draft;
    const box = popEl.querySelector(".ai");
    if (!box) return;
    if (d.ai === "loading") {
      box.innerHTML = `<div class="ai-load"><span class="spin"></span>Writing SEO options…</div>`;
    } else if (d.ai?.variants) {
      box.innerHTML = `<div class="ai-h">${esc(d.ai.interpretation || "Pick a version to propose:")}</div>
        ${d.ai.variants
          .map(
            (v, i) => `<button type="button" class="variant${d.copy?.proposed === v.text ? " on" : ""}" data-act="pick" data-i="${i}">
            <span class="v-text">${esc(v.text)}</span><span class="v-why">${esc(v.rationale)}</span></button>`,
          )
          .join("")}
        ${d.ai.tips ? `<div class="ai-tip">💡 ${esc(d.ai.tips)}</div>` : ""}`;
    } else {
      box.innerHTML = d.copy?.proposed ? copyBlock(d.copy) : "";
    }
  }

  function renderSidebar() {
    const list = state.comments.filter((c) => state.showResolved || !c.resolved);
    const bySection = new Map();
    for (const c of list) {
      const k = c.sectionLabel || "Other";
      if (!bySection.has(k)) bySection.set(k, []);
      bySection.get(k).push(c);
    }
    sidebarEl.innerHTML = `<div class="sb-h"><b>Comments</b><span class="sp"></span>
        <label class="tog"><input type="checkbox" data-act="resolved" ${state.showResolved ? "checked" : ""}> Show resolved</label>
        <button class="icon" data-act="sidebar">✕</button></div>
      <div class="sb-name">Reviewing as <b>${esc(getName() || "—")}</b> <button class="link" data-act="rename">change</button></div>
      ${list.length ? "" : `<p class="empty">No comments yet. Press <kbd>C</kbd> and click anywhere on the page.</p>`}
      ${[...bySection]
        .map(
          ([label, items]) => `<div class="sb-sec">${esc(label)}</div>${items
            .map(
              (c) => `<button class="sb-item${c.resolved ? " resolved" : ""}" data-act="goto" data-id="${c.id}">
              ${avatar(c.author)}<div><div class="who">#${c.n} ${esc(c.author)} <time>${ago(c.createdAt)}</time></div>
              <div class="body">${esc((c.body || c.copy?.proposed || "").slice(0, 140))}</div>
              ${c._hidden ? `<div class="hint">Not visible at this screen size</div>` : ""}
              ${c.replies.length ? `<div class="hint">${c.replies.length} repl${c.replies.length > 1 ? "ies" : "y"}</div>` : ""}</div></button>`,
            )
            .join("")}`,
        )
        .join("")}`;
  }

  const STATE_LABEL = { approved: "Approved", needs_edits: "Needs edits", in_progress: "In progress", not_started: "Not started" };

  async function renderPagesPanel() {
    const panel = $(".pages-panel");
    panel.hidden = !state.pagesOpen;
    if (!state.pagesOpen) return;
    const rows = state.projectPages || SIBLINGS;
    panel.innerHTML = `<div class="pp-h"><b>${esc(PROJECT?.name || "Pages")}</b><span class="sp"></span>
        ${PROJECT ? `<a class="link" href="${API}/p/${PROJECT.id}">Overview</a>` : ""}</div>
      <div class="pp-list">${rows
        .map(
          (p, i) => `<a class="pp-item${p.id === PAGE ? " cur" : ""}" href="${reviewUrl(p.id)}">
          <span class="dot ${p.state || ""}" title="${STATE_LABEL[p.state] || ""}"></span>
          <span class="pp-name">${i + 1}. ${esc(p.name)}</span>
          ${p.counts?.open ? `<span class="n">${p.counts.open}</span>` : ""}</a>`,
        )
        .join("")}</div>`;
    if (!state.projectPages && PROJECT) {
      try {
        state.projectPages = (await api(`/api/projects/${PROJECT.id}`)).pages;
        renderPagesPanel();
      } catch {}
    }
  }

  function nudgeNext() {
    state.nudged = true;
    const next = SIBLINGS[pageIndex + 1];
    const t = $(".toast");
    t.innerHTML = next
      ? `All sections on this page reviewed. <a class="link light" href="${reviewUrl(next.id)}">Next: ${esc(next.name)} →</a>`
      : `All sections on this page reviewed. ${PROJECT ? `<a class="link light" href="${API}/p/${PROJECT.id}">Back to all pages →</a>` : ""}`;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 9000);
  }

  // Tell the server how many sections this page has, so progress can be shown before the client finishes.
  let registered = "";
  function registerSections() {
    const sig = state.sections.map((x) => x.key).join("|");
    if (!sig || sig === registered) return;
    registered = sig;
    api("/api/status", {
      method: "POST",
      body: { pageId: PAGE, sections: state.sections.map(({ key, label }) => ({ key, label })) },
    }).catch(() => {});
  }

  // ---------- actions ----------
  async function load() {
    const [comments, statuses] = await Promise.all([
      api(`/api/comments?page=${PAGE}`),
      api(`/api/status?page=${PAGE}`),
    ]);
    state.comments = comments;
    state.statuses = statuses;
    render();
    const deep = location.hash.match(/^#comment-([\w-]+)/);
    if (deep && !load.done) openComment(deep[1]);
    load.done = true;
  }

  function startDraft(el, clientX, clientY, extra = {}) {
    const r = el.getBoundingClientRect();
    const xPct = r.width ? (clientX - r.left) / r.width : 0;
    const yPct = r.height ? (clientY - r.top) / r.height : 0;
    const sec = sectionOf(el);
    state.openId = null;
    state.draft = {
      el,
      anchor: {
        selector: selectorFor(el),
        xPct: Math.min(1, Math.max(0, xPct)),
        yPct: Math.min(1, Math.max(0, yPct)),
        text: cleanText(el).slice(0, 120),
        tag: el.tagName.toLowerCase(),
      },
      sectionKey: sec?.key || "",
      sectionLabel: sec?.label || "",
      x: clientX + scrollX,
      y: clientY + scrollY,
      ai: null,
      copy: null,
      ...extra,
    };
    popEl.innerHTML = "";
    render();
  }

  async function postDraft() {
    const d = state.draft;
    const body = popEl.querySelector('textarea[name="body"]').value.trim();
    if (!body && !d.copy?.proposed) return toast("Write a comment first");
    const author = await ensureName();
    const btn = popEl.querySelector(".btn.primary");
    btn.disabled = true;
    try {
      const c = await api("/api/comments", {
        method: "POST",
        body: {
          pageId: PAGE,
          author,
          body,
          anchor: d.anchor,
          sectionKey: d.sectionKey,
          sectionLabel: d.sectionLabel,
          viewport: innerWidth,
          copy: d.copy,
        },
      });
      state.comments.push(c);
      if (d.sectionKey && !state.statuses[d.sectionKey]) await setStatus(d.sectionKey, "needs_edits", false);
      state.draft = null;
      state.openId = c.id;
      state.mode = "browse";
      popEl.innerHTML = "";
      render();
      toast("Comment posted");
    } catch (e) {
      btn.disabled = false;
      toast(e.message);
    }
  }

  async function runSEO() {
    const d = state.draft;
    const note = popEl.querySelector('textarea[name="body"]').value.trim();
    if (!note) return toast("Type your copy or what should change, then hit ✨");
    d.ai = "loading";
    updateDraftAI();
    try {
      d.ai = await api("/api/seo", {
        method: "POST",
        body: {
          pageId: PAGE,
          note,
          current: cleanText(d.el).slice(0, 3000),
          tag: d.anchor.tag,
          sectionLabel: d.sectionLabel,
        },
      });
    } catch (e) {
      d.ai = null;
      toast(e.message, 4000);
    }
    updateDraftAI();
  }

  async function setStatus(key, status, rerender = true) {
    const sec = state.sections.find((s) => s.key === key);
    const author = await ensureName();
    state.statuses = await api("/api/status", {
      method: "POST",
      body: { pageId: PAGE, sectionKey: key, label: sec?.label, status, author },
    });
    if (rerender) render();
  }

  async function patchComment(id, body) {
    const updated = await api(`/api/comments/${id}`, { method: "PATCH", body: { pageId: PAGE, ...body } });
    state.comments = state.comments.map((c) => (c.id === id ? updated : c));
    render();
  }

  function openComment(id) {
    const c = state.comments.find((x) => x.id === id);
    if (!c) return;
    state.draft = null;
    state.openId = id;
    popEl.innerHTML = "";
    popEl.dataset.for = "";
    const el = resolveAnchor(c.anchor);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (innerWidth < 700) state.sidebar = false;
    render();
    setTimeout(render, 450);
  }

  // ---------- events ----------
  const insideUI = (e) => e.composedPath().includes(host);

  ui.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-act], .pin");
    if (!t) return;
    if (t.classList.contains("pin")) {
      state.draft = null;
      state.openId = state.openId === t.dataset.id ? null : t.dataset.id;
      popEl.innerHTML = "";
      popEl.dataset.for = "";
      return render();
    }
    const act = t.dataset.act;
    try {
      if (act === "mode") {
        state.mode = state.mode === "comment" ? "browse" : "comment";
        if (state.mode === "comment") toast("Click anywhere on the page to leave a comment");
        else hoverBox.style.display = "none";
        render();
      } else if (act === "pages") {
        state.pagesOpen = !state.pagesOpen;
        renderPagesPanel();
        render();
      } else if (act === "prev" || act === "next") {
        const target = SIBLINGS[pageIndex + (act === "next" ? 1 : -1)];
        if (target) location.href = reviewUrl(target.id);
      } else if (act === "sections") {
        state.showSections = !state.showSections;
        render();
      } else if (act === "sidebar") {
        state.sidebar = !state.sidebar;
        sidebarEl.hidden = !state.sidebar;
        render();
      } else if (act === "resolved") {
        state.showResolved = t.checked;
        render();
      } else if (act === "rename") {
        await askName();
        render();
      } else if (act === "goto") {
        openComment(t.dataset.id);
      } else if (act === "close") {
        state.openId = null;
        render();
      } else if (act === "cancel") {
        state.draft = null;
        popEl.innerHTML = "";
        render();
      } else if (act === "resolve") {
        const c = state.comments.find((x) => x.id === state.openId);
        await patchComment(c.id, { resolved: !c.resolved });
        if (!state.showResolved && !c.resolved) state.openId = null;
        render();
      } else if (act === "seo") {
        await runSEO();
      } else if (act === "pick") {
        const v = state.draft.ai.variants[+t.dataset.i];
        state.draft.copy = {
          current: cleanText(state.draft.el).slice(0, 3000),
          proposed: v.text,
          source: "ai",
          rationale: v.rationale,
        };
        updateDraftAI();
      } else if (act === "approve" || act === "edits") {
        const key = t.closest(".chip").dataset.key;
        const cur = state.statuses[key]?.status;
        if (act === "approve") {
          const wasNudged = state.nudged;
          await setStatus(key, cur === "approved" ? "pending" : "approved");
          // Approving the last section shows the "next page" prompt instead.
          if (cur !== "approved" && wasNudged === state.nudged) toast("Section approved ✓");
        } else {
          if (cur !== "needs_edits") await setStatus(key, "needs_edits");
          const sec = state.sections.find((s) => s.key === key);
          const target = sec.heading || sec.el;
          const r = target.getBoundingClientRect();
          startDraft(target, r.left + Math.min(r.width, 40), r.top + Math.min(r.height / 2, 30));
        }
      }
    } catch (err) {
      toast(err.message);
    }
  });

  ui.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.classList.contains("draft")) return postDraft();
    if (form.classList.contains("reply")) {
      const ta = form.querySelector("textarea");
      const body = ta.value.trim();
      if (!body) return;
      ensureName().then((author) => {
        ta.value = "";
        patchComment(state.openId, { reply: { author, body } }).catch((err) => toast(err.message));
      });
    }
  });

  ui.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target.tagName === "TEXTAREA") {
      e.preventDefault();
      e.target.form?.requestSubmit();
    }
    e.stopPropagation(); // keep the site's own key handlers out of our inputs
  });

  // Comment mode: hijack clicks on the page (capture phase so links don't navigate).
  const block = (e) => {
    if (state.mode !== "comment" || insideUI(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  ["mousedown", "mouseup", "pointerdown", "pointerup"].forEach((t) => document.addEventListener(t, block, true));
  document.addEventListener(
    "click",
    (e) => {
      if (insideUI(e)) return;
      if (state.mode !== "comment") {
        // <base> points at the staging site, so "#section" links would leave the review. Scroll instead.
        const a = e.target.closest?.("a[href]");
        const href = a?.getAttribute("href") || "";
        if (href.startsWith("#")) {
          e.preventDefault();
          const id = decodeURIComponent(href.slice(1));
          (id && document.getElementById(id))?.scrollIntoView({ behavior: "smooth" });
        } else if (a) {
          // Links to other pages in this review stay inside the review.
          const sib = siblingByUrl.get(urlKey(a.href));
          if (sib && sib.id !== PAGE) {
            e.preventDefault();
            location.href = reviewUrl(sib.id);
          }
        }
        if (state.pagesOpen) {
          state.pagesOpen = false;
          renderPagesPanel();
          render();
        }
        if (state.openId && !state.draft) {
          state.openId = null;
          render();
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === document.documentElement) return;
      hoverBox.style.display = "none";
      startDraft(el, e.clientX, e.clientY);
    },
    true,
  );

  document.addEventListener(
    "mousemove",
    (e) => {
      if (state.mode !== "comment" || state.draft || insideUI(e)) {
        hoverBox.style.display = "none";
        return;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === state.hoverEl) return;
      state.hoverEl = el;
      const r = el.getBoundingClientRect();
      Object.assign(hoverBox.style, {
        display: "block",
        left: `${r.left + scrollX}px`,
        top: `${r.top + scrollY}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
    },
    true,
  );

  document.addEventListener("keydown", (e) => {
    const typing = e.composedPath().some((n) => n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.isContentEditable);
    if (typing) return;
    if ((e.key === "c" || e.key === "C") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      state.mode = state.mode === "comment" ? "browse" : "comment";
      if (state.mode !== "comment") hoverBox.style.display = "none";
      render();
    } else if (e.key === "Escape") {
      if (state.draft) state.draft = null;
      else if (state.openId) state.openId = null;
      else state.mode = "browse";
      hoverBox.style.display = "none";
      popEl.innerHTML = "";
      render();
    }
  });
  ui.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.draft) {
      state.draft = null;
      popEl.innerHTML = "";
      render();
    }
  });

  // Keep pins glued to their elements while the page reflows, animates or lazy-loads.
  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      state.sections = findSections();
      render();
      if (document.readyState === "complete") registerSections();
    });
  };
  addEventListener("resize", schedule);
  addEventListener("load", schedule);
  new ResizeObserver(schedule).observe(document.body);
  setInterval(() => {
    if (!document.hidden && !state.draft) schedule();
  }, 1500);
  // Pick up comments from other reviewers / the team.
  setInterval(() => {
    if (!document.hidden && !state.draft) load().catch(() => {});
  }, 20000);

  function boot() {
    document.body.appendChild(host);
    const style = document.createElement("style");
    style.textContent = `html.eightreview-commenting, html.eightreview-commenting * { cursor: crosshair !important; }`;
    document.head.appendChild(style);
    state.sections = findSections();
    render();
    load().catch((e) => toast(`Couldn't load comments: ${e.message}`, 5000));
    if (!getName()) askName();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // ---------- styles ----------
  function CSS_TEXT() {
    return `
:host { all: initial; }
* { box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.layer { position: absolute; top: 0; left: 0; }
.sp { flex: 1; }
button { font: inherit; cursor: pointer; }
svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.hover { position: absolute; display: none; outline: 2px solid #0d99ff; outline-offset: 1px; background: rgba(13,153,255,.06); pointer-events: none; border-radius: 2px; }

.toolbar { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; align-items: center; gap: 4px;
  background: #1e1e1e; color: #fff; padding: 6px; border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.3); font-size: 13px; }
.brand { font-weight: 800; padding: 0 10px 0 8px; letter-spacing: -.5px; color: #0d99ff; }
.tb { display: flex; align-items: center; gap: 6px; background: transparent; color: #fff; border: 0; border-radius: 9px; padding: 8px 12px; }
.tb:hover { background: #333; }
.tb.on { background: #0d99ff; }
.count { min-width: 14px; text-align: center; }
.tb:disabled { opacity: .3; cursor: default; background: transparent; }
.pager { display: flex; align-items: center; }
.arrow { padding: 6px 9px; font-size: 18px; line-height: 1; }
.pg { max-width: 220px; }
.pg-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pg-n { color: #999; font-size: 12px; }
.tb.on .pg-n { color: #e6f4ff; }
.divider { width: 1px; height: 22px; background: #444; margin: 0 4px; }
.pages-panel { position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%); width: min(360px, calc(100vw - 24px)); max-height: 60vh;
  overflow-y: auto; background: #fff; color: #1e1e1e; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.3); padding: 10px; font-size: 13px; }
.pages-panel[hidden] { display: none; }
.pp-h { display: flex; align-items: center; padding: 4px 6px 8px; }
.pp-item { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 8px; color: #1e1e1e; text-decoration: none; }
.pp-item:hover { background: #f5f5f5; }
.pp-item.cur { background: #e8f4ff; font-weight: 600; }
.pp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-item .n, .chip .n { background: #f24822; color: #fff; border-radius: 9px; padding: 0 6px; font-weight: 700; font-size: 11px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #d4d4d4; flex: none; }
.dot.approved { background: #14ae5c; }
.dot.needs_edits { background: #f5a524; }
.dot.in_progress { background: #0d99ff; }
.link.light { color: #7cc4ff; font-size: 13px; text-decoration: none; margin-left: 6px; }
.progress { padding: 0 10px; color: #bbb; font-size: 12px; white-space: nowrap; }
.progress.done { color: #4ade80; }
.progress:empty { display: none; }

.pin { position: absolute; transform: translate(-4px, -100%); display: flex; align-items: center; gap: 4px; padding: 3px 8px 3px 3px;
  background: #fff; border: 0; border-radius: 16px 16px 16px 2px; box-shadow: 0 2px 8px rgba(0,0,0,.25); font-size: 12px; color: #1e1e1e; }
.pin b { font-weight: 700; }
.pin:hover, .pin.active { box-shadow: 0 0 0 2px #0d99ff, 0 4px 12px rgba(0,0,0,.3); }
.pin.resolved { opacity: .55; }
.av { width: 22px; height: 22px; border-radius: 50%; color: #fff; display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; flex: none; }

.chip { position: absolute; transform: translateX(-100%); display: flex; align-items: center; gap: 4px; background: rgba(30,30,30,.92);
  color: #fff; border-radius: 10px; padding: 4px; font-size: 12px; box-shadow: 0 4px 14px rgba(0,0,0,.2); max-width: calc(100vw - 24px); }
.chip .lbl { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px; color: #ccc; }
.chip .n { background: #f24822; border-radius: 9px; padding: 0 6px; font-weight: 700; font-size: 11px; }
.chip button { border: 0; border-radius: 7px; padding: 5px 9px; background: #333; color: #fff; font-size: 12px; white-space: nowrap; }
.chip button:hover { background: #444; }
.chip button[data-act=approve].on { background: #14ae5c; }
.chip button[data-act=edits].on { background: #f5a524; color: #1e1e1e; }
.chip.approved { box-shadow: 0 0 0 2px #14ae5c, 0 4px 14px rgba(0,0,0,.2); }
.chip.needs_edits { box-shadow: 0 0 0 2px #f5a524, 0 4px 14px rgba(0,0,0,.2); }
@media (max-width: 700px) { .chip .lbl { display: none; } }

.pop { position: absolute; }
.card { background: #fff; color: #1e1e1e; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.25), 0 0 0 1px rgba(0,0,0,.06);
  padding: 12px; font-size: 13px; line-height: 1.45; }
.th-h { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #666; margin: -2px 0 8px; }
.icon { border: 0; background: transparent; width: 28px; height: 28px; border-radius: 6px; color: #444; font-size: 14px; }
.icon:hover { background: #f0f0f0; }
.msg { display: flex; gap: 8px; padding: 6px 0; }
.msg + .msg { border-top: 1px solid #f0f0f0; }
.who { font-weight: 600; font-size: 13px; }
.who time { font-weight: 400; color: #888; font-size: 12px; margin-left: 4px; }
.body { white-space: pre-wrap; word-break: break-word; }
.target { font-size: 12px; color: #555; background: #f6f6f6; border-radius: 6px; padding: 6px 8px; margin-bottom: 8px;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.target span { color: #999; }
textarea, input { width: 100%; border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; font-size: 13px; resize: vertical; color: #1e1e1e; background: #fff; }
textarea:focus, input:focus { outline: 2px solid #0d99ff; border-color: transparent; }
.row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.reply { display: flex; gap: 6px; margin-top: 8px; align-items: flex-end; }
.btn { border: 0; border-radius: 8px; padding: 8px 14px; font-weight: 600; font-size: 13px; }
.btn.sm { padding: 6px 12px; font-size: 12px; }
.btn.primary { background: #0d99ff; color: #fff; }
.btn.primary:disabled { opacity: .6; }
.btn.ghost { background: #f3f0ff; color: #6d28d9; }
.btn.ghost:hover { background: #ebe5ff; }

.copy { margin-top: 6px; border: 1px solid #e9e3ff; background: #faf8ff; border-radius: 8px; padding: 8px; }
.copy-h { font-size: 11px; font-weight: 700; color: #6d28d9; text-transform: uppercase; letter-spacing: .3px; }
.copy-new { margin-top: 4px; white-space: pre-wrap; }
.copy-why { margin-top: 4px; font-size: 12px; color: #666; }
.copy details { margin-top: 6px; font-size: 12px; color: #666; }
.copy-old { white-space: pre-wrap; margin-top: 4px; }
.ai-h { font-size: 12px; color: #555; margin: 8px 0 6px; }
.ai-load { display: flex; align-items: center; gap: 8px; color: #6d28d9; font-size: 12px; margin-top: 8px; }
.spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #ddd6fe; border-top-color: #6d28d9; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.variant { display: block; width: 100%; text-align: left; background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 8px; margin-bottom: 6px; color: #1e1e1e; }
.variant:hover { border-color: #a78bfa; }
.variant.on { border-color: #6d28d9; box-shadow: 0 0 0 1px #6d28d9; background: #faf8ff; }
.v-text { display: block; white-space: pre-wrap; }
.v-why { display: block; margin-top: 4px; font-size: 11px; color: #777; }
.ai-tip { font-size: 12px; color: #555; }

.sidebar { position: fixed; top: 0; right: 0; bottom: 0; width: min(340px, 100vw); background: #fff; color: #1e1e1e; overflow-y: auto;
  box-shadow: -8px 0 30px rgba(0,0,0,.15); padding: 12px 12px 90px; font-size: 13px; }
.sb-h { display: flex; align-items: center; gap: 8px; font-size: 14px; position: sticky; top: -12px; background: #fff; padding: 6px 0; }
.tog { font-size: 12px; color: #555; display: flex; align-items: center; gap: 4px; }
.tog input { width: auto; }
.sb-name { font-size: 12px; color: #666; margin: 4px 0 10px; }
.link { border: 0; background: none; color: #0d99ff; padding: 0; font-size: 12px; }
.sb-sec { font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: #888; margin: 14px 0 4px; font-weight: 700; }
.sb-item { display: flex; gap: 8px; width: 100%; text-align: left; border: 0; background: #fff; border-radius: 8px; padding: 8px; color: #1e1e1e; }
.sb-item:hover { background: #f5f5f5; }
.sb-item.resolved { opacity: .55; }
.sb-item .body { font-size: 12px; color: #444; }
.hint { font-size: 11px; color: #999; margin-top: 2px; }
.empty { color: #777; }
kbd { border: 1px solid #ccc; border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; font-size: 11px; }

.toast { position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%); background: #1e1e1e; color: #fff; padding: 8px 14px;
  border-radius: 8px; font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,.25); max-width: calc(100vw - 32px); }
.modal { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; padding: 16px; }
.modal[hidden], .toast[hidden], .sidebar[hidden], .pop[hidden] { display: none; }
.name-card { width: min(360px, 100%); display: grid; gap: 10px; padding: 20px; }
.name-card h3 { margin: 0; font-size: 17px; }
.name-card p { margin: 0; color: #555; }
@media (max-width: 560px) { .tb span:not(.count):not(.pg-n) { display: none; } .toolbar { bottom: 12px; } .pages-panel { bottom: 68px; } }
`;
  }
})();
