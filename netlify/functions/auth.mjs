// Team sign-in.
//   GET  /api/auth/me       -> { user, admin, googleClientId, domain, tokenMode }
//   POST /api/auth/google   { credential }  (Google Identity Services ID token) -> sets session cookie
//   POST /api/auth/logout   clears the session cookie
import { json, error, readBody, handle, isAdmin } from "./_lib/store.mjs";
import { authConfig, sessionUser, sessionCookie, clearCookie, verifyGoogleCredential } from "./_lib/auth.mjs";

const withCookie = (res, cookie) => {
  res.headers.append("set-cookie", cookie);
  return res;
};

export default handle(async (req, context) => {
  const action = context.params?.action;
  const { googleClientId, domain } = authConfig();

  if (req.method === "GET" && action === "me") {
    return json({
      user: sessionUser(req),
      admin: isAdmin(req),
      googleClientId,
      domain,
      tokenMode: Boolean(process.env.ADMIN_TOKEN),
    });
  }

  if (req.method === "POST" && action === "google") {
    if (!googleClientId) return error(400, "Google sign-in isn't set up (GOOGLE_CLIENT_ID is missing).");
    const { credential } = await readBody(req);
    if (!credential) return error(400, "Missing Google credential");
    let user;
    try {
      user = await verifyGoogleCredential(credential);
    } catch (e) {
      return error(403, e.message);
    }
    return withCookie(json({ user }), sessionCookie(user));
  }

  if (req.method === "POST" && action === "logout") return withCookie(json({ ok: true }), clearCookie());

  return error(404, "Not found");
});

export const config = { path: "/api/auth/:action" };
