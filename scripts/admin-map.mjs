#!/usr/bin/env node
// admin-map: derives, FROM THE CODE, the complete list of administration addresses and menu entries.
//
//   node scripts/admin-map.mjs                    text summary of the core (routes, sidebar, who sees what)
//   node scripts/admin-map.mjs --extras DIR       also the modules of a curiosa-extras checkout (modules/<id>/module.json + catalogue/places.json)
//   node scripts/admin-map.mjs --json             the full map as JSON
//   node scripts/admin-map.mjs --write-baseline   rewrite tests/admin-map-baseline.json (core) [and tests/admin-map-modules-baseline.json with --extras]
//
// Why: the administration is being redesigned (docs of the plan: nothing may disappear, nothing may appear unnoticed). The ratchet test
// tests/core/admin-map.test.mjs compares this map to the committed baselines: a page, a handler, a redirect, a sidebar entry, a guard or a module
// placement that is added, removed or changed makes the test fail until the baseline is updated on purpose, in the same pull request.
//
// What is read (nothing is hand-written here):
//   - the route tree `src/app/admin`, `src/app/api/admin`, `src/app/api/setup` (page.tsx and route.ts files, their guard `adminCtx(...)`);
//   - the sidebar markup `src/app/admin/(panel)/layout.tsx` (every <NavLink> with its guard and heading) and the address constants of `src/core/adminLinks.ts`;
//   - the menu rules of the core itself, called for real: `administrationEntries`, `maintenanceTabs` (src/core/modules/adminMenu.ts);
//   - the module manifests, with the core's own functions (`moduleSections`, `fullyPlaced`, `placeIssues`, `defaultPlacement`, `defaultSection`, `buildPlaceIndex`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..");
export const BASELINE_FILE = "tests/admin-map-baseline.json";
export const MODULES_BASELINE_FILE = "tests/admin-map-modules-baseline.json";

/** The trees that hold administration addresses (relative to the repository root). */
export const ROUTE_ROOTS = [
  { dir: "src/app/admin", base: "/admin" },
  { dir: "src/app/api/admin", base: "/api/admin" },
  { dir: "src/app/api/setup", base: "/api/setup" },
];

const read = (file) => fs.readFileSync(file, "utf8");

// ── 1. The route tree ─────────────────────────────────────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "page.tsx" || e.name === "route.ts") out.push(p);
  }
  return out;
}

/** The guard written in a route file: `adminCtx("admin")` → `admin`, `adminCtx({ right: "core:updates" })` → `right:core:updates`. */
export function guardOf(source) {
  const m = /adminCtx\(\s*([^)]*?)\s*\)\s*(?:[;,.]|$)/m.exec(source) ?? /adminCtx\(([^\n]*)\)/.exec(source);
  if (!m) return null;
  const arg = m[1].replace(/\s+/g, " ").trim();
  const level = /^"(\w+)"/.exec(arg);
  const right = /right:\s*"([^"]+)"/.exec(arg);
  if (level && !right) return /allowUnenrolled|allowForced/.test(arg) ? `${level[1]} (before 2-step enrolment)` : level[1];
  if (right) return `right:${right[1]}`;
  return arg.length > 60 ? `${arg.slice(0, 57)}...` : arg;
}

