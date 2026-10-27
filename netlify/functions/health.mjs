// Diagnostics: GET /api/health
// Reports the deployed version and exercises storage the same way posting a comment does.
import { store, newId, json, handle } from "./_lib/store.mjs";
import { VERSION } from "./_lib/version.mjs";

export default handle(async () => {
  const s = store();
  const key = `health/${newId()}`;
  const steps = {};
  const time = async (name, fn) => {
    const t = Date.now();
    try {
      await fn();
      steps[name] = `ok (${Date.now() - t}ms)`;
    } catch (e) {
      steps[name] = `FAILED: ${e?.message || e}`;
    }
  };
  await time("write", () => s.setJSON(key, { at: new Date().toISOString() }));
  await time("read", async () => {
    if (!(await s.get(key))) throw new Error("value not found after write");
  });
  await time("list", () => s.list({ prefix: "health/" }));
  await time("delete", () => s.delete(key));
  const ok = Object.values(steps).every((v) => v.startsWith("ok"));
  return json({
    ok,
    version: VERSION,
    node: process.version,
    storage: steps,
    anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    stagingPassword: Boolean(process.env.STAGING_PASSWORD),
    adminToken: Boolean(process.env.ADMIN_TOKEN),
  });
});

export const config = { path: "/api/health" };
