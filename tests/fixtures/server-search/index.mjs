// Test fixture: a list the module paginates and filters ITSELF (`searchable: "server"`, core 0.38.0). Invented names only.
// The module reads `query.q` and `query.page`, filters with `ctx.search.matches` (accents and case ignored) and returns only the matching rows of the page.
const PER_PAGE = 20;
const TEXT = {
  en: { name: "Name", note: "Note", none: "No person yet.", search: "Search" },
  fr: { name: "Nom", note: "Note", none: "Aucune personne.", search: "Rechercher" },
};
const words = (ctx) => TEXT[String(ctx.locale ?? "en").startsWith("fr") ? "fr" : "en"];

const definition = {
  async adminPanel(ctx, { query }) {
    const x = words(ctx);
    const q = ctx.search.query(query.q);
    const all = (await ctx.api.store.list("people")).filter((r) => ctx.search.matches([r.data.name, r.data.note], q));
    const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
    const page = Math.min(pages, Math.max(1, Number(query.page) || 1));
    const rows = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    return [{
      type: "table", columns: [x.name, x.note], searchable: "server", searchPlaceholder: x.search, empty: x.none,
      rowIds: rows.map((r) => r.id),
      rows: rows.map((r) => [r.data.name, r.data.note ?? ""]),
    }];
  },
};

export default definition;