/** Is a page file only a redirect (an old address kept alive)? */
export function isRedirectPage(source) {
  return /\b(?:permanentRedirect|redirect)\(/.test(source) && !/return\s*\(?\s*</.test(source);
}

/** First argument of the redirect call, only to help a human reading the text output (never in a baseline). */
function redirectHint(source) {
  const m = /\b(?:permanentRedirect|redirect)\(([^\n]{0,110})/.exec(source);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

/**
 * Next.js file path → address. Route groups `(x)` vanish; a parallel slot `@x` is a modal variant of the page above it; an intercepting folder
 * `(.)x` / `(..)x` shows another address in that slot. Dynamic parts stay as written (`[id]`).
 */
export function routeOf(relative, base) {
  const parts = relative.split(path.sep).slice(0, -1);
  const out = [];
  let group = null;
  let slot = null;
  let intercepts = false;
  for (const seg of parts) {
    if (/^\(\.{1,3}\)/.test(seg) || /^\(\.\.\.\)/.test(seg)) {
      intercepts = true;
      const up = /^\((\.{1,3})\)/.exec(seg)[1].length - 1;
      if (seg.startsWith("(...)")) out.length = 0;
      else for (let i = 0; i < up; i += 1) out.pop();
      out.push(seg.replace(/^\(\.{1,3}\)/, ""));
    } else if (/^\(.+\)$/.test(seg)) group = seg.slice(1, -1);
    else if (seg.startsWith("@")) slot = seg.slice(1);
    else out.push(seg);
  }
  return { route: `${base}${out.length ? `/${out.join("/")}` : ""}`, group, slot, intercepts };
}

export function readRoutes(repo = REPO_ROOT) {
  const routes = {};
  for (const { dir, base } of ROUTE_ROOTS) {
    const abs = path.join(repo, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs).sort()) {
      const source = read(file);
      const { route, group, slot, intercepts } = routeOf(path.relative(abs, file), base);
      const handler = path.basename(file) === "route.ts";
      const kind = handler ? "handler" : slot || intercepts ? "modal" : isRedirectPage(source) ? "redirect" : "page";
      const key = `${route}${slot ? ` @${slot}` : ""}${handler ? " (handler)" : ""}`;
      if (routes[key]) throw new Error(`admin-map: two files give the same address ${key}`);
      const entry = { kind, shell: group ?? (base === "/admin" ? "root" : "api"), guard: guardOf(source), file: path.relative(repo, file).split(path.sep).join("/") };
      Object.defineProperty(entry, "hint", { value: kind === "redirect" ? redirectHint(source) : "", enumerable: false });
      routes[key] = entry;
    }
  }
  return Object.fromEntries(Object.entries(routes).sort(([a], [b]) => a.localeCompare(b)));
}

// ── 2. The sidebar ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Constants of adminLinks.ts that are plain strings (`export const X_HREF = "/admin/x"`), resolved by reading, not by importing. */
export function readHrefConstants(repo = REPO_ROOT) {
  const src = read(path.join(repo, "src/core/adminLinks.ts"));
  const consts = {};
  for (const m of src.matchAll(/^export const (\w+)\s*=\s*"([^"]*)";?/gm)) consts[m[1]] = m[2];
  // `${A}/x` or `${A}#x` built from earlier constants.
  for (const m of src.matchAll(/^export const (\w+)\s*=\s*`([^`]*)`;?/gm)) {
    const value = m[2].replace(/\$\{(\w+)\}/g, (_, n) => consts[n] ?? `\${${n}}`);
    if (!value.includes("${")) consts[m[1]] = value;
  }
  return consts;
}

/** The tabs of Maintenance, from MAINTENANCE_TAB_HREFS (adminLinks.ts), resolved with the constants. */
function readMaintenanceTabs(consts) {
  return { health: consts.HEALTH_HREF, backup: consts.BACKUP_HREF, updates: consts.UPDATES_HREF, upkeep: consts.UPKEEP_HREF, audit: consts.AUDIT_HREF };
}

const NEED_GUARD = { member: "member", editor: "editor", admin: "admin" };

/** The fixed entries of the sidebar are DATA in src/core/adminSidebar.ts (one entry per line, in three lists); this names the heading each list sits under. */
const MODEL_LISTS = [
  { name: "DASHBOARD_LINK", section: "(top)" },
  { name: "SITE_LINKS", section: "nav.site" },
  { name: "CONNECTIONS_LINK", section: "nav.site" },
  { name: "ADMIN_LINKS", section: "nav.admin" },
  { name: "ACCOUNT_LINKS", section: "nav.account" },
];

/**
 * Every entry of the sidebar: the fixed ones are read from the model (src/core/adminSidebar.ts, as text), the custom overlay pages from the layout line that
 * builds them. The layout itself must not write an address of its own: `layoutLiteralNavLinks` counts the <NavLink> tags that do, and the test wants zero.
 */
export function readSidebar(repo = REPO_ROOT) {
  const model = read(path.join(repo, "src/core/adminSidebar.ts"));
  const layout = read(path.join(repo, "src/app/admin/(panel)/layout.tsx"));
  const consts = readHrefConstants(repo);
  const resolve = (expr) => {
    const e = expr.trim();
    if (/^"[^"]*"$/.test(e)) return e.slice(1, -1);
    return consts[e] ?? `{${e}}`;
  };
  const entries = [];
  let section = null;
  let modelLines = 0;
  for (const line of model.split("\n")) {
    const list = /^export const (\w+)\b/.exec(line);
    if (list) section = MODEL_LISTS.find((l) => l.name === list[1])?.section ?? null;
    if (!section || !/\bid: "\w+", label: "nav\.\w+"/.test(line)) continue;
    modelLines += 1;
    const attrs = line;
    const labelKey = /label: "([\w.]+)"/.exec(attrs)?.[1] ?? null;
    const href = /\bhref: ([\w]+|"[^"]*")/.exec(attrs)?.[1];
    if (!href) continue;
    const alsoRaw = /\balso: \[([^\]]*)\]/.exec(attrs)?.[1] ?? "";
    const also = alsoRaw.split(",").map((x) => x.trim()).filter((x) => x && !x.startsWith("...")).map(resolve);
    const tabs = /\btabs: true\b/.test(attrs);
    const need = /\bneed: "(\w+)"/.exec(attrs)?.[1] ?? "member";
    entries.push({
      section,
      label: labelKey,
      href: resolve(href),
      also: (tabs ? Object.values(readMaintenanceTabs(consts)) : also).sort(),
      guard: section === "nav.admin" ? "see access.administration" : NEED_GUARD[need] ?? need,
      external: /\bexternal: true\b/.test(attrs),
      slot: section === "nav.admin" ? /id: "(\w+)"/.exec(attrs)?.[1] ?? null : null,
    });
  }
  for (const line of layout.split("\n")) {
    // Entries built from data rather than listed in the model (the custom overlay pages join the Overlays group).
    const dyn = /id: "(core:[\w-]+)".*?href: (\w+)/.exec(line);
    if (dyn) entries.push({ section: "nav.dynamic", label: dyn[1], href: resolve(dyn[2]), also: [], guard: "admin (and a site that uses overlays)", external: false, slot: null });
  }
  // A <NavLink> of the layout that carries an address of its own (a literal or an `_HREF` constant) bypasses the model: the map could not see it.
  const layoutLiteralNavLinks = [...layout.matchAll(/<NavLink\b[^>]*\bhref=(?:"[^"]*"|\{[A-Z_]+_HREF\})/g)].length;
  return { entries, literalLinks: modelLines, parsedLinks: entries.filter((e) => e.section !== "nav.dynamic").length, layoutLiteralNavLinks, layoutNavLinkTags: (layout.match(/<NavLink\b/g) ?? []).length };
}

/** The dynamic parts of the sidebar, named once so that a rename is noticed: the four sections that modules fill, and what is built from data. */
export function readSidebarShape(repo = REPO_ROOT) {
  const menu = read(path.join(repo, "src/core/modules/adminMenu.ts"));
  const keys = {};
  const block = /export const SIDEBAR_R12_KEYS = (\{[\s\S]*?\n\}) as const;/.exec(menu)?.[1] ?? "";
  for (const m of block.matchAll(/(\w+):\s*"(nav\.[\w.]+)"/g)) keys[m[1]] = m[2];
  return { sectionKeys: keys };
}

// ── 3. Who sees what (the core's own functions, called) ─────────────────────────────────────────────────────────────────

const LEVELS = ["owner", "coordinator", "admin", "editor", "none"];

export async function readAccess(repo = REPO_ROOT) {
  const adminMenu = await import(pathToFileURL(path.join(repo, "src/core/modules/adminMenu.ts")).href);
  const out = { administration: {}, maintenanceTabs: {} };
  for (const role of LEVELS) {
    for (const advanced of [false, true]) {
      const mode = advanced ? "advanced" : "simple";
      out.administration[`${role}/${mode}`] = adminMenu.administrationEntries({ role, advanced, overlays: true });
      out.maintenanceTabs[`${role}/${mode}`] = adminMenu.maintenanceTabs({ role, advanced });
    }
  }
  out.advancedOnlyEntries = [...adminMenu.ADVANCED_ONLY_ENTRIES];
  out.advancedOnlyTabs = [...adminMenu.ADVANCED_ONLY_TABS];
  return out;
}

// ── 4. The modules ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Reads modules/<id>/module.json of a modules repository (curiosa-extras layout, or the test fixtures). */
export async function readModules(extrasDir, repo = REPO_ROOT) {
  const places = await import(pathToFileURL(path.join(repo, "src/core/modules/places.ts")).href);
  const placement = await import(pathToFileURL(path.join(repo, "src/core/modules/menuPlacement.ts")).href);
  const placesFile = path.join(extrasDir, "catalogue", "places.json");
  const vocab = places.mergeVocabulary(places.BUILTIN_VOCABULARY, fs.existsSync(placesFile) ? places.sanitizeVocabulary(JSON.parse(read(placesFile))) : null);
  const modulesDir = path.join(extrasDir, "modules");
  const modules = {};
  const contributions = [];
  for (const id of fs.readdirSync(modulesDir).sort()) {
    const file = path.join(modulesDir, id, "module.json");
    if (!fs.existsSync(file)) continue;
    const m = JSON.parse(read(file));
    let sections = [];
    let placed = false;
    let issues = [];
    try {
      sections = places.moduleSections(m, vocab.aliases);
      placed = sections.length > 0 && places.fullyPlaced(m, sections, (s) => places.isCorePage(s.place, vocab));
      issues = places.placeIssues(m, vocab);
    } catch (error) { issues = [`ERROR ${error.message}`]; }
    const defaultPlace = placement.defaultPlacement(m);
    const dashboard = m.dashboard && typeof m.dashboard === "object" ? Object.fromEntries(Object.entries(m.dashboard).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])) : null;
    modules[m.id ?? id] = {
      placement: defaultPlace,
      section: placement.defaultSection(m),
      menuPath: typeof m.adminMenu === "string" ? m.adminMenu : null,
      content: !!m.content,
      // A module that places everything it shows leaves the sidebar; the others (pinned by default) keep their own entry.
      ownSidebarEntry: defaultPlace === "menu" && !placed,
      fullyPlaced: placed,
      placeSections: sections.map((s) => placeId(places, s.place)).sort(),
      placeIssues: issues,
      dashboard,
      rights: Array.isArray(m.rights) ? m.rights.length : 0,
    };
    sections.forEach((section, i) => contributions.push({
      instanceId: m.id ?? id, instanceKey: m.id ?? id, moduleId: m.id ?? id, moduleName: String(m.name?.en ?? m.id ?? id), instanceLabel: String(m.name?.en ?? m.id ?? id),
      siblings: false, connector: m.type === "integration", section, visible: true, i,
    }));
  }
  const index = places.buildPlaceIndex(contributions, vocab, "en");
  const placeRoutes = {};
  for (const g of index.groups) {
    for (const p of g.pages) {
      if (p.core) continue; // a core page keeps its own address (listed in the route tree)
      p.tabs.forEach((t, i) => {
        const route = i === 0 ? p.href : `${p.href}/${t.id}`;
        placeRoutes[route] = { group: g.id, page: p.page, tab: t.id, firstTab: i === 0, modules: [...new Set(t.sections.map((s) => s.moduleId))].sort() };
      });
    }
  }
  return { modules, placeRoutes: Object.fromEntries(Object.entries(placeRoutes).sort(([a], [b]) => a.localeCompare(b))), warnings: index.warnings };
}

const placeId = (places, p) => (typeof places.placeId === "function" ? places.placeId(p) : `${p.group}.${p.page}${p.tab ? `.${p.tab}` : ""}`);

// ── 5. The map, the baselines, the comparison ───────────────────────────────────────────────────────────────────────────

export async function buildAdminMap({ repo = REPO_ROOT, extrasDir = null } = {}) {
  const sidebar = readSidebar(repo);
  const map = {
    version: 1,
    core: {
      routes: readRoutes(repo),
      sidebar: { ...readSidebarShape(repo), entries: sidebar.entries },
      access: await readAccess(repo),
    },
    sidebarParse: { literalLinks: sidebar.literalLinks, parsedLinks: sidebar.parsedLinks, layoutLiteralNavLinks: sidebar.layoutLiteralNavLinks, layoutNavLinkTags: sidebar.layoutNavLinkTags },
  };
  if (extrasDir) map.modules = await readModules(extrasDir, repo);
  return map;
}

/** What is committed for the core: addresses with their kind and guard, sidebar entries, and the access matrix. */
export function coreBaseline(map) {
  const routes = Object.fromEntries(Object.entries(map.core.routes).map(([k, v]) => [k, { kind: v.kind, shell: v.shell, guard: v.guard }]));
  const sidebar = Object.fromEntries(map.core.sidebar.entries.map((e) => [`${e.section} | ${e.label ?? e.href}`, { href: e.href, also: e.also, guard: e.guard, ...(e.external ? { external: true } : {}) }]));
  return { note: "Generated by `node scripts/admin-map.mjs --write-baseline`. Edit by running the script, never by hand: a diff here is a page, a menu entry or an access that changed.", routes, sidebar: { sectionKeys: map.core.sidebar.sectionKeys, entries: sidebar }, access: map.core.access };
}

export function modulesBaseline(map) {
  return { note: "Generated by `node scripts/admin-map.mjs --extras <curiosa-extras> --write-baseline`. Read only when a modules checkout is available (CURIOSA_EXTRAS_DIR or ../curiosa-extras).", modules: map.modules.modules, placeRoutes: map.modules.placeRoutes };
}

/** Differences between two plain JSON values, as readable lines, one per leaf key of the first two levels. */
export function diffKeyed(label, base, now) {
  const lines = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const k of Object.keys(base)) if (!(k in now)) lines.push(`REMOVED ${label} ${k}`);
  for (const k of Object.keys(now)) if (!(k in base)) lines.push(`ADDED   ${label} ${k}  ${JSON.stringify(now[k])}`);
  for (const k of Object.keys(now)) if (k in base && !same(base[k], now[k])) lines.push(`CHANGED ${label} ${k}  ${JSON.stringify(base[k])} -> ${JSON.stringify(now[k])}`);
  return lines;
}

export function diffCore(baseline, map) {
  const now = coreBaseline(map);
  return [
    ...diffKeyed("route", baseline.routes, now.routes),
    ...diffKeyed("sidebar", baseline.sidebar.entries, now.sidebar.entries),
    ...diffKeyed("sidebar-section-key", baseline.sidebar.sectionKeys, now.sidebar.sectionKeys),
    ...diffKeyed("access.administration", baseline.access.administration, now.access.administration),
    ...diffKeyed("access.maintenanceTabs", baseline.access.maintenanceTabs, now.access.maintenanceTabs),
    ...(JSON.stringify([baseline.access.advancedOnlyEntries, baseline.access.advancedOnlyTabs]) === JSON.stringify([now.access.advancedOnlyEntries, now.access.advancedOnlyTabs]) ? [] : ["CHANGED access advancedOnly entries/tabs"]),
  ];
}

export function diffModules(baseline, map) {
  const now = modulesBaseline(map);
  return [...diffKeyed("module", baseline.modules, now.modules), ...diffKeyed("place-route", baseline.placeRoutes, now.placeRoutes)];
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

function textSummary(map) {
  const out = [];
  const routes = Object.entries(map.core.routes);
  const byKind = {};
  for (const [, v] of routes) byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
  out.push(`Routes: ${routes.length} (${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(", ")})`);
  for (const [k, v] of routes) out.push(`  ${v.kind.padEnd(8)} ${k.padEnd(62)} ${v.guard ?? "-"}${v.hint ? `   -> ${v.hint}` : ""}`);
  out.push("", `Sidebar entries written in the layout: ${map.core.sidebar.entries.length}`);
  for (const e of map.core.sidebar.entries) out.push(`  ${e.section.padEnd(14)} ${(e.label ?? "").padEnd(18)} ${e.href}${e.also.length ? `  (also ${e.also.join(", ")})` : ""}  [${e.guard}]`);
  out.push("", "Administration entries by role/mode:");
  for (const [k, v] of Object.entries(map.core.access.administration)) out.push(`  ${k.padEnd(22)} ${v.join(", ") || "(none)"}   maintenance: ${map.core.access.maintenanceTabs[k].join(", ") || "(none)"}`);
  if (map.modules) {
    const mods = Object.entries(map.modules.modules);
    out.push("", `Modules: ${mods.length} (${mods.filter(([, m]) => m.fullyPlaced).length} fully placed, ${mods.filter(([, m]) => m.ownSidebarEntry).length} keep their own sidebar entry: ${mods.filter(([, m]) => m.ownSidebarEntry).map(([id]) => id).join(", ")})`);
    out.push(`Place routes built from the modules: ${Object.keys(map.modules.placeRoutes).length}`);
  }
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  await import("../tests/helpers/register.mjs");
  const extrasDir = value("--extras") ? path.resolve(value("--extras")) : null;
  const map = await buildAdminMap({ extrasDir });
  if (flag("--write-baseline")) {
    fs.writeFileSync(path.join(REPO_ROOT, BASELINE_FILE), `${JSON.stringify(coreBaseline(map), null, 1)}\n`);
    console.log(`wrote ${BASELINE_FILE}`);
    if (map.modules) {
      fs.writeFileSync(path.join(REPO_ROOT, MODULES_BASELINE_FILE), `${JSON.stringify(modulesBaseline(map), null, 1)}\n`);
      console.log(`wrote ${MODULES_BASELINE_FILE}`);
    }
  } else if (flag("--json")) {
    console.log(JSON.stringify(map, null, 1));
  } else {
    console.log(textSummary(map));
  }
}
