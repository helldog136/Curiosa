// Redirections 2 : branchements (le proxy détourne les liens terminés, la page ne révèle rien, textes en FR + EN, aucun texte en dur).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(f, "utf8");

test("proxy : la porte des liens terminés est bornée dans le temps et ne touche que GET/HEAD", () => {
  const proxy = read("src/proxy.ts");
  assert.match(proxy, /isRedirectEnded/); assert.match(proxy, /withDeadline\(/); assert.match(proxy, /GATE_MAX_MS = 1500/);
  assert.match(proxy, /request\.method !== "GET" && request\.method !== "HEAD"/);
  assert.match(proxy, /\/api\/redirect-gone/);
});

test("page publique : un lien désactivé ne réclame pas le chemin (même réponse qu'un lien inconnu) ; l'équipe connectée et les aperçus ne comptent pas", () => {
  const page = read("src/app/(site)/[...path]/page.tsx");
  assert.match(page, /path: segs\.join\("\/"\), active: true/);
  assert.match(page, /"gone" in target\) notFound\(\)/);
  assert.match(page, /isPrefetchRequest/); assert.match(page, /team:/);
});

test("aucune écriture ni minuteur de fond dans le compteur ; seulement « redirection + jour → nombre »", () => {
  const stats = read("src/core/redirectStats.ts");
  assert.ok(!/setInterval|setTimeout|cron/i.test(stats), "aucun minuteur");
  assert.ok(!/cookie|ipAddress|x-forwarded|referer|referrer/i.test(stats.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "aucune donnée de visiteur lue");
  const schema = read("prisma/schema.prisma");
  const model = /model RedirectDay \{([\s\S]*?)\n\}/.exec(schema)[1];
  assert.deepEqual([...model.matchAll(/^\s{2}(\w+)\s+\w+/gm)].map((m) => m[1]).filter((n) => !["redirect"].includes(n) && n !== "id"), ["redirectId", "day", "hits"]);
});

test("textes : toutes les clés « redirects.* » et « site.gone.* » existent en français ET en anglais", () => {
  const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));
  const used = new Set();
  for (const f of ["src/app/admin/(panel)/redirects/page.tsx", "src/app/admin/(panel)/redirects/[id]/page.tsx", "src/app/admin/(panel)/redirects/actions.ts", "src/app/api/redirect-gone/route.ts", "src/app/api/admin/redirects/export/route.ts", "src/app/api/admin/redirects/[id]/qr/route.ts", "src/core/redirects.ts", "src/core/redirectMcp.ts", "src/app/admin/(panel)/settings/page.tsx", "src/app/admin/(panel)/settings/actions.ts"]) {
    for (const m of read(f).matchAll(/["'`]((?:redirects|site\.gone|settings\.timezone)[\w.]*)["'`]/g)) used.add(m[1]);
  }
  for (const k of ["redirects.csv.address", "redirects.csv.target", "redirects.csv.state", "redirects.csv.end", "redirects.csv.total", "redirects.csv.month", "redirects.csv.created"]) used.add(k);
  for (const k of ["active", "ended", "off"]) used.add(`redirects.state.${k}`);
  assert.ok(used.size > 40);
  for (const k of used) { if (k.endsWith(".") || !k.includes(".")) continue; assert.ok(fr[k], `fr manque ${k}`); assert.ok(en[k], `en manque ${k}`); }
  for (const k of Object.keys(fr).filter((k) => /^(redirects|site\.gone)\./.test(k))) assert.ok(en[k], `en manque ${k}`);
});

test("QR : le téléchargement SVG/PNG et la fiche passent par la bibliothèque du cœur ; aucun encodeur réécrit", () => {
  const qr = read("src/core/redirectQr.ts");
  assert.match(qr, /from "qrcode"/); assert.ok(!/reedSolomon|galois|penalty/i.test(qr));
});

test("raccourcis (kit d'administration) : recherche en direct dès le départ, interrupteur, « Supprimer » dans le menu, date de fin en un champ", () => {
  const list = read("src/app/admin/(panel)/redirects/page.tsx");
  assert.match(list, /<LiveSearch mode="server"/, "recherche en direct qui interroge le serveur (liste paginée)");
  assert.doesNotMatch(list, /list\.total > 8/, "plus de seuil : elle est là dès le premier lien");
  assert.ok(!/redirects\.searchButton/.test(list), "pas de bouton « Chercher »");
  assert.match(list, /<Switch label=\{t\("redirects\.switch\.label"/);
  assert.match(list, /onToggle=\{setRedirectActive\.bind\(null, r\.id\)\}/);
  assert.ok(!/action\.disable|action\.enable|toggleRedirect/.test(list), "plus de bouton « Désactiver / Activer »");
  assert.match(list, /<RowMenu[\s\S]*<ConfirmButton menu[\s\S]*redirects\.deleteMenu/, "« Supprimer » est rangé dans le menu ⋯");
  assert.match(list, /<DateTimeField name="end" optionalTime/);
  assert.ok(!/name="endDate"|name="endTime"/.test(list), "la date et l'heure de fin ne sont plus deux champs");
  assert.match(list, /<MoreOptions /);
  assert.match(list, /truncate text-sm text-muted" title=\{target\}/, "destination coupée par « … », complète dans l'info-bulle");
  assert.match(list, /data-live-item="redirects"/);
  const sheet = read("src/app/admin/(panel)/redirects/[id]/page.tsx");
  assert.match(sheet, /<Switch label=/);
  assert.ok(!/toggleRedirect|action\.disable/.test(sheet));
  assert.match(sheet, /<DateTimeField name="end" optionalTime/);
  const actions = read("src/app/admin/(panel)/redirects/actions.ts");
  assert.match(actions, /export async function setRedirectActive\(id: string, active: boolean\)/, "l'interrupteur dit l'état voulu, il n'inverse rien");
  assert.ok(!/export function/.test(actions), "un fichier d'actions n'exporte que des actions asynchrones");
});
