// Requirements "places" (core 0.31.0, docs/PLACES.md): where a module's settings go in the admin. They read the MANIFEST only.
//  - places.valid: the hard rules of the core (grammar, reserved groups, limits, spoofing guards), the same check as at install;
//  - places.budget: the ergonomic budgets of each placed section (R4, R5) and the transition advice (adminMenu kept for older cores, tabs[].place needs minCore 0.31.0).

/** Simple settings shown in a section: not rare, not advanced (R5 counts them per section once placed). */
const simple = (manifest, keys) => keys.filter((k) => { const f = (manifest.settings ?? []).find((s) => s.key === k); return f && !f.rare && !f.advanced; });

const requirements = [
  {
    id: "places.valid", level: "mandatory", group: "settings",
    title: "Places are valid",
    what: "The `place`, `tabs[].place` and `places` keys follow the contract of docs/PLACES.md: group.page[.tab] in lower-case ASCII, no group of the core (admin, account, settings…), at most 12 sections and 1 new group, order from 100 to 999, seeAlso as place ids only, EN and FR titles, no title that reads like a page of the core.",
    why: "A place is a public, frozen address shown to the owner. A wrong one is refused at install; a misleading one could look like a page of the core (password, team, backup).",
    fix: "Read the message: it names the section and the rule. Pick a place from catalogue/places.json, or define a new one inline with plain titles.",
    run(m) {
      if (!m.manifest) return { skip: "module.json unreadable" };
      if (!m.core.places) return { skip: "this core has no places (core 0.31.0 or later)" };
      if (m.manifest.place === undefined && !m.manifest.places && !(m.manifest.tabs ?? []).some((t) => t.place !== undefined)) return [];
      return m.core.places.placeIssues(m.manifest);
    },
  },
  {
    id: "places.budget", level: "advice", group: "settings",
    title: "Placed sections stay short, and older cores keep working",
    what: "Each placed section shows at most 7 simple settings (R5) and its declared settings fit the field budget (R4: 5 visible fields, the rest rare or advanced). More than 3 sections of the module on one page is a guideline, not a refusal (core 0.34.0): the vocabulary page can write why it is fine. A module with places keeps `adminMenu` for cores older than 0.31.0, and uses `tabs[].place` only with minCore 0.31.0 (an older core refuses that key).",
    why: "A shared page gathers several modules: one long section pushes the others down. During the transition, sites on an older core still need the module's own entry.",
    fix: "Mark rare settings `rare: true`, split a long section, keep `adminMenu` until minCore 0.33.0, or move tabs[].place to places[].fromTab.",
    run(m) {
      if (!m.manifest || !m.core.places) return [];
      const sections = m.core.places.moduleSections({ settings: [], ...m.manifest });
      if (!sections.length) return [];
      const out = [];
      for (const s of sections) {
        const n = simple(m.manifest, s.settings).length;
        if (n > 7) out.push(`section "${s.id}" (${s.declared}) shows ${n} simple settings (R5: 7 at most)`);
        else if (n > 5) out.push(`section "${s.id}" (${s.declared}) shows ${n} fields (R4: 5 visible at most, fold the rare ones)`);
      }
      // Soft limit (core 0.34.0): advice only, never a refusal.
      if (m.core.places.placeAdvice) out.push(...m.core.places.placeAdvice(m.manifest));
      const usesTabPlace = (m.manifest.tabs ?? []).some((t) => t.place !== undefined);
      const mc = String(m.manifest.minCore ?? "0.0.0").split(".").map(Number);
      if (usesTabPlace && (mc[0] ?? 0) === 0 && (mc[1] ?? 0) < 31) out.push(`tabs[].place is refused by a core older than 0.31.0: declare "minCore": "0.31.0" or use places[].fromTab`);
      if (!m.manifest.adminMenu && !m.manifest.menuGroup) out.push("no adminMenu: on a core older than 0.31.0 the module keeps its default sidebar section (fine if that is wanted)");
      return out;
    },
  },
];

export default requirements;
