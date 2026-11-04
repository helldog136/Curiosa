// Test fixture: a list of commands edited in an edit dialog (`presentation: "dialog"`). Invented names only.
// The same module serves the unit tests (with the fake context of the test kit) and the screenshots (installed in a throwaway site).
const COLLECTION = "commands";
const TEXT = {
  en: { "new": "New command", edit: "Edit command", save: "Save the command", name: "Name", reply: "Reply", wait: "Wait between uses", command: "Command", editRow: "Edit", del: "Delete the command", confirm: "Delete this command? Its reply is lost.",
    empty: "No command yet. Use “New command” to add the first one.", nameErr: "Write a name, for example hello.", waitErr: "Write a whole number between 0 and 3600, for example 30.", ok: "Saved.", deleted: "Deleted.", exReply: "Hello and welcome" },
  fr: { "new": "Nouvelle commande", edit: "Modifier la commande", save: "Enregistrer la commande", name: "Nom", reply: "Réponse", wait: "Attente entre deux usages", command: "Commande", editRow: "Modifier", del: "Supprimer la commande", confirm: "Supprimer cette commande ? Sa réponse sera perdue.",
    empty: "Aucune commande. Utilisez « Nouvelle commande » pour ajouter la première.", nameErr: "Écrivez un nom, par exemple bonjour.", waitErr: "Écrivez un nombre entier entre 0 et 3600, par exemple 30.", ok: "Enregistré.", deleted: "Supprimée.", exReply: "Bonjour et bienvenue" },
};
const words = (ctx) => TEXT[String(ctx.locale ?? "en").startsWith("fr") ? "fr" : "en"];

const definition = {
  async adminPanel(ctx, { query }) {
    const x = words(ctx);
    const rows = await ctx.api.store.list(COLLECTION);
    const editing = query.edit ? rows.find((r) => r.id === query.edit) : query.new ? { id: "", data: {} } : null;
    return [
      ...(editing ? [{
        type: "adminForm", presentation: "dialog", action: "save", cancelHref: "?",
        title: query.new ? x.new : x.edit, submitLabel: x.save,
        fields: [
          { name: "id", kind: "hidden", label: "id", value: editing.id },
          { name: "name", label: x.name, required: true, value: editing.data.name ?? "", example: "hello" },
          { name: "reply", kind: "textarea", label: x.reply, value: editing.data.reply ?? "", example: x.exReply },
          { name: "cooldown", kind: "number", label: x.wait, min: 0, max: 3600, unit: "s", value: String(editing.data.cooldown ?? 30), placeholder: "30" },
        ],
      }] : []),
      { type: "links", items: [{ label: x.new, href: "?new=1", presentation: "dialog" }] },
      {
        type: "table", columns: [x.command, x.reply], searchable: true, truncate: [1], empty: x.empty,
        rowIds: rows.map((r) => r.id),
        rows: rows.map((r) => [r.data.name, r.data.reply ?? ""]),
        rowActions: [
          { label: x.editRow, href: "?edit={id}", presentation: "dialog" },
          { label: x.del, action: "remove", danger: true, confirm: x.confirm },
        ],
      },
    ];
  },
  adminActions: {
    async save(ctx, values) {
      const x = words(ctx);
      const name = String(values.name ?? "").trim();
      const cooldown = Number(values.cooldown);
      const errors = {};
      if (!name) errors.name = x.nameErr;
      if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 3600) errors.cooldown = x.waitErr;
      if (Object.keys(errors).length) return { errors };
      const data = { name, reply: String(values.reply ?? ""), cooldown };
      if (values.id) await ctx.api.store.update(values.id, data); else await ctx.api.store.add(COLLECTION, data);
      return { ok: x.ok };
    },
    async remove(ctx, values) {
      await ctx.api.store.remove(String(values.id ?? ""));
      return { ok: words(ctx).deleted };
    },
  },
};

export default definition;
