import { createRequire } from "node:module";
import fs from "node:fs";
export const { chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright");
export const PORT = process.env.PORT || "3552";
export const B = `http://127.0.0.1:${PORT}`;
export const SHOTS = "/tmp/claude-0/-home-user/4e3492ee-8e17-57de-8380-ae93be24b42a/scratchpad/skins-s7";
fs.mkdirSync(SHOTS, { recursive: true });
export let fails = 0;
export const check = (ok, what, extra = "") => { console.log(`${ok ? "OK   " : "ÉCHEC"} ${what}${extra ? " — " + extra : ""}`); if (!ok) fails++; };
export const launch = () => chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
/** Contexte connecté à l'administration. */
export async function admin(browser, { width = 1280, height = 900, scheme = "light", locale = "fr-FR", reduced = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion: reduced ? "reduce" : "no-preference", locale });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
  await page.goto(B + "/admin/login", { waitUntil: "networkidle", timeout: 120000 });
  await page.locator('input[name="email"]').fill("owner@example.org");
  await page.locator('input[name="password"]').fill("e2e-password-123");
  await Promise.all([page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 120000 }), page.locator('button[type="submit"]').first().click()]);
  return { ctx, page, errors };
}
export const shot = (page, name, full = true) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
