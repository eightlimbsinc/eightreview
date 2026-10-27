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
  const VERSION = "2026-10-28.1"; // keep in sync with netlify/functions/_lib/version.mjs
  const PROJECT = CFG.project;
  const SIBLINGS = CFG.pages || [];
  const pageIndex = SIBLINGS.findIndex((p) => p.id === PAGE);
  const TEAM_QS = new URLSearchParams(location.search).has("team") ? "?team=1" : "";
  // Blank wireframe pages open in the side-by-side view (/c/), others in the plain review (/r/).
  const reviewUrl = (id) => {
    const p = (CFG.pages || []).find((x) => x.id === id);
    return `${API}/${p?.blank ? "c" : "r"}/${id}${TEAM_QS}`;
  };
  // Inside the side-by-side view we're in an iframe: page changes should move the whole view.
  const go = (url) => ((window.top !== window ? window.top : window).location.href = url);
  const urlKey = (u) => {
    try {
      const x = new URL(u, location.href);
      return (x.host + x.pathname.replace(/\/+$/, "")).toLowerCase();
    } catch {
      return "";
    }
  };
  const TEAM_REQUESTED = new URLSearchParams(location.search).has("team");
  const adminToken = () => {
    try {
      return localStorage.getItem("eightreview:admin") || "";
    } catch {
      return "";
    }
  };
  const siblingByUrl = new Map(SIBLINGS.map((p) => [urlKey(p.url), p]));

  const state = {
    comments: [],
    statuses: {},
    sections: [],
    mode: "browse", // "browse" | "comment" | "pick" (team: choose an area to highlight)
    pick: null, // { el, history: [] } while choosing an area
    showResolved: false,
    showSections: true,
    sidebar: false,
    flags: {}, // sections the team flagged for review
    team: false, // team mode: can flag sections
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
      headers: { "content-type": "application/json", "x-admin-token": adminToken(), ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {}
    if (!res.ok) {
      const what = `${opts.method || "GET"} ${path.split("?")[0]}`;
      console.error("[EightReview]", what, res.status, text.slice(0, 500));
      throw new Error(data.error || `Request failed (${res.status}) on ${what}${text ? `: ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)}` : ""}`);
    }
    return data;
  }

  // ---------- blank wireframe ----------
  // Copy becomes grey placeholder bars in exactly the same place, so the layout (and every
  // comment anchor) matches the live page. Original text stays in the DOM, just invisible.
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "OPTION", "TITLE"]);
  function blankify(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || !n.nodeValue.trim() || SKIP.has(p.tagName) || p.classList.contains("er-blank") || p.closest("svg")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const span = document.createElement("span");
      span.className = "er-blank";
      n.parentNode.insertBefore(span, n);
      span.appendChild(n);
    }
  }
  if (CFG.blank) {
    const run = () => blankify(document.body);
    if (document.body) run();
    document.addEventListener("DOMContentLoaded", run);
    let t = 0;
    // Sliders, tabs and lazy content add text later.
    new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(run, 120);
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
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
      })
      .concat(customAreas());
  }

  // Areas the team picked by hand (any block on the page), stored with the flag.
  function customAreas() {
    const out = [];
    for (const [key, f] of Object.entries(state.flags)) {
      if (!f.anchor) continue;
      const el = resolveAnchor(f.anchor);
      if (el) out.push({ el, key, label: f.label || "Highlighted area", heading: el.querySelector("h1, h2, h3, h4"), custom: true });
    }
    return out;
  }

  // Innermost area containing the element, so comments inside a hand-picked area belong to it.
  const sectionOf = (el) => {
    const hits = state.sections.filter((s) => s.el.contains(el));
    return hits.find((s) => !hits.some((o) => o !== s && s.el.contains(o.el))) || hits[0];
  };

  // ---------- shadow UI ----------
  const host = document.createElement("div");
  host.id = "eightreview-root";
  host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483000;";
  const ui = host.attachShadow({ mode: "open" });
  ui.innerHTML = `<style>${CSS_TEXT()}</style>
    <div class="layer">
      <div class="hover"></div>
      <div class="focus-box" hidden></div>
      <div class="connector" hidden><svg><line/><circle r="4"/></svg></div>
      <div class="hls"></div>
      <div class="chips"></div>
      <div class="pins"></div>
      <div class="pop"></div>
    </div>
    <aside class="sidebar" hidden></aside>
    <div class="pages-panel" hidden></div>
    <div class="toolbar">
      <button class="brand" data-act="about" title="EightReview v${VERSION}">8R</button>
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
      <button class="tb pick-btn" data-act="pick" title="Team: pick any block on the page to highlight for review" hidden>
        <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/></svg><span>Highlight area</span>
      </button>
      <button class="tb" data-act="sidebar" title="All comments">
        <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg><span class="count">0</span>
      </button>
      <span class="progress" title="Sections reviewed"></span>
      <span class="team-pill" hidden title="You're in team mode: flag the sections the client should review">Team</span>
    </div>
    <div class="pickbar" hidden></div>
    <div class="toast" hidden></div>
    <div class="modal" hidden></div>`;

  const layer = $(".layer");
  const hoverBox = $(".hover");
  const focusBox = $(".focus-box");
  const connector = $(".connector");
  const pinsEl = $(".pins");
  const chipsEl = $(".chips");
  const hlsEl = $(".hls");
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

  const hasFlags = () => Object.keys(state.flags).length > 0;
  // Sections the client is asked to review: the flagged ones, or all of them if none are flagged.
  const reviewTargets = () => (hasFlags() ? state.sections.filter((s) => state.flags[s.key]) : state.sections);

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
    hlsEl.innerHTML = "";
    if (state.showSections) {
      const focus = hasFlags();
      for (const s of state.sections) {
        const r = s.el.getBoundingClientRect();
        if (!r.height) continue;
        const flag = state.flags[s.key];
        // Once the team flags sections, the client only sees those.
        if (focus && !flag && !state.team) continue;
        const st = state.statuses[s.key]?.status;
        const open = state.comments.filter((c) => c.sectionKey === s.key && !c.resolved).length;

        if (flag) {
          const hl = document.createElement("div");
          hl.className = `hl ${st || "waiting"}`;
          Object.assign(hl.style, {
            left: `${r.left + scrollX}px`,
            top: `${r.top + scrollY}px`,
            width: `${r.width}px`,
            height: `${r.height}px`,
          });
          const tag = st === "approved" ? "✓ Approved" : st === "needs_edits" ? "✎ Edits requested" : "● Needs your review";
          hl.innerHTML = `<span class="hl-tag">${tag}${flag.note && !st ? ` · ${esc(flag.note)}` : ""}</span>`;
          hlsEl.appendChild(hl);
        }

        const chip = document.createElement("div");
        chip.className = `chip ${st || ""}${flag ? " flagged" : ""}`;
        // Flagged: sit just above the highlight so the buttons don't cover the copy being reviewed.
        chip.style.top = `${Math.max(4, r.top + scrollY + (flag ? -38 : 12))}px`;
        chip.style.left = `${Math.max(12, r.right + scrollX - (flag ? 0 : 12))}px`;
        chip.dataset.key = s.key;
        chip.innerHTML = `<span class="lbl" title="${esc(s.label)}">${esc(s.label)}</span>
          ${open ? `<span class="n">${open}</span>` : ""}
          ${state.team && flag && st ? `<button data-act="reflag" title="Copy updated? Reset this section to 'Needs your review'">↺ Ask again</button>` : ""}
          ${state.team ? `<button data-act="flag" class="flag-btn${flag ? " on" : ""}" title="${flag ? "Stop asking the client to review this section" : "Highlight this section for the client to review"}">${flag ? "● Flagged" : "○ Flag for review"}</button>` : ""}
          <button data-act="approve" class="${st === "approved" ? "on" : ""}" title="Approve this section">✓ Approve</button>
          <button data-act="edits" class="${st === "needs_edits" ? "on" : ""}" title="Request edits">✎ Needs edits</button>`;
        chipsEl.appendChild(chip);
      }
    }

    renderPopover();
    if (state.sidebar) renderSidebar();

    const targets = reviewTargets();
    const reviewed = targets.filter((s) => state.statuses[s.key]).length;
    const prog = $(".progress");
    prog.textContent = targets.length ? `${reviewed}/${targets.length} ${hasFlags() ? "to review" : "sections"}` : "";
    prog.classList.toggle("done", reviewed && reviewed === targets.length);
    $(".team-pill").hidden = !state.team;
    const pickBtn = $('.toolbar [data-act="pick"]');
    pickBtn.hidden = !state.team;
    pickBtn.classList.toggle("on", state.mode === "pick");
    hoverBox.classList.toggle("pick", state.mode === "pick");
    $(".count").textContent = state.comments.filter((c) => !c.resolved).length;
    $('.toolbar [data-act="mode"]').classList.toggle("on", state.mode === "comment");
    $('.toolbar [data-act="sections"]').classList.toggle("on", state.showSections);
    $('.toolbar [data-act="sidebar"]').classList.toggle("on", state.sidebar);
    $('.toolbar [data-act="pages"]')?.classList.toggle("on", state.pagesOpen);
    if (reviewed && reviewed === targets.length && !state.nudged && load.done && !state.team) nudgeNext();
    document.documentElement.classList.toggle("eightreview-commenting", state.mode === "comment" || state.mode === "pick");
  }

  const GAP = 32;

  function hideFocus() {
    if (state.pick) return;
    focusBox.hidden = true;
    connector.hidden = true;
    popEl.classList.remove("sheet");
  }

  // Put the comment box beside the element it's about (right, else left, else below),
  // outline the element, and draw a line from the pin to the box.
  function placePopover(el, point) {
    const r = el.getBoundingClientRect();
    const box = { left: r.left + scrollX, top: r.top + scrollY, right: r.right + scrollX, bottom: r.bottom + scrollY };
    Object.assign(focusBox.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    focusBox.hidden = false;

    // Phones: no room beside anything, so use a bottom sheet above the toolbar.
    if (innerWidth < 700) {
      popEl.classList.add("sheet");
      popEl.style.cssText = "";
      connector.hidden = true;
      return;
    }
    popEl.classList.remove("sheet");

    const w = Math.min(340, innerWidth - 24);
    const h = popEl.offsetHeight || 220;
    const vLeft = scrollX + 12;
    const vRight = scrollX + innerWidth - 12;
    const vTop = scrollY + 12;
    const vBottom = scrollY + innerHeight - 84; // keep clear of the toolbar
    const clampY = (y) => Math.max(vTop, Math.min(y, Math.max(vTop, vBottom - h)));

    let left, top, side;
    if (box.right + GAP + w <= vRight) {
      side = "right";
      left = box.right + GAP;
      top = clampY(point.y - 28);
    } else if (box.left - GAP - w >= vLeft) {
      side = "left";
      left = box.left - GAP - w;
      top = clampY(point.y - 28);
    } else {
      side = "below";
      left = Math.max(vLeft, Math.min(point.x - w / 2, vRight - w));
      top = box.bottom + GAP;
      // Element too tall to see the box below it: dock beside the click point on the emptier side.
      if (top > vBottom - 80) {
        side = point.x > scrollX + innerWidth / 2 ? "dock-left" : "dock-right";
        left = side === "dock-left" ? vLeft : vRight - w;
        top = clampY(point.y - 28);
      }
    }
    popEl.style.left = `${left}px`;
    popEl.style.top = `${top}px`;
    popEl.style.width = `${w}px`;

    // Connector: from the pin to the nearest edge of the box.
    let x2, y2;
    if (side === "below") {
      x2 = Math.max(left + 16, Math.min(point.x, left + w - 16));
      y2 = top;
    } else {
      const onRight = side === "right" || side === "dock-right";
      x2 = onRight ? left : left + w;
      y2 = Math.max(top + 20, Math.min(point.y, top + h - 20));
    }
    const minX = Math.min(point.x, x2) - 6;
    const minY = Math.min(point.y, y2) - 6;
    Object.assign(connector.style, {
      left: `${minX}px`,
      top: `${minY}px`,
      width: `${Math.abs(point.x - x2) + 12}px`,
      height: `${Math.abs(point.y - y2) + 12}px`,
    });
    const line = connector.querySelector("line");
    line.setAttribute("x1", point.x - minX);
    line.setAttribute("y1", point.y - minY);
    line.setAttribute("x2", x2 - minX);
    line.setAttribute("y2", y2 - minY);
    const dot = connector.querySelector("circle");
    dot.setAttribute("cx", point.x - minX);
    dot.setAttribute("cy", point.y - minY);
    connector.hidden = false;
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
      hideFocus();
      return;
    }
    const el = resolveAnchor(c.anchor);
    const p = el && docPoint(el, c.anchor.xPct, c.anchor.yPct);
    if (!p) {
      popEl.hidden = true;
      hideFocus();
      return;
    }
    // Don't clobber a reply the reviewer is typing when a background refresh re-renders.
    const typing =
      popEl.dataset.for === c.id &&
      (popEl.querySelector("textarea")?.value || popEl.contains(ui.activeElement));
    if (typing) return placePopover(el, p);

    popEl.hidden = false;
    popEl.dataset.for = c.id;
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
    placePopover(el, p);
  }

  function renderDraft() {
    const d = state.draft;
    popEl.hidden = false;
    popEl.dataset.for = "draft";
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
    setTimeout(() => ta.focus({ preventScroll: true }), 0);
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
    if (d.el.isConnected) placePopover(d.el, { x: d.x, y: d.y });
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
        ${PROJECT ? `<a class="link" href="${API}/p/${PROJECT.id}" target="_top">Overview</a>` : ""}</div>
      <div class="pp-list">${rows
        .map(
          (p, i) => `<a class="pp-item${p.id === PAGE ? " cur" : ""}" href="${reviewUrl(p.id)}" target="_top">
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
      ? `All sections on this page reviewed. <a class="link light" href="${reviewUrl(next.id)}" target="_top">Next: ${esc(next.name)} →</a>`
      : `All sections on this page reviewed. ${PROJECT ? `<a class="link light" href="${API}/p/${PROJECT.id}" target="_top">Back to all pages →</a>` : ""}`;
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

  // ---------- team: highlight any area ----------
  const pickbar = $(".pickbar");

  function choosePick(el) {
    state.pick = { el, history: [] };
    renderPick();
  }

  function renderPick() {
    const p = state.pick;
    if (!p) {
      pickbar.hidden = true;
      if (!state.draft && !state.openId) hideFocus();
      return;
    }
    const r = p.el.getBoundingClientRect();
    Object.assign(focusBox.style, {
      left: `${r.left + scrollX}px`,
      top: `${r.top + scrollY}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    focusBox.hidden = false;
    focusBox.classList.add("pick");
    const text = cleanText(p.el);
    const keepNote = pickbar.querySelector("input")?.value;
    pickbar.hidden = false;
    pickbar.innerHTML = `<div class="pb-row"><b>Highlight this area?</b>
        <span class="pb-what">${esc(p.el.tagName.toLowerCase())} · ${Math.round(r.width)}×${Math.round(r.height)} · “${esc(text.slice(0, 50))}${text.length > 50 ? "…" : ""}”</span></div>
      <div class="pb-row">
        <button class="btn light sm" data-act="pick-bigger" title="Select the surrounding block">⬆ Bigger</button>
        <button class="btn light sm" data-act="pick-smaller" ${p.history.length ? "" : "disabled"} title="Go back to the smaller block">⬇ Smaller</button>
        <input class="pb-note" placeholder="Note for the client (optional)" value="${esc(keepNote ?? "Please review this section")}">
        <button class="btn primary sm orange" data-act="pick-save">Highlight for review</button>
        <button class="btn light sm" data-act="pick-cancel">Cancel</button>
      </div>`;
  }

  function endPick() {
    state.pick = null;
    state.mode = "browse";
    focusBox.classList.remove("pick");
    renderPick();
    render();
  }

  async function savePick() {
    const el = state.pick.el;
    const heading = el.matches("h1, h2, h3, h4") ? el : el.querySelector("h1, h2, h3, h4");
    const label = (cleanText(heading) || cleanText(el)).slice(0, 60) || "Highlighted area";
    const key = `area-${Math.random().toString(36).slice(2, 10)}`;
    const note = pickbar.querySelector("input").value.trim();
    const res = await api("/api/flags", {
      method: "POST",
      body: {
        pageId: PAGE,
        sectionKey: key,
        label,
        note,
        flagged: true,
        anchor: { selector: selectorFor(el), text: cleanText(el).slice(0, 120), tag: el.tagName.toLowerCase() },
      },
    });
    state.flags = res.flags;
    state.sections = findSections();
    endPick();
    toast("Area highlighted for the client");
  }

  // ---------- actions ----------
  async function load() {
    const [comments, statuses, flags] = await Promise.all([
      api(`/api/comments?page=${PAGE}`),
      api(`/api/status?page=${PAGE}`),
      api(`/api/flags?page=${PAGE}`).catch(() => ({ flags: {}, admin: false })),
    ]);
    state.comments = comments;
    state.statuses = statuses;
    state.flags = flags.flags || {};
    state.team = TEAM_REQUESTED && flags.admin;
    // Signed-in team members comment under their Google name.
    if (state.team && flags.user?.name && getName() !== flags.user.name) setName(flags.user.name);
    state.sections = findSections(); // hand-picked areas come from the flags
    if (TEAM_REQUESTED && !flags.admin && !load.done) toast("Team mode needs you to sign in on the dashboard first.", 6000);
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
      } else if (act === "pick") {
        if (state.mode === "pick") return endPick();
        state.mode = "pick";
        state.draft = null;
        state.openId = null;
        popEl.innerHTML = "";
        render();
        toast("Click any block on the page to highlight it for review");
      } else if (act === "pick-bigger") {
        const parent = state.pick.el.parentElement;
        if (parent && parent !== document.body && parent !== document.documentElement) {
          state.pick.history.push(state.pick.el);
          state.pick.el = parent;
          renderPick();
        }
      } else if (act === "pick-smaller") {
        if (state.pick.history.length) state.pick.el = state.pick.history.pop();
        renderPick();
      } else if (act === "pick-cancel") {
        endPick();
      } else if (act === "pick-save") {
        await savePick();
      } else if (act === "about") {
        toast(`EightReview v${VERSION}${state.team ? " · Team mode" : ""} · Press C to comment`, 4000);
      } else if (act === "pages") {
        state.pagesOpen = !state.pagesOpen;
        renderPagesPanel();
        render();
      } else if (act === "prev" || act === "next") {
        const target = SIBLINGS[pageIndex + (act === "next" ? 1 : -1)];
        if (target) go(reviewUrl(target.id));
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
      } else if (act === "flag") {
        const key = t.closest(".chip").dataset.key;
        const sec = state.sections.find((x) => x.key === key);
        const flagged = !state.flags[key];
        let note = "";
        if (flagged) {
          note = prompt("Note for the client (optional):", "Please review this section");
          if (note === null) return;
        }
        const res = await api("/api/flags", {
          method: "POST",
          body: { pageId: PAGE, sectionKey: key, label: sec?.label, note: note.trim(), flagged },
        });
        state.flags = res.flags;
        if (flagged) delete state.statuses[key]; // server cleared the old verdict
        render();
        toast(flagged ? "Section highlighted for the client" : "Highlight removed");
      } else if (act === "reflag") {
        const key = t.closest(".chip").dataset.key;
        const res = await api("/api/flags", { method: "POST", body: { pageId: PAGE, sectionKey: key, flagged: true } });
        state.flags = res.flags;
        delete state.statuses[key];
        render();
        toast("Sent back to the client for review");
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
    if ((state.mode !== "comment" && state.mode !== "pick") || insideUI(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  ["mousedown", "mouseup", "pointerdown", "pointerup"].forEach((t) => document.addEventListener(t, block, true));
  document.addEventListener(
    "click",
    (e) => {
      if (insideUI(e)) return;
      if (state.mode === "pick") {
        e.preventDefault();
        e.stopPropagation();
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && el !== document.documentElement && el !== document.body) choosePick(el);
        return;
      }
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
            go(reviewUrl(sib.id));
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
      if ((state.mode !== "comment" && state.mode !== "pick") || state.draft || state.pick || insideUI(e)) {
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
      if (state.mode === "pick") return endPick();
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
      if (state.pick) renderPick();
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
    load()
      .catch((e) => toast(`Couldn't load comments: ${e.message}`, 5000))
      // Ask for a name only after load, so signed-in team members (named from Google) skip it.
      .finally(() => !getName() && askName());
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
.brand { border: 0; background: transparent; border-radius: 8px; padding-top: 6px; padding-bottom: 6px; }
.brand:hover { background: #333; }
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
.hl { position: absolute; pointer-events: none; border-radius: 6px; outline: 3px solid #ffc700; outline-offset: -3px;
  background: rgba(255,199,0,.07); }
.hl.approved { outline: 2px solid #14ae5c; background: rgba(20,174,92,.04); }
.hl.needs_edits { outline-color: #f24822; background: rgba(242,72,34,.05); }
.hl-tag { position: absolute; left: 0; top: -30px; background: #ffc700; color: #1e1e1e; font-size: 12px; font-weight: 700;
  padding: 4px 10px; border-radius: 6px; max-width: calc(100% - 24px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 2px 8px rgba(0,0,0,.2); }
.hl.approved .hl-tag { background: #14ae5c; }
.hl.needs_edits .hl-tag { background: #f24822; color: #fff; }
.hl.approved .hl-tag { color: #fff; }
.chip.flagged { box-shadow: 0 0 0 2px #ffc700, 0 4px 14px rgba(0,0,0,.2); }
.chip button.flag-btn.on { background: #ffc700; color: #1e1e1e; }
.hover.pick { outline-color: #ffc700; background: rgba(255,199,0,.08); }
.focus-box.pick { outline: 3px solid #ffc700; background: rgba(255,199,0,.1); }
.pickbar { position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%); width: min(760px, calc(100vw - 24px)); background: #fff; color: #1e1e1e;
  border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.3); padding: 10px 12px; font-size: 13px; display: grid; gap: 8px; }
.pickbar[hidden] { display: none; }
.pb-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pb-what { color: #777; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.pb-note { flex: 1; min-width: 160px; width: auto; padding: 6px 10px; }
.btn.light { background: #f0f0ec; color: #1e1e1e; }
.btn.light:disabled { opacity: .4; }
.btn.primary.orange { background: #ffc700; color: #1e1e1e; }
.team-pill { background: #ffc700; color: #1e1e1e; font-size: 11px; font-weight: 700; border-radius: 6px; padding: 3px 7px; margin-right: 4px; }
.team-pill[hidden], .tb[hidden] { display: none; }
.chip.approved { box-shadow: 0 0 0 2px #14ae5c, 0 4px 14px rgba(0,0,0,.2); }
.chip.needs_edits { box-shadow: 0 0 0 2px #f5a524, 0 4px 14px rgba(0,0,0,.2); }
@media (max-width: 700px) { .chip .lbl { display: none; } }

.pop { position: absolute; }
.pop.sheet { position: fixed; left: 12px !important; right: 12px; bottom: 76px; top: auto !important; width: auto !important; max-height: 60vh; overflow-y: auto; }
.focus-box { position: absolute; outline: 2px solid #0d99ff; outline-offset: 2px; border-radius: 3px; pointer-events: none; background: rgba(13,153,255,.04); }
.focus-box[hidden], .connector[hidden] { display: none; }
.connector { position: absolute; pointer-events: none; }
.connector svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.connector line { stroke: #0d99ff; stroke-width: 1.5; stroke-dasharray: 4 3; }
.connector circle { fill: #0d99ff; stroke: #fff; stroke-width: 2; }
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
