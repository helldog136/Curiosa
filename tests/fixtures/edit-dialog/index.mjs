// Test fixture: a list of commands edited in an edit dialog (`presentation: "dialog"`). Invented names only.
// The same module serves the unit tests (with the fake context of the test kit) and the screenshots (installed in a throwaway site).
const COLLECTION = "commands";

export default {
  async adminPanel(ctx, { query }) {
    const rows = await ctx.api.store.list(COLLECTION);
    const editing = query.edit ? rows.find((r) => r.id === query.edit) : query.new ? { id: "", data: {} } : null;
    return [
      ...(editing ? [{
        type: "adminForm", presentation: "dialog", action: "save", cancelHref: "?",
        title: query.new ? "New command" : "Edit command", submitLabel: "Save the command",
        fields: [
          { name: "id", kind: "hidden", label: "id", value: editing.id },
          { name: "name", label: "Name", required: true, value: editing.data.name ?? "", example: "hello" },
          { name: "reply", kind: "textarea", label: "Reply", value: editing.data.reply ?? "", example: "Hello and welcome" },
          { name: "cooldown", kind: "number", label: "Wait between uses", min: 0, max: 3600, unit: "s", value: String(editing.data.cooldown ?? 30), placeholder: "30" },
        ],
      }] : []),
      { type: "links", items: [{ label: "New command", href: "?new=1", presentation: "dialog" }] },
      {
        type: "table", columns: ["Command", "Reply"], searchable: true, truncate: [1], empty: "No command yet. Use “New command” to add the first one.",
        rowIds: rows.map((r) => r.id),
        rows: rows.map((r) => [r.data.name, r.data.reply ?? ""]),
        rowActions: [
          { label: "Edit", href: "?edit={id}", presentation: "dialog" },
          { label: "Delete the command", action: "remove", danger: true, confirm: "Delete this command? Its reply is lost." },
        ],
      },
    ];
  },
  adminActions: {
    async save(ctx, values) {
      const name = String(values.name ?? "").trim();
      if (!name) return { errors: { name: "Write a name, for example hello." } };
      const cooldown = Number(values.cooldown);
      if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 3600) return { errors: { cooldown: "Write a whole number between 0 and 3600, for example 30." } };
      const data = { name, reply: String(values.reply ?? ""), cooldown };
      if (values.id) await ctx.api.store.update(values.id, data); else await ctx.api.store.add(COLLECTION, data);
      return { ok: "Saved." };
    },
    async remove(ctx, values) {
      await ctx.api.store.remove(String(values.id ?? ""));
      return { ok: "Deleted." };
    },
  },
};
