// Storage + HTTP helpers shared by every function.
// On Netlify this uses Netlify Blobs. Locally (`npm run dev`) it falls back to
// JSON files under .data/ so the app runs without a Netlify account.
import { getStore } from "@netlify/blobs";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const STORE_NAME = "eightreview";

function fileStore() {
  const root = path.resolve(process.cwd(), ".data");
  const file = (key) => path.join(root, encodeURIComponent(key) + ".json");
  return {
    async get(key) {
      try {
        return JSON.parse(await fs.readFile(file(key), "utf8"));
      } catch {
        return null;
      }
    },
    async setJSON(key, value) {
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(file(key), JSON.stringify(value, null, 2));
    },
    async delete(key) {
      await fs.rm(file(key), { force: true });
    },
    async list({ prefix = "" } = {}) {
      let names = [];
      try {
        names = await fs.readdir(root);
      } catch {}
      const keys = names
        .filter((n) => n.endsWith(".json"))
        .map((n) => decodeURIComponent(n.slice(0, -5)))
        .filter((k) => k.startsWith(prefix));
      return { blobs: keys.map((key) => ({ key })) };
    },
  };
}

function blobStore() {
  const s = getStore({ name: STORE_NAME, consistency: "strong" });
  return {
    get: (key) => s.get(key, { type: "json" }),
    setJSON: (key, value) => s.setJSON(key, value),
    delete: (key) => s.delete(key),
    list: (opts) => s.list(opts),
  };
}

// Don't cache the Blobs client across requests: Netlify hands each invocation a
// short-lived access token, and a client kept alive in a warm function instance
// fails later with "Failed to decode token: Token expired".
let local;
export function store() {
  if (process.env.EIGHTREVIEW_LOCAL) return (local ??= fileStore());
  return blobStore();
}

export async function listJSON(prefix) {
  const s = store();
  const { blobs } = await s.list({ prefix });
  const items = await Promise.all(blobs.map((b) => s.get(b.key)));
  return items.filter(Boolean);
}

export const newId = (bytes = 9) => crypto.randomBytes(bytes).toString("base64url");

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const error = (status, message) => json({ error: message }, status);

export async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// Optional team-only guard for creating/editing review pages.
// Set ADMIN_TOKEN in Netlify env vars to turn it on.
export function isAdmin(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true;
  return req.headers.get("x-admin-token") === token;
}

// Trim free text coming from the browser so a single request can't bloat storage.
export const clip = (value, max = 4000) =>
  typeof value === "string" ? value.slice(0, max) : "";

// Wraps a function handler so crashes come back as readable JSON (and land in the
// Netlify function log) instead of Netlify's bare 502.
export const handle = (fn) => async (req, context) => {
  try {
    return await fn(req, context);
  } catch (e) {
    console.error(`[${req.method} ${new URL(req.url).pathname}]`, e);
    return json({ error: `Server error: ${e?.message || e}` }, 500);
  }
};
