// Minimal local runner: serves public/ and routes /api/* and /r/* to the Netlify
// functions, storing data in .data/. Use `netlify dev` instead if you have the CLI.
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.EIGHTREVIEW_LOCAL = "1";
const PORT = Number(process.env.PORT || 8888);
const root = process.cwd();
const fnDir = path.join(root, "netlify/functions");

const routes = [];
for (const file of await fs.readdir(fnDir)) {
  if (!file.endsWith(".mjs")) continue;
  const mod = await import(pathToFileURL(path.join(fnDir, file)));
  for (const p of [].concat(mod.config.path)) {
    const names = [];
    const re = new RegExp("^" + p.replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)")) + "/?$");
    routes.push({ re, names, handler: mod.default });
  }
}

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    for (const r of routes) {
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      try {
        const out = await r.handler(request, { params });
        res.writeHead(out.status, Object.fromEntries(out.headers));
        res.end(Buffer.from(await out.arrayBuffer()));
      } catch (e) {
        console.error(e);
        res.writeHead(500).end(String(e));
      }
      return;
    }
    // Static files (public/ plus fixtures/ for local testing).
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    for (const dir of ["public", "."]) {
      const file = path.join(root, dir, path.normalize(rel));
      if (!file.startsWith(path.join(root, dir))) break;
      try {
        const body = await fs.readFile(file);
        res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
        return res.end(body);
      } catch {}
    }
    res.writeHead(404).end("Not found");
  })
  .listen(PORT, () => console.log(`EightReview dev server on http://localhost:${PORT}`));
