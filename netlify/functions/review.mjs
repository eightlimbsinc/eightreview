// Serves the staging page from our own domain with the review overlay injected.
//   GET /r/:id
// Because the page is same-origin with the overlay, comments can attach to real
// elements and nothing has to be added to the Webflow project.
import { store, error } from "./_lib/store.mjs";
import { projectPages } from "./_lib/summary.mjs";

const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export default async (req, context) => {
  const page = await store().get(`pages/${context.params.id}`);
  if (!page) return error(404, "Review page not found");

  let upstream;
  try {
    upstream = await fetch(page.url, {
      headers: { "user-agent": "Mozilla/5.0 (EightReview staging preview)", accept: "text/html" },
      redirect: "follow",
    });
  } catch {
    return error(502, `Could not reach ${page.url}`);
  }
  if (!upstream.ok) return error(502, `Staging page returned ${upstream.status}`);

  const origin = new URL(req.url).origin;
  const base = upstream.url || page.url;
  const [project, siblings] = page.projectId
    ? await Promise.all([store().get(`projects/${page.projectId}`), projectPages(page.projectId)])
    : [null, [page]];
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
  const tail = `<script src="${origin}/overlay/overlay.js" defer></script>`;

  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, tail + "</body>") : html + tail;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
};

export const config = { path: "/r/:id" };
