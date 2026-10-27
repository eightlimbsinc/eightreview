// Team authentication.
//  - GOOGLE_CLIENT_ID set: team members sign in with Google; verified accounts on
//    ALLOWED_DOMAIN (default 8limbsinc.net) or listed in ALLOWED_EMAILS get a session cookie.
//  - ADMIN_TOKEN set: the shared token (x-admin-token header) also works, as a fallback.
//  - Neither set: everything is open (local dev / first deploy).
import crypto from "node:crypto";

export const COOKIE = "er_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export const authConfig = () => ({
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  domain: (process.env.ALLOWED_DOMAIN || "8limbsinc.net").toLowerCase().replace(/^@/, ""),
  // Individual addresses (e.g. personal @gmail.com accounts), comma or space separated.
  emails: (process.env.ALLOWED_EMAILS || "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
});

export function isAllowedEmail(email, hd) {
  const { domain, emails } = authConfig();
  email = String(email || "").toLowerCase();
  if (emails.includes(email)) return true;
  // Domain rule: never for public mail domains, which anyone can sign up for.
  if (!domain || ["gmail.com", "googlemail.com"].includes(domain)) return false;
  return email.endsWith(`@${domain}`) && (!hd || hd.toLowerCase() === domain);
}

const secret = () => process.env.AUTH_SECRET || process.env.ADMIN_TOKEN || process.env.GOOGLE_CLIENT_ID || "";
const sign = (data) => crypto.createHmac("sha256", secret()).update(data).digest("base64url");

export function sessionCookie(user) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function sessionUser(req) {
  const raw = (req.headers.get("cookie") || "")
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw || !secret()) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!user.exp || user.exp < Date.now()) return null;
    // A session from before the domain was changed shouldn't keep working.
    if (!isAllowedEmail(user.email)) return null;
    return { email: user.email, name: user.name, picture: user.picture };
  } catch {
    return null;
  }
}

// Verifies a Google Identity Services credential (ID token) with Google.
export async function verifyGoogleCredential(credential) {
  const { googleClientId, domain } = authConfig();
  const url = `${process.env.GOOGLE_TOKENINFO_URL || "https://oauth2.googleapis.com/tokeninfo"}?id_token=${encodeURIComponent(credential)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Google couldn't verify this sign-in. Try again.");
  const info = await res.json();
  if (info.aud !== googleClientId) throw new Error("This sign-in was issued for a different app.");
  if (info.email_verified !== true && info.email_verified !== "true") throw new Error("Your Google email isn't verified.");
  const email = String(info.email || "").toLowerCase();
  if (!isAllowedEmail(email, info.hd)) {
    throw new Error(`${email} isn't on the team list. Ask an admin to add you (ALLOWED_EMAILS), or use your @${domain} account.`);
  }
  return { email, name: info.name || email.split("@")[0], picture: info.picture || "" };
}

// Is this request from the team?
export function isAdmin(req) {
  const { googleClientId } = authConfig();
  const token = process.env.ADMIN_TOKEN;
  if (!googleClientId && !token) return true;
  if (sessionUser(req)) return true;
  return Boolean(token) && req.headers.get("x-admin-token") === token;
}
