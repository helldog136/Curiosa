// Sample plans of every level 3 action, as the preparation freezes them. Used by the registry tests to pin what the owner reads (summary) and what the journal keeps (audit text).
// Invented names only.
const bundleItem = (module, to, adds = [], extra = {}) => ({ module, name: module.toUpperCase(), to, adds, permissions: [], ...extra });

export const PLAN_SAMPLES = [
  ["core_update", { from: "0.46.1", to: "0.47.0", level: "minor" }],
  ["module_update", { module: "etoile-nord", from: "1.0.0", to: "1.1.0", level: "minor" }],
  ["modules_update_all", { modules: [{ id: "etoile-nord", from: "1.0.0", to: "1.1.0" }, { id: "lune-douce", from: "2.0.0", to: "2.0.1" }] }],
  ["module_uninstall", { module: "etoile-nord", from: "1.0.0", keepData: true }],
  ["module_uninstall", { module: "etoile-nord", from: "1.0.0", keepData: false }],
  ["module_install", { module: "journal", name: "Journal", to: "1.2.0", adds: [{ id: "fournisseur", action: "install", name: "Fournisseur" }, { id: "autre", action: "setup" }], instanceKey: "journal-news", permissions: ["media.read", "not.a.permission"] }],
  ["module_install", { module: "journal", name: "Journal", to: "1.2.0", adds: [], permissions: [] }],
  ["module_install", { bundle: [bundleItem("journal", "1.2.0", [], { permissions: ["media.read"] }), bundleItem("liens", "0.3.0", [{ id: "journal", action: "setup" }], { instanceKey: "liens-1" })] }],
  ["skin_install", { skin: "aurore", name: "Aurore", to: "1.0.0" }],
  ["skin_activate", { skin: "aurore", name: "Aurore", from: "basic" }],
  ["skin_remove", { skin: "aurore", name: "Aurore", from: "1.0.0" }],
  ["font_set", { fonts: { titles: "lib:lora", names: "titles: Lora" } }],
  ["skin_set_options", { skin: "aurore", options: { mode: "dark", colors: { accent: "#112233", background: "" }, names: "colours (dark mode): accent #112233, background skin's own" }, fonts: { text: "sys:serif", names: "text: system serif" } }],
  ["skin_set_options", { skin: "aurore", options: { colors: { textColor: "#ffffff" }, names: "colours: textColor #ffffff" } }],
  ["skin_set_options", { skin: "aurore", fonts: { titles: "", names: "titles: the skin's own" } }],
  ["skin_customize", { skin: "aurore", customize: { values: { halo: "gold" }, look: "soir", reset: [], names: "look soir" } }],
  ["instance_add", { module: "journal", name: "Journal", newInstance: { nickname: "Actus" } }],
  ["entry_publish", { entry: { instance: "actus", locale: "fr", items: [{ id: "e1", title: "Bonjour", locales: ["en", "fr"], fp: "0123456789abcdef", skin: "aurore" }, { id: "e2", title: "", locales: ["en"], fp: "fedcba9876543210" }] } }],
  ["entry_unpublish", { entry: { instance: "actus", items: [{ id: "e1", title: "Bonjour", locales: ["en"], fp: "0123456789abcdef" }] } }],
  ["site_settings_set", { site: { changes: [{ field: "name", from: "A", fromFp: "x", to: "B" }], names: "name, tagline" } }],
  ["navigation_set", { change: { target: "navigation", before: "f1", entries: [], summary: { beforeCount: 3, afterCount: 5, added: ["Accueil", "Contact"], removed: ["Ancien"], changed: ["Blog"], reordered: true, same: false } } }],
  ["navigation_set", { change: { target: "navigation", before: "f1", entries: [], summary: { beforeCount: 3, afterCount: 3, added: [], removed: [], reordered: false, same: true } } }],
  ["home_sections_set", { change: { target: "home", before: "f2", entries: [], summary: { beforeCount: 2, afterCount: 4, added: ["Intro", "Actus"], removed: [], reordered: false, same: false } } }],
];
