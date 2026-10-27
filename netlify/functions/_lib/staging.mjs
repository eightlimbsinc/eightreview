// Fetches staging pages, logging in through Webflow's site password screen when needed.
// Webflow answers a protected page with 401 + a form that POSTs the password to
// /.wf_auth and sets an auth cookie. We submit that form, keep the cookie per host
// (so we don't log in on every request), and retry.
import { store } from "./store.mjs";

const UA = "Mozilla/5.0 (EightReview staging preview)";
const cookieKey = (host) => `auth/${host}`;

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
const decode = (s = "") => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x2F;|&#47;/g, "/");

// Pull the password form out of the 401 page: action, hidden fields, password field name.
export function parsePasswordForm(html) {
  const forms = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
  const form = forms.find((f) => /type\s*=\s*["']?password/i.test(f));
  if (!form) return null;
  const fields = {};
  let passwordName = "pass";
  for (const input of form.match(/<input\b[^>]*>/gi) || []) {
    const name = attr(input, "name");
    if (!name) continue;
    if (/type\s*=\s*["']?password/i.test(input)) passwordName = name;
    else if (!/type\s*=\s*["']?(submit|button)/i.test(input)) fields[name] = decode(attr(input, "value") || "");
  }
  return { action: decode(attr(form.match(/<form\b[^>]*>/i)[0], "action") || "/.wf_auth"), fields, passwordName };
}

// "a=1; Path=/; HttpOnly" x N  ->  "a=1; b=2"
const toCookieHeader = (setCookies) => setCookies.map((c) => c.split(";")[0]).join("; ");

async function login(url, html, password) {
  const form = parsePasswordForm(html);
  if (!form) return null;
  const target = new URL(url);
  const body = new URLSearchParams({ ...form.fields, [form.passwordName]: password });
  // Webflow fills these in server-side; make sure they're present either way.
  if (!body.has("path")) body.set("path", target.pathname);
  const res = await fetch(new URL(form.action, target), {
    method: "POST",
    headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded", origin: target.origin, referer: url },
    body,
    redirect: "manual",
  });
  const cookies = res.headers.getSetCookie?.() || [];
  return cookies.length ? toCookieHeader(cookies) : null;
}

const get = (url, cookie, accept) =>
  fetch(url, { headers: { "user-agent": UA, accept, ...(cookie ? { cookie } : {}) }, redirect: "follow" });

/**
 * fetch() for a staging URL. Returns the Response, or throws with a readable message
 * when the site is password protected and we can't get in.
 */
export async function fetchStaging(url, { password, accept = "text/html" } = {}) {
  const host = new URL(url).host;
  const s = store();
  let cookie = (await s.get(cookieKey(host)))?.cookie;

  let res = await get(url, cookie, accept);
  if (res.status !== 401) return res;

  const html = await res.text();
  if (!password) throw new Error("This staging site is password protected. Add the staging password in the project settings.");
  cookie = await login(url, html, password);
  if (!cookie) throw new Error("Couldn't log in to the staging site. Check the staging password in the project settings.");

  res = await get(url, cookie, accept);
  if (res.status === 401) throw new Error("The staging password was rejected. Update it in the project settings.");
  await s.setJSON(cookieKey(host), { cookie, at: new Date().toISOString() });
  return res;
}

export const stagingPassword = (project) => project?.password || process.env.STAGING_PASSWORD || "";
