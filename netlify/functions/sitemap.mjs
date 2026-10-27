// Lists the page URLs in a staging site's sitemap so the team can bulk-add them.
//   POST /api/sitemap { url, projectId }  -> { urls: [...] }   (admin)
// Accepts a sitemap URL or any page on the site (we then try /sitemap.xml).
import { store, json, error, readBody, isAdmin } from "./_lib/store.mjs";
import { fetchStaging, stagingPassword } from "./_lib/staging.mjs";

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));

async function fetchText(url, password) {
  const res = await fetchStaging(url, { password, accept: "application/xml,text/xml,*/*" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

export default async (req) => {
  if (req.method !== "POST") return error(405, "Method not allowed");
  if (!isAdmin(req)) return error(401, "Admin token required");
  const body = await readBody(req);
  const project = body.projectId ? await store().get(`projects/${body.projectId}`) : null;
  const password = stagingPassword(project);
  let start;
  try {
    start = new URL(body.url);
  } catch {
    return error(400, "Enter the staging site URL, e.g. https://site.webflow.io");
  }
  const sitemapUrl = /\.xml$/i.test(start.pathname) ? start.toString() : `${start.origin}/sitemap.xml`;

  try {
    let urls = locs(await fetchText(sitemapUrl, password));
    // Sitemap index: follow child sitemaps (one level, capped).
    const children = urls.filter((u) => /\.xml(\?|$)/i.test(u)).slice(0, 10);
    if (children.length) {
      urls = urls.filter((u) => !children.includes(u));
      for (const child of children) urls.push(...locs(await fetchText(child, password)));
    }
    // Webflow sitemaps list the production domain; map them back onto the staging host.
    const mapped = [...new Set(urls.map((u) => {
      const x = new URL(u);
      return `${start.origin}${x.pathname}`;
    }))];
    return json({ sitemap: sitemapUrl, urls: mapped.slice(0, 500) });
  } catch (e) {
    if (/password/i.test(e.message)) return error(502, e.message);
    return error(502, `Couldn't read a sitemap at ${sitemapUrl}. In Webflow, turn on Site settings → SEO → Auto-generate sitemap, or paste URLs instead. (${e.message})`);
  }
};

export const config = { path: "/api/sitemap" };
