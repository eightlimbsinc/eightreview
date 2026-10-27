// Serves the staging page from our own domain with the review overlay injected.
//   GET /r/:id
// Because the page is same-origin with the overlay, comments can attach to real
// elements and nothing has to be added to the Webflow project.
import { store, error, handle } from "./_lib/store.mjs";
import { projectPages } from "./_lib/summary.mjs";
import { fetchStaging, stagingPassword } from "./_lib/staging.mjs";
import { VERSION } from "./_lib/version.mjs";

const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// The client lands here, so show a readable page rather than raw JSON.
const errorPage = (message) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review unavailable</title>
<body style="font:15px/1.5 system-ui,sans-serif;background:#f6f6f4;color:#1e1e1e;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<div style="max-width:440px;background:#fff;border:1px solid #e7e7e3;border-radius:14px;padding:24px"><h1 style="font-size:18px;margin:0 0 8px">This page can't be shown right now</h1>
<p style="margin:0;color:#555">${escapeAttr(message)}</p></div></body>`,
    { status: 502, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

export default handle(async (req, context) => {
  const page = await store().get(`pages/${context.params.id}`);
  if (!page) return error(404, "Review page not found");

  const [project, siblings] = page.projectId
    ? await Promise.all([store().get(`projects/${page.projectId}`), projectPages(page.projectId)])
    : [null, [page]];

  let upstream;
  try {
    upstream = await fetchStaging(page.url, { password: stagingPassword(project) });
  } catch (e) {
    return errorPage(e.message || `Could not reach ${page.url}`);
  }
  if (!upstream.ok) return errorPage(`The staging page returned an error (${upstream.status}).`);

  const origin = new URL(req.url).origin;
  const base = upstream.url || page.url;
  const config = JSON.stringify({
    pageId: page.id,
    name: page.name,
    url: page.url,
    api: origin,
    project: project && { id: project.id, name: project.name, client: project.client },
    // Lets the overlay keep links between staged pages inside the review.
    pages: siblings.map((p) => ({ id: p.id, name: p.name, url: p.url })),
  });

  let html = await upstream.text();
  // Drop any CSP meta tag that would block our overlay script.
  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");

  const head =
    `<base href="${escapeAttr(base)}">` +
    `<meta name="robots" content="noindex,nofollow">` +
    `<script>window.__EIGHTREVIEW__=${config.replace(/</g, "\\u003c")}</script>`;
  const tail = `<script src="${origin}/overlay/overlay.js?v=${VERSION}" defer></script>`;

  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, tail + "</body>") : html + tail;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
});

export const config = { path: "/r/:id" };
