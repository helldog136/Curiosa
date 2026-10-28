import { launch, admin, B, shot, check } from "./lib.mjs";
const b = await launch();
for (const [w, tag] of [[1280, "1280"], [390, "390"]]) {
  const { page, errors } = await admin(b, { width: w, height: 900, scheme: "dark", locale: "en-US" });
  await page.goto(B + "/admin/appearance", { waitUntil: "networkidle", timeout: 120000 });
  check((await page.locator("h1").innerText()) === "Appearance", `EN ${tag} : titre Appearance`);
  check(await page.locator("text=Choose a skin").count() > 0, `EN ${tag} : textes anglais`);
  const raw = await page.evaluate(() => /\bappearance\.[a-z]+\./.test(document.body.innerText));
  check(!raw, `EN ${tag} : aucune clé brute`);
  // cibles tactiles : tous les boutons et summary visibles >= 44 px de haut
  const small = await page.evaluate(() => [...document.querySelectorAll("main button, main summary, main a.min-h-11, main [role=tab]")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5; }).map((e) => (e.textContent || "").trim().slice(0, 30) + ":" + Math.round(e.getBoundingClientRect().height)));
  check(small.length === 0, `${tag} : cibles >= 44 px`, small.join(" | "));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  check(!overflow, `${tag} : pas de défilement horizontal`);
  await shot(page, `20-en-dark-${tag}`);
  check(errors.length === 0, `${tag} : console propre`, errors.join(" ").slice(0, 200));
}
await b.close();
