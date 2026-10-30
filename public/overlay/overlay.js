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
  const VERSION = "2026-10-28.35"; // keep in sync with netlify/functions/_lib/version.mjs
  const PROJECT = CFG.project;
  const SIBLINGS = CFG.pages || [];
  const pageIndex = SIBLINGS.findIndex((p) => p.id === (CFG.rootId || PAGE));
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
  const CURRENT = CFG.rootId || PAGE;

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
    panel: null, // section key whose suggested copy is open
    panelEdit: false,
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
  const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
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

  // Random per-browser id: lets people delete their own comments (and nobody else's).
  const reviewerId = (() => {
    try {
      let id = localStorage.getItem("eightreview:rid");
      if (!id) localStorage.setItem("eightreview:rid", (id = crypto.randomUUID()));
      return id;
    } catch {
      return "";
    }
  })();

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { "content-type": "application/json", "x-admin-token": adminToken(), "x-reviewer-id": reviewerId, ...(opts.headers || {}) },
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

  // Flipping cards: front and back faces sit in the same spot, and the face turned away is hidden
  // with backface-visibility. Work out from the element's 3D transforms whether its face is
  // currently turned away, so a pin on the back isn't shown as if it were on the front.
  function flipFace(el) {
    for (let n = el, i = 0; n && n !== document.body && i < 10; n = n.parentElement, i++) {
      if (getComputedStyle(n).backfaceVisibility === "hidden") return n;
    }
    return null;
  }
  function facingAway(el) {
    const face = el && flipFace(el);
    if (!face) return false;
    let m = new DOMMatrix();
    for (let n = face; n && n !== document.documentElement; n = n.parentElement) {
      const t = getComputedStyle(n).transform;
      if (t && t !== "none") m = new DOMMatrix(t).multiply(m);
    }
    return m.m33 < 0; // the face's normal points away from the viewer
  }

  // The element that rotates a flip card: the nearest 3D container (transform-style: preserve-3d)
  // around the hovered element, else the parent of its card face.
  function flipRotator(el) {
    for (let n = el, i = 0; n && n !== document.body && i < 10; n = n.parentElement, i++) {
      if (getComputedStyle(n).transformStyle === "preserve-3d") return n;
    }
    return flipFace(el)?.parentElement || null;
  }

  function toggleFlip(rot) {
    if (!rot) return;
    if (rot.dataset.erFlipped === "1") {
      rot.style.transform = rot.dataset.erOrig || "";
      rot.dataset.erFlipped = "0";
    } else {
      const cur = getComputedStyle(rot).transform;
      rot.dataset.erOrig = rot.style.transform || "";
      rot.style.transition = "transform .5s";
      rot.style.transform = `${cur && cur !== "none" ? `${cur} ` : ""}rotateY(180deg)`;
      rot.dataset.erFlipped = "1";
    }
    if (state.flipTarget === rot) flipBtn.textContent = rot.dataset.erFlipped === "1" ? "↻ Flip back" : "↻ Flip card";
    setTimeout(schedule, 600);
  }

  function docPoint(el, xPct, yPct) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null; // hidden at this breakpoint
    return { x: r.left + scrollX + r.width * xPct, y: r.top + scrollY + r.height * yPct };
  }

  // Right edge of a section's content: full-width Webflow sections hold a narrower container, and the
  // bar should line up with that rather than hang off the edge of the window.
  function contentRight(s, r) {
    let right = 0;
    for (const root of s.members || [s.el]) {
      for (const el of root.querySelectorAll(":scope > *, :scope > * > *")) {
        const b = el.getBoundingClientRect();
        if (b.width > 40 && b.height > 0 && b.width < r.width - 2) right = Math.max(right, b.right);
      }
    }
    return right || r.right;
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

  const anchorOf = (el) => ({ selector: selectorFor(el), text: cleanText(el).slice(0, 120), tag: el.tagName.toLowerCase() });
  const commonAncestor = (els) => {
    let a = els[0].parentElement || els[0];
    while (a && !els.every((e) => a.contains(e))) a = a.parentElement;
    return a || document.body;
  };
  function unionRect(els) {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const e of els) {
      const x = e.getBoundingClientRect();
      if (!x.width && !x.height) continue;
      l = Math.min(l, x.left);
      t = Math.min(t, x.top);
      r = Math.max(r, x.right);
      b = Math.max(b, x.bottom);
    }
    if (l === Infinity) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
  }
  const rectOf = (s) => (s.members ? unionRect(s.members) : s.el.getBoundingClientRect());

  // Areas the team picked by hand (any block on the page), stored with the flag.
  function customAreas() {
    const out = [];
    for (const [key, f] of Object.entries(state.flags)) {
      if (f.members?.length) {
        // A dragged group of cards: the highlight wraps whatever those cards are at this screen size.
        const members = f.members.map(resolveAnchor).filter(Boolean);
        if (members.length) {
          out.push({ el: commonAncestor(members), members, key, label: f.label || "Highlighted cards", heading: null, custom: true });
        }
        continue;
      }
      if (!f.anchor) continue;
      const el = resolveAnchor(f.anchor);
      if (el) out.push({ el, key, label: f.label || "Highlighted area", heading: el.querySelector("h1, h2, h3, h4"), custom: true });
    }
    return out;
  }

  // Innermost area containing the element, so comments inside a hand-picked area belong to it.
  const sectionOf = (el) => {
    const group = state.sections.find((s) => s.members?.some((m) => m.contains(el)));
    if (group) return group;
    const hits = state.sections.filter((s) => !s.members && s.el.contains(el));
    return hits.find((s) => !hits.some((o) => o !== s && s.el.contains(o.el))) || hits[0];
  };

  // ---------- switchers on blank pages ----------
  // A blank page is frozen (the glass sheet takes the mouse), so tabs and "click a title, the card
  // changes" lists can't be clicked. In browse mode a click on something clickable is passed through,
  // and each switcher gets a numbered bar showing which card is loaded, to change it from there.
  const TAB_ITEM = ".w-tab-link, [role=tab]";
  const custom = new Map(); // container -> { items, active } for click lists without tab markup
  let switcherList = [];

  // Look-alike siblings: same tag and the same first class (state classes like "is-active" vary).
  const twinsOf = (e) =>
    [...e.parentElement.children].filter((c) => c.tagName === e.tagName && (c.classList[0] || "") === (e.classList[0] || ""));

  // The one item carrying a class the others don't (is-active, w--current…), or -1.
  function activeIndex(items) {
    const odd = items.map((el) => [...el.classList].filter((c) => !items.every((o) => o.classList.contains(c))).length);
    const marked = odd.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
    return marked.length === 1 ? marked[0] : -1;
  }

  // Click lists with no tab markup: 2+ look-alike siblings with a hand cursor, exactly one marked
  // active. Found on load; a list that marks nothing is learned the first time an item is pressed.
  function findCustomSwitchers() {
    for (const el of document.querySelectorAll("body *")) {
      const parent = el.parentElement;
      if (!parent || custom.has(parent) || host.contains(el) || el.closest(".w-tab-menu, [role=tablist]")) continue;
      if (parent.firstElementChild !== el || parent.children.length < 2) continue;
      const items = twinsOf(el);
      if (items.length < 2 || items.length !== parent.children.length) continue;
      if (getComputedStyle(el).cursor !== "pointer" || el.closest("nav, header, footer")) continue;
      if (activeIndex(items) >= 0) custom.set(parent, { items, active: -1 });
    }
  }

  // The switcher's whole component (titles plus the card beside them): the Webflow Tabs block, or
  // the nearest ancestor of the titles that is clearly wider than them.
  function scopeOf(menu) {
    const tabs = menu.closest(".w-tabs");
    if (tabs) return tabs;
    const w = menu.getBoundingClientRect().width;
    let e = menu.parentElement;
    for (let i = 0; e && e !== document.body && i < 6; e = e.parentElement, i++) {
      if (e.getBoundingClientRect().width >= w * 1.5) return e;
    }
    return menu.parentElement;
  }

  // Which card (1, 2, …) of a switcher an element belongs to: the loaded one, if the element sits in
  // the switcher's card area. Blank pages only.
  function cardFor(el) {
    if (!CFG.blank || !el) return null;
    const g = switchers().find((x) => x.scope.contains(el) && !x.menu.contains(el));
    return g && g.active >= 0 ? g.active + 1 : null;
  }

  // The switcher a commented element belongs to, wherever its card is loaded.
  const switcherOf = (el) => el && switcherList.find((x) => x.scope.contains(el) && !x.menu.contains(el));

  function switchers() {
    const out = [];
    for (const menu of document.querySelectorAll(".w-tab-menu, [role=tablist]")) {
      if (host.contains(menu)) continue;
      const items = [...menu.querySelectorAll(TAB_ITEM)].filter((el) => el.getClientRects().length);
      if (items.length < 2) continue;
      const active = items.findIndex((el) => el.classList.contains("w--current") || el.getAttribute("aria-selected") === "true");
      out.push({ menu, items, active, scope: scopeOf(menu) });
    }
    for (const [menu, g] of custom) {
      if (!menu.isConnected || out.some((o) => o.menu.contains(menu) || menu.contains(o.menu))) continue;
      const items = g.items.filter((el) => el.isConnected);
      const marked = activeIndex(items);
      out.push({ menu, items, active: marked >= 0 ? marked : g.active, scope: scopeOf(menu) });
    }
    return out;
  }

  // The thing a click on a frozen page should press: a link, button, tab or anything with a hand cursor.
  function clickTarget(el) {
    for (let e = el, i = 0; e && e !== document.body && i < 6; e = e.parentElement, i++) {
      if (e.matches(`a, button, ${TAB_ITEM}, [onclick]`) || getComputedStyle(e).cursor === "pointer") return e;
    }
    return null;
  }

  // Remember which item of a click list was pressed: the nearest ancestor with look-alike siblings.
  function learnSwitch(target) {
    for (let e = target; e && e.parentElement && e !== document.body; e = e.parentElement) {
      if (e.closest(".w-tab-menu, [role=tablist]")) return;
      const twins = twinsOf(e);
      if (twins.length >= 2) return void custom.set(e.parentElement, { items: twins, active: twins.indexOf(e) });
    }
  }

  function pressOnPage(target) {
    const a = target.closest("a[href]");
    const href = a?.getAttribute("href") || "";
    const leaves = a && !href.startsWith("#") && !href.startsWith("javascript:") && new URL(a.href, location.href).pathname !== location.pathname;
    if (leaves) return toast("Links to other pages are off on the blank page");
    learnSwitch(target);
    target.click();
    // Let the page swap the card (and any animation finish) before redrawing.
    setTimeout(render, 60);
    setTimeout(render, 600);
  }

  let scanned = false;
  if (CFG.blank) addEventListener("load", () => setTimeout(render, 300));

  function renderSwitchers() {
    // Hand cursors are only reliable once the page's CSS has loaded.
    if (CFG.blank && !scanned && document.readyState === "complete") {
      scanned = true;
      findCustomSwitchers();
    }
    switcherList = CFG.blank ? switchers() : [];
    switchersEl.innerHTML = switcherList
      .map(({ menu, items, active, scope }, g) => {
        const r = menu.getBoundingClientRect();
        if (!r.height) return "";
        const counts = {};
        for (const c of state.comments) {
          if (!c.card || c.resolved) continue;
          const el = resolveAnchor(c.anchor);
          if (el && scope.contains(el)) counts[c.card] = (counts[c.card] || 0) + 1;
        }
        return `<div class="switcher" style="left:${r.left + scrollX}px;top:${Math.max(4, r.top + scrollY - 34)}px">
          <span>${active >= 0 ? `Showing card <b>${active + 1}</b> of ${items.length}` : `${items.length} cards`}</span>
          ${items
            .map((_, i) => {
              const n = counts[i + 1];
              return `<button data-act="switch" data-g="${g}" data-i="${i}" class="${i === active ? "on" : ""}" title="Load card ${i + 1}${n ? ` · ${n} comment${n > 1 ? "s" : ""}` : ""}">${i + 1}${n ? `<i>${n}</i>` : ""}</button>`;
            })
            .join("")}
        </div>`;
      })
      .join("");
  }

  // ---------- shadow UI ----------
  const host = document.createElement("div");
  host.id = "eightreview-root";
  host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483000;";
  const ui = host.attachShadow({ mode: "open" });
  ui.innerHTML = `<style>${CSS_TEXT()}</style>
    <div class="glass" hidden></div>
    <div class="layer">
      <div class="hover"></div>
      <button class="flipbtn" data-act="flip" hidden title="Turn this card over">↻ Flip card</button>
      <div class="focus-box" hidden></div>
      <div class="group-outlines"></div>
      <div class="connector" hidden><svg><line/><circle r="4"/></svg></div>
      <div class="hls"></div>
      <div class="chips"></div>
      <div class="switchers"></div>
      <div class="pins"></div>
      <div class="pop"></div>
    </div>
    <aside class="sidebar" hidden></aside>
    <div class="pages-panel" hidden></div>
    <div class="toolbar">
      <button class="brand" data-act="about" title="EightReview v${VERSION}"><img src="${API}/brand/mark-64.png" alt="Eight Limbs"><span class="ver">v${VERSION.slice(5)}</span></button>
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
      <button class="tb" data-act="sidebar" title="Comment history: every comment and reply, with dates">
        <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg><span>History</span><span class="count">0</span>
      </button>
      <span class="progress" title="Sections reviewed"></span>
      <span class="team-pill" hidden title="You're in team mode: flag the sections the client should review">Team</span>
    </div>
    <div class="pickbar" hidden></div>
    <aside class="sugg" hidden></aside>
    <div class="sugg-arrow" hidden><svg><defs><marker id="er-ah" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#ffc700"/></marker></defs><line marker-end="url(#er-ah)"/></svg></div>
    <div class="band" hidden></div>
    <div class="toast" hidden></div>
    <div class="modal" hidden></div>`;

  const layer = $(".layer");
  const hoverBox = $(".hover");
  // While commenting or highlighting, a transparent sheet over the page takes the mouse, so hover
  // effects (flipping cards, menus) don't fire under the cursor. Mouse/trackpad devices only.
  const glass = $(".glass");
  const flipBtn = $(".flipbtn");
  const canHover = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const focusBox = $(".focus-box");
  const connector = $(".connector");
  const pinsEl = $(".pins");
  const chipsEl = $(".chips");
  const hlsEl = $(".hls");
  const switchersEl = $(".switchers");
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

  // Sections the client is asked to review: the flagged ones, or all of them if none are flagged.
  const reviewTargets = () => state.sections.filter((s) => state.flags[s.key]);

  // ---------- render ----------
  function render() {
    const visible = state.comments.filter((c) => state.showResolved || !c.resolved);
    const placed = [];
    pinsEl.innerHTML = "";
    renderSwitchers();
    for (const c of visible) {
      const el = resolveAnchor(c.anchor);
      const p = el && docPoint(el, c.anchor.xPct, c.anchor.yPct);
      c._hidden = !p;
      // Cards of a switcher can sit on top of each other, so a comment on card 2 would show on card 1.
      const g = c.card && switcherOf(el);
      c._otherCard = Boolean(g && g.active >= 0 && g.active !== c.card - 1);
      if (c._otherCard) c._hidden = true;
      if (c._hidden) continue;
      c._away = facingAway(el);
      placed.push(c);
      const pin = document.createElement("button");
      pin.className = `pin${c.resolved ? " resolved" : ""}${state.openId === c.id ? " active" : ""}${c._away ? " away" : ""}`;
      pin.style.left = `${p.x}px`;
      pin.style.top = `${p.y}px`;
      pin.dataset.id = c.id;
      pin.innerHTML = `${avatar(c.author)}<b>${c.n}</b>${c.card ? `<em>Card ${c.card}</em>` : ""}${c._away ? `<i title="On the other side of this card">↻</i>` : ""}`;
      pin.title = c._away
        ? "This comment is on the other side of a flipping card. Flip the card to see it."
        : `${c.author}: ${c.body || c.copy?.proposed || ""}`.slice(0, 120);
      pinsEl.appendChild(pin);
    }

    chipsEl.innerHTML = "";
    hlsEl.innerHTML = "";
    if (state.showSections) {
      for (const s of state.sections) {
        const r = rectOf(s);
        if (!r.height) continue;
        const flag = state.flags[s.key];
        const st = state.statuses[s.key]?.status;
        // Only highlighted sections get a bar (the team adds them with Highlight area).
        if (!flag) continue;
        const open = state.comments.filter((c) => c.sectionKey === s.key && !c.resolved).length;

        const away = facingAway(s.members?.[0] || s.el);
        if (flag) {
          const hl = document.createElement("div");
          hl.className = `hl ${st || "waiting"}${away ? " away" : ""}`;
          Object.assign(hl.style, {
            left: `${r.left + scrollX}px`,
            top: `${r.top + scrollY}px`,
            width: `${r.width}px`,
            height: `${r.height}px`,
          });
          const tag = st === "approved" ? "✓ Approved" : st === "needs_edits" ? "✎ Edits requested" : "● Needs your review";
          hl.innerHTML = away ? "" : `<span class="hl-tag">${tag}${flag.note && !st ? ` · ${esc(flag.note)}` : ""}</span>`;
          hlsEl.appendChild(hl);
        }

        const chip = document.createElement("div");
        chip.className = `chip ${st || ""}${flag ? " flagged" : ""}`;
        // Flagged: sit just above the highlight so the buttons don't cover the copy being reviewed.
        chip.style.top = `${Math.max(4, r.top + scrollY + (flag ? -38 : 12))}px`;
        chip.style.left = `${Math.max(12, Math.min(flag ? r.right : contentRight(s, r) - 12, innerWidth - 16)) + scrollX}px`;
        chip.dataset.key = s.key;
        if (away) {
          // Turned-away face of a flipping card: a small label instead of the full bar over the front.
          chip.classList.add("away");
          chip.innerHTML = `<span class="lbl" title="${esc(s.label)}">↻ On the back of this card</span>
            <button data-act="flip-section" title="Turn the card over to review this">↻ Flip</button>
            ${state.team && flag ? `<button data-act="flag" class="flag-btn remove" title="Remove this highlight">✕</button>` : ""}`;
          chipsEl.appendChild(chip);
          continue;
        }
        chip.innerHTML = `<span class="lbl" title="${esc(s.label)}">${esc(s.label)}</span>
          ${open ? `<span class="n">${open}</span>` : ""}
          ${suggestButton(s.key, flag)}
          ${state.team && flag && st ? `<button data-act="reflag" title="Copy updated? Reset this section to 'Needs your review'">↺ Ask again</button>` : ""}
          ${!state.team && st ? `<button data-act="undo-status" class="undo" title="Clicked by mistake? Put this section back to 'Needs your review'">↶ Undo</button>` : ""}
          ${state.team
            ? flag
              ? `<button data-act="flag" class="flag-btn remove" title="Remove this highlight (team only). The client will no longer be asked to review it.">✕ Remove highlight</button>`
              : `<button data-act="flag" class="flag-btn" title="Highlight this section for the client to review">○ Flag for review</button>`
            : ""}
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
    prog.textContent = targets.length ? `${reviewed}/${targets.length} to review` : "";
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
    // Blank wireframes freeze hover effects in every mode (cards turn only with "Flip card");
    // live pages behave like the real site except while commenting or highlighting.
    const picking = state.mode === "comment" || state.mode === "pick";
    glass.hidden = !(canHover && (picking || CFG.blank));
    glass.classList.toggle("picking", picking);
    if (glass.hidden) flipBtn.hidden = true;
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
        <span>#${c.n}${c.card ? ` · Card ${c.card}` : ""}${c.sectionLabel ? ` · ${esc(c.sectionLabel)}` : ""}</span>
        <span class="sp"></span>
        <button class="icon" data-act="resolve" title="${c.resolved ? "Reopen" : "Resolve"}">${c.resolved ? "↺" : "✓"}</button>
        ${c.mine || state.team ? `<button class="icon" data-act="delete-comment" title="${c.mine ? "Delete your comment" : "Delete this comment (team)"}">🗑</button>` : ""}
        <button class="icon" data-act="close" title="Close">✕</button>
      </div>
      ${c._away ? `<div class="flip-note">↻ This comment is on the <b>other side</b> of this card. <button class="btn light sm" data-act="flip-comment">↻ Flip it for me</button></div>` : ""}
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
        ${state.team ? `<button type="button" class="btn ghost sm" data-act="seo" title="Rewrite as SEO-friendly copy options (uses AI credit)">✨ SEO-optimize</button>` : ""}
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
    sidebarEl.innerHTML = `<div class="sb-h"><b>Comment history</b><span class="sp"></span>
        <label class="tog"><input type="checkbox" data-act="resolved" ${state.showResolved ? "checked" : ""}> Show resolved</label>
        <button class="icon" data-act="sidebar">✕</button></div>
      <div class="sb-name">Reviewing as <b>${esc(getName() || "—")}</b> <button class="link" data-act="rename">change</button></div>
      ${list.length ? "" : `<p class="empty">No comments yet. Press <kbd>C</kbd> and click anywhere on the page.</p>`}
      ${[...bySection]
        .map(
          ([label, items]) => `<div class="sb-sec">${esc(label)}</div>${items
            .map(
              (c) => `<button class="sb-item${c.resolved ? " resolved" : ""}" data-act="goto" data-id="${c.id}">
              ${avatar(c.author)}<div class="sb-main"><div class="who">#${c.n} ${esc(c.author)}${c.card ? ` <span class="sb-card">Card ${c.card}</span>` : ""}${c.resolved ? ` <span class="sb-done">Resolved</span>` : ""}</div>
              <div class="sb-meta"><time title="${ago(c.createdAt)}">${when(c.createdAt)}</time>${c.viewport ? ` · ${c.viewport < 768 ? "📱" : "🖥"} ${c.viewport}px` : ""}</div>
              ${c.anchor?.text ? `<div class="sb-on">On: “${esc(c.anchor.text.slice(0, 80))}”</div>` : ""}
              <div class="body">${esc(c.body || "")}${c.copy?.proposed ? `<div class="sb-copy">New copy: ${esc(c.copy.proposed)}</div>` : ""}</div>
              ${c._otherCard
                ? `<div class="hint">On card ${c.card} · click to load it</div>`
                : c._hidden ? `<div class="hint">Hidden right now (another screen size, tab or slide)</div>` : ""}
              ${c._away ? `<div class="hint">↻ On the other side of a flipping card</div>` : ""}
              ${c.replies
                .map((r) => `<div class="sb-reply"><b>${esc(r.author)}</b> <time>${when(r.createdAt)}</time><div>${esc(r.body || "")}</div></div>`)
                .join("")}</div></button>`,
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
          (p, i) => `<a class="pp-item${p.id === CURRENT ? " cur" : ""}" href="${reviewUrl(p.id)}" target="_top">
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
    state.pick = { el, members: null, history: [] };
    renderPick();
  }

  function chooseGroup(members) {
    if (members.length === 1) return choosePick(members[0]);
    state.pick = { el: commonAncestor(members), members, history: [] };
    renderPick();
  }

  // Everything fully inside the dragged box, keeping only the outermost elements (the cards).
  function elementsInBand(band) {
    const inside = new Set();
    for (const e of document.body.querySelectorAll("*")) {
      if (e === host || SKIP.has(e.tagName) || e.classList.contains("er-blank")) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.left >= band.left - 4 && r.right <= band.right + 4 && r.top >= band.top - 4 && r.bottom <= band.bottom + 4) inside.add(e);
    }
    return [...inside].filter((e) => !inside.has(e.parentElement)).slice(0, 40);
  }

  const bandEl = $(".band");
  const groupEl = $(".group-outlines");
  function outlineGroup(els) {
    groupEl.innerHTML = (els || [])
      .map((e) => {
        const r = e.getBoundingClientRect();
        return `<div style="left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px"></div>`;
      })
      .join("");
  }

  function renderPick() {
    const p = state.pick;
    if (!p) {
      pickbar.hidden = true;
      if (!state.draft && !state.openId) hideFocus();
      return;
    }
    const r = p.members ? unionRect(p.members) : p.el.getBoundingClientRect();
    outlineGroup(p.members);
    Object.assign(focusBox.style, {
      left: `${r.left + scrollX}px`,
      top: `${r.top + scrollY}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    focusBox.hidden = false;
    focusBox.classList.add("pick");
    const text = p.members ? `${p.members.length} items selected` : cleanText(p.el);
    const keepNote = pickbar.querySelector("input")?.value;
    pickbar.hidden = false;
    pickbar.innerHTML = `<div class="pb-row"><b>Highlight this area?</b>
        <span class="pb-what">${p.members ? `${p.members.length} cards · ` : `${esc(p.el.tagName.toLowerCase())} · `}${Math.round(r.width)}×${Math.round(r.height)} · “${esc(text.slice(0, 50))}${text.length > 50 ? "…" : ""}”</span></div>
      <div class="pb-row">
        <button class="btn light sm" data-act="pick-bigger" title="Select the surrounding block">⬆ Bigger</button>
        <button class="btn light sm" data-act="pick-smaller" ${p.history.length ? "" : "disabled"} title="Go back to the smaller block">⬇ Smaller</button>
        <input class="pb-note" placeholder="Note for the client (optional)" value="${esc(keepNote ?? "Please review this section")}">
        <button class="btn primary sm orange" data-act="pick-save">Highlight for review</button>
        <button class="btn primary sm violet" data-act="pick-save-suggest" title="Highlight it and write recommended SEO/AEO copy the client can approve or edit">Highlight + ✨ suggest copy</button>
        <button class="btn light sm" data-act="pick-cancel">Cancel</button>
      </div>`;
  }

  function endPick() {
    state.pick = null;
    state.mode = "browse";
    focusBox.classList.remove("pick");
    outlineGroup(null);
    renderPick();
    render();
  }

  async function savePick() {
    const { el, members } = state.pick;
    const heading = el.matches("h1, h2, h3, h4") ? el : el.querySelector("h1, h2, h3, h4");
    const base = (cleanText(heading) || cleanText(members?.[0] || el)).slice(0, 50) || "Highlighted area";
    const label = members ? `${members.length} cards · ${base}` : base;
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
        anchor: anchorOf(el),
        members: members ? members.map(anchorOf) : undefined,
      },
    });
    state.flags = res.flags;
    state.sections = findSections();
    endPick();
    toast("Area highlighted for the client");
    return key;
  }

  // ---------- suggested SEO/AEO copy ----------
  // The team asks for recommended copy on a highlighted section; it's written and scored in the
  // background (recommend-background function). The client opens it in a side panel next to the
  // page, with SEO keywords and AEO phrases coloured so they know to keep them.
  const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,a,button,blockquote,figcaption,label,td,th,dt,dd";
  const TAG_NAMES = { h1: "Main heading", h2: "Heading", h3: "Heading", h4: "Small heading", h5: "Small heading", h6: "Small heading",
    p: "Paragraph", li: "List item", a: "Button / link", button: "Button", blockquote: "Quote", figcaption: "Caption", label: "Label" };
  const pending = (r) => r && ["writing", "scoring", "improving"].includes(r.status);
  // Clients see every finished suggestion, never a draft that's still being written, scored or
  // improved. Copy under 4 / 5 on any score gets a note for the team only.
  const TARGET = 80;
  const SCORE_NAMES = { seo: "SEO", aeo: "AEO", brand_voice: "Voice", content_quality: "Quality", overall: "Total" };
  const lowScores = (sec) => Object.keys(SCORE_NAMES).filter((k) => sec?.[k] != null && sec[k] < TARGET);
  const belowTarget = (r) => !r.evaluation?.section || lowScores(r.evaluation.section).length > 0;
  const visibleTo = (r) => r?.items?.length && (state.team || !pending(r));

  function sectionItems(sec) {
    const items = [];
    const seen = new Set();
    for (const root of sec.members || [sec.el]) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (w.nextNode() && items.length < 30) {
        const n = w.currentNode;
        const p = n.parentElement;
        if (!p || !n.nodeValue.trim() || SKIP.has(p.tagName) || p.closest("svg")) continue;
        const block = p.closest(BLOCKS);
        let el = block && root.contains(block) ? block : p.classList.contains("er-blank") ? p.parentElement : p;
        if (seen.has(el) || [...seen].some((o) => o.contains(el))) continue;
        if (!el.getClientRects().length) continue; // hidden at this size (e.g. mobile-only copy)
        const text = cleanText(el);
        if (!text) continue;
        seen.add(el);
        items.push({ tag: el.tagName.toLowerCase(), text: text.slice(0, 800) });
      }
    }
    return items;
  }

  async function rescoreSuggestion(key) {
    state.flags[key].recommendation = { ...state.flags[key].recommendation, status: "scoring", error: "" };
    renderSuggestion();
    const res = await fetch(`${API}/.netlify/functions/recommend-background`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": adminToken() },
      body: JSON.stringify({ pageId: PAGE, sectionKey: key, scoreOnly: true }),
    });
    if (res.status === 401) return toast("Sign in on the dashboard to score copy");
    pollSuggestions();
  }

  async function requestSuggestion(key) {
    const sec = state.sections.find((x) => x.key === key);
    if (!sec) return toast("Couldn't find that section on the page");
    const items = sectionItems(sec);
    if (!items.length) return toast("There's no text in this area to rewrite");
    const flag = state.flags[key];
    flag.recommendation = { status: "writing" };
    render();
    const res = await fetch(`${API}/.netlify/functions/recommend-background`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": adminToken() },
      body: JSON.stringify({ pageId: PAGE, sectionKey: key, label: sec.label, note: flag.note, items }),
    });
    if (res.status === 401) return toast("Sign in on the dashboard to suggest copy");
    toast("Writing SEO/AEO copy… this takes about a minute", 4000);
    pollSuggestions();
  }

  let polling = 0;
  function pollSuggestions() {
    clearTimeout(polling);
    polling = setTimeout(async () => {
      try {
        const res = await api(`/api/flags?page=${PAGE}`);
        state.flags = res.flags || {};
        state.sections = findSections();
        render();
        renderSuggestion();
      } catch {}
      if (Object.values(state.flags).some((f) => pending(f.recommendation))) pollSuggestions();
    }, 3000);
  }

  function suggestButton(key, flag) {
    const r = flag?.recommendation;
    if (visibleTo(r)) {
      const on = state.panel === key ? " on" : "";
      return `<button data-act="sugg-open" class="sugg-btn${on}" title="See the recommended SEO/AEO copy for this section">💡 Suggested copy</button>`;
    }
    if (!state.team || !flag) return "";
    if (pending(r)) return `<button class="sugg-btn busy" disabled>✨ Writing copy…</button>`;
    return `<button data-act="sugg-make" class="sugg-make" title="Write recommended SEO/AEO copy for the client to approve or edit">✨ Suggest copy</button>`;
  }

  // Wrap SEO keywords / AEO phrases in coloured marks (longest first, no overlaps).
  function markText(text, r) {
    const terms = [
      ...(r.seo_keywords || []).map((t) => [t, "seo"]),
      ...(r.aeo_longtail || []).map((t) => [t, "aeo"]),
    ].sort((a, b) => b[0].length - a[0].length);
    if (!terms.length) return esc(text);
    const lower = text.toLowerCase();
    const marks = [];
    for (const [t, kind] of terms) {
      const needle = t.toLowerCase();
      for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + needle.length)) {
        if (!marks.some((m) => i < m.end && i + needle.length > m.start)) marks.push({ start: i, end: i + needle.length, kind });
      }
    }
    marks.sort((a, b) => a.start - b.start);
    let out = "";
    let at = 0;
    for (const m of marks) {
      out += esc(text.slice(at, m.start)) + `<mark class="${m.kind}">${esc(text.slice(m.start, m.end))}</mark>`;
      at = m.end;
    }
    return out + esc(text.slice(at));
  }

  const keptTerms = (r, original) =>
    [...(r.seo_keywords || []), ...(r.aeo_longtail || [])].filter((t) => original.toLowerCase().includes(t.toLowerCase()));

  // Scores are stored out of 100 (the rubric's scale) and shown out of 5, which reads more easily.
  const outOf5 = (n) => (Math.round(n / 2) / 10).toFixed(1);
  const stars = (n) => {
    const full = Math.round(n / 20);
    return `<span class="stars" aria-hidden="true">${"★".repeat(full)}${"☆".repeat(5 - full)}</span>`;
  };
  const scoreChip = (label, n) => `<span class="sc ${n >= 75 ? "good" : n >= 50 ? "ok" : "low"}"><b>${outOf5(n)}</b> ${label}</span>`;

  function renderSuggestion() {
    const panel = $(".sugg");
    const key = state.panel;
    const flag = key && state.flags[key];
    const r = flag?.recommendation;
    const sec = key && state.sections.find((x) => x.key === key);
    if (!visibleTo(r) || !sec) {
      $(".toolbar").classList.remove("docked");
      panel.hidden = true;
      $(".sugg-arrow").hidden = true;
      document.documentElement.style.removeProperty("margin-right");
      document.documentElement.style.removeProperty("overflow-x");
      return;
    }
    const docked = innerWidth >= 900;
    panel.classList.toggle("sheet", !docked);
    // Make room so the panel never covers the page.
    // Sites sized in vw can't shrink, so also stop sideways scrolling: the page stays aligned left
    // and anything wider simply tucks under the panel.
    const html = document.documentElement.style;
    if (docked) {
      html.setProperty("margin-right", "400px", "important");
      html.setProperty("overflow-x", "hidden", "important");
      if (scrollX) scrollTo({ left: 0, top: scrollY });
    } else {
      html.removeProperty("margin-right");
      html.removeProperty("overflow-x");
    }
    panel.hidden = false;
    $(".toolbar").classList.toggle("docked", docked);

    const decided = state.statuses[key]?.status === "approved";
    const ev = r.evaluation;
    const editing = state.panelEdit;
    const keepEdits = editing ? [...panel.querySelectorAll(".sp-edit")].map((t) => t.value) : null;
    panel.innerHTML = `<div class="sp-h"><span class="sp-badge">💡 Suggested copy</span><span class="sp-for">${esc(sec.label)}</span>
        <button class="icon" data-act="sugg-close" title="Close">✕</button></div>
      <ol class="steps">
        <li>Read the new copy below. ${docked ? "The arrow shows which part of the page it's for." : ""}</li>
        <li><mark class="seo">Coloured words</mark> help people find you on Google and AI search, so please <b>keep them</b>.</li>
        <li>Click <b>✓ Use this copy</b>, or <b>✎ Change it</b> to make your own edits.</li>
      </ol>
      <div class="legend"><span><mark class="seo">blue</mark> SEO keyword</span><span><mark class="aeo">purple</mark> AI-search phrase</span></div>
      ${decided && !editing ? `<div class="sp-done">✓ Approved. Thank you! You can still change it below.</div>` : ""}
      <div class="sp-items">${r.items
        .map((it, i) => {
          const name = TAG_NAMES[it.tag] || "Text";
          if (editing) {
            const val = keepEdits?.[i] ?? it.recommended;
            const missing = keptTerms(r, it.recommended).filter((t) => !val.toLowerCase().includes(t.toLowerCase()));
            return `<div class="sp-item"><div class="sp-tag">${name}</div>
              <textarea class="sp-edit" data-i="${i}" rows="${Math.min(6, Math.ceil(val.length / 42) + 1)}">${esc(val)}</textarea>
              <div class="sp-warn" ${missing.length ? "" : "hidden"}>⚠ Try to keep: ${missing.map((t) => `“${esc(t)}”`).join(", ")}</div></div>`;
          }
          return `<div class="sp-item"><div class="sp-tag">${name}</div>
            ${it.original && it.original !== it.recommended ? `<details><summary>Current copy</summary><div class="sp-old">${esc(it.original)}</div></details>` : ""}
            <div class="sp-text">${markText(it.recommended, r)}</div></div>`;
        })
        .join("")}</div>
      ${r.rationale && !editing ? `<p class="sp-why"><b>Why it's better:</b> ${esc(r.rationale)}</p>` : ""}
      ${state.team && !pending(r) && belowTarget(r)
        ? `<div class="sp-warn"><b>Team note:</b> ${r.evaluation?.section?.overall != null
            ? `under the 4 / 5 target on ${lowScores(r.evaluation.section).map((k) => `${SCORE_NAMES[k]} (${outOf5(r.evaluation.section[k])})`).join(", ")}.`
            : "this copy hasn't been scored yet."}
          Try ↻ Rewrite, ideally with a team note naming the keyword or audience.</div>`
        : ""}
      ${pending(r)
        ? `<div class="sp-score busy"><span class="spin"></span> ${r.status === "improving" ? "Improving the copy using the rubric's feedback…" : "Checking the score with the Blend360 SEO/AEO rubric…"}</div>`
        : ev
          ? (() => {
              const sec = ev.section;
              const head = sec?.overall != null
                ? `Section score ${stars(sec.overall)} <b>${outOf5(sec.overall)} / 5</b> ${["seo", "aeo", "brand_voice", "content_quality"]
                    .filter((k) => sec[k] != null)
                    .map((k) => scoreChip({ seo: "SEO", aeo: "AEO", brand_voice: "Voice", content_quality: "Quality" }[k], sec[k]))
                    .join("")}`
                : `Score ${stars(ev.overall)} <b>${outOf5(ev.overall)} / 5</b> ${scoreChip("SEO", ev.seo)}${scoreChip("AEO", ev.aeo)}${scoreChip("Voice", ev.brand_voice)}${scoreChip("Quality", ev.content_quality)}`;
              return `<details class="sp-score"><summary>${head}</summary>
              ${ev.summary ? `<p>${esc(ev.summary)}</p>` : ""}
              ${ev.improvements?.length ? `<b>Could be even better:</b><ul>${ev.improvements.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
              <p class="sp-note">${sec?.overall != null
                ? "Scored by AI with the Blend360 SEO/AEO rubric in section mode: only the checks a page section can meet count (no meta title, word count, FAQ or images)."
                : "Scored by AI with the Blend360 SEO/AEO rubric."} A person still reviews everything.</p>
              ${state.team ? `<button class="btn light sm" data-act="sugg-rescore" title="Score the existing copy again (doesn't rewrite it)">↻ Re-score</button>` : ""}</details>`;
            })()
          : r.error && state.team
            ? `<div class="sp-score">${esc(r.error)} <button class="btn light sm" data-act="sugg-rescore" title="Score the existing copy again (doesn't rewrite it)">↻ Retry score</button></div>`
            : ""}
      <div class="sp-actions">${editing
        ? `<button class="btn primary" data-act="sugg-save">Save my version</button><button class="btn light" data-act="sugg-cancel">Cancel</button>`
        : `<button class="btn primary green" data-act="sugg-use">✓ Use this copy</button><button class="btn light" data-act="sugg-edit">✎ Change it</button>`}
        ${state.team ? `<span class="sp" ></span><button class="btn light sm" data-act="sugg-make" title="Write new suggested copy for this section">↻ Rewrite</button>` : ""}</div>`;
    drawArrow();
  }

  // Arrow from the panel to the section it's about (desktop only).
  function drawArrow() {
    const arrow = $(".sugg-arrow");
    const sec = state.panel && state.sections.find((x) => x.key === state.panel);
    const panel = $(".sugg");
    if (!sec || panel.hidden || panel.classList.contains("sheet")) return (arrow.hidden = true);
    const r = rectOf(sec);
    const p = panel.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return (arrow.hidden = true);
    const y2 = Math.max(r.top + 16, Math.min(r.top + 60, r.bottom - 16));
    const x2 = Math.min(r.right, p.left - 24) + 4;
    const x1 = p.left - 2;
    const y1 = Math.max(p.top + 40, Math.min(y2, p.bottom - 40));
    const line = arrow.querySelector("line");
    Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => line.setAttribute(k, v));
    arrow.hidden = false;
  }
  addEventListener("scroll", () => state.panel && drawArrow(), { passive: true });

  function openSuggestion(key) {
    state.panel = key;
    state.panelEdit = false;
    renderSuggestion();
    const sec = state.sections.find((x) => x.key === key);
    if (sec) {
      // Scroll vertically only; scrollIntoView would also scroll sideways on wide pages.
      const r = rectOf(sec);
      scrollTo({ left: 0, top: Math.max(0, r.top + scrollY - Math.max(80, (innerHeight - r.height) / 2)), behavior: "smooth" });
    }
    setTimeout(() => {
      render();
      drawArrow();
    }, 500);
  }

  function closeSuggestion() {
    state.panel = null;
    state.panelEdit = false;
    renderSuggestion();
    render();
  }

  async function submitSuggestion(texts, edited) {
    const key = state.panel;
    const r = state.flags[key].recommendation;
    const sec = state.sections.find((x) => x.key === key);
    const target = sec.heading || sec.members?.[0] || sec.el;
    const author = await ensureName();
    const c = await api("/api/comments", {
      method: "POST",
      body: {
        pageId: PAGE,
        author,
        body: edited ? "I edited the suggested copy." : "I approved the suggested copy.",
        anchor: { ...anchorOf(target), xPct: 0.02, yPct: 0.1 },
        sectionKey: key,
        sectionLabel: sec.label,
        viewport: innerWidth,
        copy: {
          current: r.items.map((x) => x.original).join("\n"),
          proposed: texts.join("\n"),
          source: edited ? "reviewer" : "ai",
          rationale: edited ? "" : r.rationale || "",
        },
      },
    });
    state.comments.push(c);
    await setStatus(key, "approved", false);
    state.panelEdit = false;
    renderSuggestion();
    render();
    toast(edited ? "Saved your version. Thank you!" : "Copy approved. Thank you!");
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
    if (Object.values(state.flags).some((f) => pending(f.recommendation))) pollSuggestions();
    if (state.panel && !state.panelEdit) renderSuggestion();
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
      card: cardFor(el),
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
          card: d.card,
          viewport: innerWidth,
          copy: d.copy,
        },
      });
      state.comments.push(c);
      // A comment on a highlighted section counts as asking for edits there; elsewhere it's just a comment.
      if (d.sectionKey && state.flags[d.sectionKey] && !state.statuses[d.sectionKey]) await setStatus(d.sectionKey, "needs_edits", false);
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
    // A comment on a card that isn't loaded: load that card first, then open it.
    const g = c.card && switcherOf(resolveAnchor(c.anchor));
    if (g && g.active !== c.card - 1 && g.items[c.card - 1]) {
      pressOnPage(g.items[c.card - 1]);
      return void setTimeout(() => openComment(id), 450);
    }
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
        toast("Click a block to highlight it, or drag a box around several cards");
      } else if (act === "pick-bigger") {
        const p = state.pick;
        // A group grows into the block that contains all its cards; a block grows into its parent.
        const next = p.members ? p.el : p.el.parentElement;
        if (next && next !== document.body && next !== document.documentElement) {
          p.history.push({ el: p.el, members: p.members });
          p.el = next;
          p.members = null;
          renderPick();
        }
      } else if (act === "pick-smaller") {
        const p = state.pick;
        if (p.history.length) Object.assign(p, p.history.pop());
        renderPick();
      } else if (act === "pick-cancel") {
        endPick();
      } else if (act === "pick-save") {
        await savePick();
      } else if (act === "pick-save-suggest") {
        const key = await savePick();
        await requestSuggestion(key);
      } else if (act === "sugg-make") {
        const key = t.closest(".chip")?.dataset.key || state.panel;
        if (state.flags[key]?.recommendation?.items?.length && !confirm("Write new suggested copy for this section? The current suggestion will be replaced.")) return;
        await requestSuggestion(key);
      } else if (act === "sugg-open") {
        const key = t.closest(".chip").dataset.key;
        if (state.panel === key) closeSuggestion();
        else openSuggestion(key);
      } else if (act === "sugg-rescore") {
        await rescoreSuggestion(state.panel);
      } else if (act === "sugg-close") {
        closeSuggestion();
      } else if (act === "sugg-edit") {
        state.panelEdit = true;
        renderSuggestion();
      } else if (act === "sugg-cancel") {
        state.panelEdit = false;
        renderSuggestion();
      } else if (act === "sugg-use") {
        await submitSuggestion(state.flags[state.panel].recommendation.items.map((x) => x.recommended), false);
      } else if (act === "sugg-save") {
        const texts = [...$(".sugg").querySelectorAll(".sp-edit")].map((x) => x.value.trim());
        await submitSuggestion(texts, true);
      } else if (act === "delete-comment") {
        const c = state.comments.find((x) => x.id === state.openId);
        if (!c || !confirm(`Delete comment #${c.n}${c.replies.length ? " and its replies" : ""}? This can't be undone.`)) return;
        await api(`/api/comments/${c.id}?page=${PAGE}`, { method: "DELETE" });
        state.comments = state.comments.filter((x) => x.id !== c.id);
        state.openId = null;
        popEl.innerHTML = "";
        render();
        toast("Comment deleted");
      } else if (act === "switch") {
        const g = switcherList[+t.dataset.g];
        const item = g?.items[+t.dataset.i];
        if (item) pressOnPage(item);
      } else if (act === "flip") {
        toggleFlip(state.flipTarget);
      } else if (act === "flip-comment") {
        const c = state.comments.find((x) => x.id === state.openId);
        toggleFlip(flipRotator(c && resolveAnchor(c.anchor)));
      } else if (act === "flip-section") {
        const sec = state.sections.find((x) => x.key === t.closest(".chip").dataset.key);
        toggleFlip(flipRotator(sec && (sec.members?.[0] || sec.el)));
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
        } else if (!confirm(`Remove the highlight on "${sec?.label || "this area"}"? The client will no longer see it. Comments stay.`)) {
          return;
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
      } else if (act === "undo-status") {
        await setStatus(t.closest(".chip").dataset.key, "pending");
        toast("Back to “Needs your review”");
      } else if (act === "approve" || act === "edits") {
        const key = t.closest(".chip").dataset.key;
        const cur = state.statuses[key]?.status;
        if (act === "approve") {
          const wasNudged = state.nudged;
          await setStatus(key, cur === "approved" ? "pending" : "approved");
          // Approving the last section shows the "next page" prompt instead.
          if (cur !== "approved" && wasNudged === state.nudged) toast("Section approved ✓ · Clicked by mistake? Use ↶ Undo");
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

  ui.addEventListener("input", (e) => {
    if (!e.target.classList?.contains("sp-edit")) return;
    const r = state.flags[state.panel]?.recommendation;
    const it = r?.items[+e.target.dataset.i];
    if (!it) return;
    const missing = keptTerms(r, it.recommended).filter((t) => !e.target.value.toLowerCase().includes(t.toLowerCase()));
    const warn = e.target.nextElementSibling;
    warn.hidden = !missing.length;
    warn.textContent = `⚠ Try to keep: ${missing.map((t) => `“${t}”`).join(", ")}`;
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
        if (dragJustEnded) return void (dragJustEnded = false);
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
          if (sib && sib.id !== CURRENT) {
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

  // Highlight area: drag a box around several cards to highlight them as one group.
  let drag = null;
  let dragJustEnded = false;
  const bandRect = (d, e) => ({
    left: Math.min(d.x, e.clientX),
    top: Math.min(d.y, e.clientY),
    right: Math.max(d.x, e.clientX),
    bottom: Math.max(d.y, e.clientY),
  });
  // Pointer events: preventDefault on pointerdown (see block above) suppresses the mouse* ones.
  document.addEventListener(
    "pointerdown",
    (e) => {
      const onPage = !insideUI(e) || e.composedPath()[0] === glass;
      if (state.mode === "pick" && e.button === 0 && onPage) drag = { x: e.clientX, y: e.clientY, active: false, t: 0 };
    },
    true,
  );
  document.addEventListener(
    "pointermove",
    (e) => {
      if (!drag) return;
      if (!drag.active && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
      drag.active = true;
      hoverBox.style.display = "none";
      const b = bandRect(drag, e);
      Object.assign(bandEl.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.right - b.left}px`, height: `${b.bottom - b.top}px` });
      bandEl.hidden = false;
      const now = Date.now();
      if (now - drag.t > 150) {
        drag.t = now;
        const els = elementsInBand(b);
        outlineGroup(els);
        bandEl.dataset.count = els.length ? `${els.length} selected` : "";
      }
    },
    true,
  );
  document.addEventListener(
    "pointerup",
    (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      bandEl.hidden = true;
      if (!d.active) return;
      dragJustEnded = true;
      setTimeout(() => (dragJustEnded = false), 400);
      const members = elementsInBand(bandRect(d, e));
      if (!members.length) {
        outlineGroup(null);
        return toast("Drag the box all the way around the cards you want to group");
      }
      chooseGroup(members);
    },
    true,
  );

  // The page element under a point, looking through the glass sheet. elementsFromPoint lists the
  // whole stack, so the glass never has to stop catching the mouse; toggling its pointer-events
  // let Webflow see a split-second hover on every move, which made hover-flip cards flicker.
  function pageAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === host || host.contains(el)) continue;
      return el === document.documentElement || el === document.body ? null : el;
    }
    return null;
  }

  function showFlipButton(el) {
    const rot = el && flipRotator(el);
    if (!rot) {
      if (!flipBtn.matches(":hover")) flipBtn.hidden = true;
      return;
    }
    state.flipTarget = rot;
    const r = rot.getBoundingClientRect();
    // Just above the card's top-left corner, so it never covers the card's own content or buttons.
    Object.assign(flipBtn.style, { left: `${r.left + scrollX}px`, top: `${Math.max(scrollY + 4, r.top + scrollY - 36)}px` });
    flipBtn.textContent = rot.dataset.erFlipped === "1" ? "↻ Flip back" : "↻ Flip card";
    flipBtn.hidden = false;
  }

  let glassFrame = 0;
  glass.addEventListener("pointermove", (e) => {
    if (drag?.active) return;
    const { clientX: x, clientY: y } = e;
    cancelAnimationFrame(glassFrame);
    glassFrame = requestAnimationFrame(() => {
      const el = pageAt(x, y);
      showHover(el);
      showFlipButton(el);
      // On a frozen blank page, show a hand over tabs and other things that still work when clicked.
      glass.style.cursor = state.mode === "browse" && el && clickTarget(el) ? "pointer" : "";
    });
  });
  glass.addEventListener("pointerleave", () => (hoverBox.style.display = "none"));
  glass.addEventListener("click", (e) => {
    const el = pageAt(e.clientX, e.clientY);
    if (!el) return;
    if (state.mode === "pick") {
      if (dragJustEnded) return void (dragJustEnded = false);
      return choosePick(el);
    }
    if (state.mode === "comment") {
      hoverBox.style.display = "none";
      startDraft(el, e.clientX, e.clientY);
      return;
    }
    // Browse mode on a frozen (blank) page: tabs and other switchers still work; otherwise a click
    // on the page just closes open panels.
    const target = clickTarget(el);
    if (target) return pressOnPage(target);
    if (state.pagesOpen || (state.openId && !state.draft)) {
      state.pagesOpen = false;
      state.openId = null;
      renderPagesPanel();
      render();
    }
  });

  document.addEventListener(
    "mousemove",
    (e) => {
      if (insideUI(e)) return;
      showHover(document.elementFromPoint(e.clientX, e.clientY));
    },
    true,
  );

  function showHover(el) {
    if ((state.mode !== "comment" && state.mode !== "pick") || state.draft || state.pick || drag?.active || !el) {
      hoverBox.style.display = "none";
      return;
    }
    if (el === state.hoverEl && hoverBox.style.display === "block") return;
    state.hoverEl = el;
    const r = el.getBoundingClientRect();
    Object.assign(hoverBox.style, {
      display: "block",
      left: `${r.left + scrollX}px`,
      top: `${r.top + scrollY}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  }

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
      if (state.panel) drawArrow();
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
.glass { position: fixed; inset: 0; z-index: -1; cursor: default; background: transparent; }
.switcher { position: absolute; display: flex; align-items: center; gap: 4px; background: rgba(30,30,30,.92); color: #ddd;
  border-radius: 10px; padding: 4px 4px 4px 10px; font-size: 12px; box-shadow: 0 4px 14px rgba(0,0,0,.2); pointer-events: auto; white-space: nowrap; }
.switcher span { margin-right: 4px; }
.switcher b { color: #fff; }
.switcher button { border: 0; border-radius: 7px; min-width: 26px; padding: 4px 8px; background: #333; color: #fff; font-size: 12px; font-weight: 600; }
.switcher button:hover { background: #444; }
.switcher button.on { background: #ffc700; color: #1e1e1e; }
.switcher button { position: relative; }
.switcher button i { position: absolute; top: -7px; right: -6px; font-style: normal; font-size: 10px; line-height: 15px; min-width: 15px;
  padding: 0 3px; border-radius: 8px; background: #f24822; color: #fff; }
.sb-card { font-size: 10px; font-weight: 700; color: #1e1e1e; background: #ffe680; border-radius: 999px; padding: 0 6px; }
.glass.picking { cursor: crosshair; }
.glass[hidden], .flipbtn[hidden] { display: none; }
.flipbtn { position: absolute; z-index: 1; border: 0; border-radius: 999px; padding: 7px 12px; background: #1e1e1e; color: #fff;
  font-size: 12px; font-weight: 700; box-shadow: 0 4px 14px rgba(0,0,0,.3); cursor: pointer; }
.flipbtn:hover { background: #ffc700; color: #1e1e1e; }
.flip-note .btn { margin-top: 6px; }
.sp { flex: 1; }
button { font: inherit; cursor: pointer; }
svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.hover { position: absolute; display: none; outline: 2px solid #0d99ff; outline-offset: 1px; background: rgba(13,153,255,.06); pointer-events: none; border-radius: 2px; }

.toolbar { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; align-items: center; gap: 4px;
  background: #1e1e1e; color: #fff; padding: 6px; border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.3); font-size: 13px; }
.brand { border: 0; background: transparent; border-radius: 8px; padding: 4px 6px; display: flex; }
.brand img { width: 28px; height: 28px; border-radius: 6px; display: block; }
.brand { align-items: center; gap: 6px; }
.brand .ver { font-size: 10px; color: #8a8a8a; font-weight: 500; letter-spacing: 0; white-space: nowrap; }
.brand:hover { background: #333; }
.brand { margin-right: 4px; }
.tb { display: flex; align-items: center; gap: 6px; background: transparent; color: #fff; border: 0; border-radius: 9px; padding: 8px 12px; white-space: nowrap; }
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

.pin { position: absolute; transform: translate(-4px, -100%); display: flex; white-space: nowrap; align-items: center; gap: 4px; padding: 3px 8px 3px 3px;
  background: #fff; border: 0; border-radius: 16px 16px 16px 2px; box-shadow: 0 2px 8px rgba(0,0,0,.25); font-size: 12px; color: #1e1e1e; }
.pin b { font-weight: 700; }
.pin em { white-space: nowrap; font-style: normal; font-size: 10px; font-weight: 700; color: #1e1e1e; background: #ffe680; border-radius: 999px; padding: 0 5px; }
.pin:hover, .pin.active { box-shadow: 0 0 0 2px #0d99ff, 0 4px 12px rgba(0,0,0,.3); }
.pin.resolved { opacity: .55; }
.pin.away { opacity: .6; background: #f3f3f3; border: 1px dashed #999; }
.pin.away i { font-style: normal; font-weight: 700; color: #666; }
.flip-note { background: #fff8db; border: 1px solid #ffe08a; color: #6b5300; border-radius: 8px; padding: 8px 10px; font-size: 12px; margin-bottom: 8px; }
.hl.away { outline-style: dashed; background: transparent; }
.chip.away { background: rgba(255,248,219,.95); color: #6b5300; box-shadow: 0 0 0 1px #ffe08a, 0 4px 14px rgba(0,0,0,.15); }
.chip.away .lbl { color: #6b5300; max-width: 280px; }
.av { width: 22px; height: 22px; border-radius: 50%; color: #fff; display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; flex: none; }

.chip { position: absolute; transform: translateX(-100%); display: flex; align-items: center; gap: 4px; background: rgba(30,30,30,.92);
  color: #fff; border-radius: 10px; padding: 4px; font-size: 12px; box-shadow: 0 4px 14px rgba(0,0,0,.2); max-width: calc(100vw - 24px); }
.chip .lbl { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px; color: #ccc; }
.chip .n { background: #f24822; border-radius: 9px; padding: 0 6px; font-weight: 700; font-size: 11px; }
.chip button { border: 0; border-radius: 7px; padding: 5px 9px; background: #333; color: #fff; font-size: 12px; white-space: nowrap; }
.chip button:hover { background: #444; }
.chip button.undo { background: #fff; color: #1e1e1e; font-weight: 600; }
.chip button.undo:hover { background: #eee; }
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
.chip button.flag-btn.remove { background: #3a2a2a; color: #ffb4a8; }
.chip button.flag-btn.remove:hover { background: #f24822; color: #fff; }
.hover.pick { outline-color: #ffc700; background: rgba(255,199,0,.08); }
.focus-box.pick { outline: 3px solid #ffc700; background: rgba(255,199,0,.1); }
.sugg { position: fixed; top: 0; right: 0; bottom: 0; width: 400px; background: #fff; color: #1e1e1e; overflow-y: auto; z-index: 3;
  box-shadow: -10px 0 30px rgba(0,0,0,.18); padding: 16px 16px 0; font-size: 14px; line-height: 1.5; border-left: 4px solid #ffc700; }
.toolbar.docked { left: calc((100vw - 400px) / 2); }
.sugg[hidden], .sugg-arrow[hidden] { display: none; }
.sugg.sheet { top: auto; left: 0; width: auto; max-height: 72vh; border-left: 0; border-top: 4px solid #ffc700; border-radius: 16px 16px 0 0; }
.sp-h { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.sp-badge { background: #ffc700; color: #1e1e1e; font-weight: 800; border-radius: 999px; padding: 4px 12px; font-size: 13px; }
.sp-for { flex: 1; font-weight: 600; color: #555; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.steps { margin: 0 0 10px; padding-left: 20px; color: #333; font-size: 13px; display: grid; gap: 4px; }
.legend { display: flex; gap: 12px; font-size: 12px; color: #555; margin-bottom: 12px; flex-wrap: wrap; align-items: center; border: 1px solid #e5e5e0; border-radius: 10px; padding: 8px 12px; background: #fcfcfb; }
mark.seo { background: #d6ebff; color: #0a4d8c; border-radius: 4px; padding: 0 3px; box-shadow: inset 0 -2px 0 #0d99ff; }
mark.aeo { background: #efe5ff; color: #5b21b6; border-radius: 4px; padding: 0 3px; box-shadow: inset 0 -2px 0 #8b5cf6; }
.sp-items { display: grid; gap: 10px; }
.sp-item { border: 1px solid #eee; border-radius: 10px; padding: 10px 12px; background: #fcfcfb; }
.sp-tag { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: #999; margin-bottom: 4px; }
.sp-text { white-space: pre-wrap; font-size: 15px; }
.sp-item details { margin-bottom: 6px; font-size: 12px; color: #777; }
.sp-old { padding-bottom: 6px; border-bottom: 1px dashed #e5e5e0; }
.sp-old { white-space: pre-wrap; margin-top: 4px; }
.sp-edit { font-size: 14px; line-height: 1.5; }
.sp-warn { margin-top: 4px; font-size: 12px; color: #b45309; }
.sp-warn[hidden] { display: none; }
.sp-why { font-size: 13px; color: #444; margin: 12px 0 0; }
.sp-done { background: #e3f6ec; color: #0b7a40; border-radius: 8px; padding: 8px 10px; font-weight: 600; margin-bottom: 10px; }
.sp-score { margin-top: 12px; border: 1px solid #eee; border-radius: 10px; padding: 10px 12px; font-size: 13px; color: #444; }
.sp-score.busy { display: flex; align-items: center; gap: 8px; color: #6d28d9; }
.sp-score summary { cursor: pointer; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sp-score ul { margin: 6px 0; padding-left: 18px; }
.sp-note { font-size: 11px; color: #888; }
.stars { color: #f5a623; letter-spacing: 1px; }
.sp-warn { margin-top: 12px; border-radius: 10px; padding: 10px 12px; font-size: 13px; background: #fff4cc; color: #5c4500; }
.sc { font-size: 11px; border-radius: 999px; padding: 1px 8px; background: #f0f0ec; }
.sc.good { background: #e3f6ec; color: #0b7a40; } .sc.ok { background: #fff4cc; color: #7a5c00; } .sc.low { background: #ffe4dd; color: #a8321b; }
.sp-actions { position: sticky; bottom: 0; margin: 14px -16px 0; padding: 12px 16px 16px; background: #fff; border-top: 1px solid #eee;
  display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.sp-actions .btn { padding: 10px 16px; font-size: 14px; }
.btn.primary.green { background: #14ae5c; color: #fff; }
.btn.primary.violet { background: #6d28d9; color: #fff; }
.sugg-arrow { position: fixed; inset: 0; pointer-events: none; z-index: 2; }
.sugg-arrow svg { width: 100%; height: 100%; overflow: visible; }
.sugg-arrow line { stroke: #ffc700; stroke-width: 3; stroke-dasharray: 6 4; }
.chip button.sugg-btn { background: #ffc700; color: #1e1e1e; font-weight: 700; }
.chip button.sugg-btn.on { box-shadow: 0 0 0 2px #fff; }
.chip button.sugg-btn.busy { background: #6d28d9; color: #fff; }
.chip button.sugg-make { background: #6d28d9; }
.band { position: fixed; border: 2px dashed #ffc700; background: rgba(255,199,0,.1); border-radius: 4px; pointer-events: none; }
.band[hidden] { display: none; }
.band::after { content: attr(data-count); position: absolute; left: 0; top: -24px; background: #ffc700; color: #1e1e1e; font-size: 11px;
  font-weight: 700; padding: 2px 8px; border-radius: 5px; white-space: nowrap; }
.band[data-count=""]::after { display: none; }
.group-outlines > div { position: absolute; outline: 2px solid #ffc700; outline-offset: 1px; border-radius: 4px; pointer-events: none; background: rgba(255,199,0,.08); }
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
.sb-item .body { font-size: 12px; color: #444; white-space: pre-wrap; }
.sb-main { min-width: 0; flex: 1; }
.sb-meta { font-size: 11px; color: #888; margin: 1px 0 3px; }
.sb-on { font-size: 11px; color: #666; background: #f5f5f2; border-radius: 6px; padding: 3px 6px; margin-bottom: 4px; }
.sb-copy { margin-top: 4px; color: #1e1e1e; background: #eef7ff; border-radius: 6px; padding: 3px 6px; }
.sb-done { font-size: 10px; font-weight: 700; color: #0b7a40; background: #e3f6ec; border-radius: 999px; padding: 0 6px; }
.sb-reply { margin: 6px 0 0 6px; padding-left: 8px; border-left: 2px solid #e5e5e0; font-size: 12px; color: #444; }
.sb-reply time { font-size: 11px; color: #888; }
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
