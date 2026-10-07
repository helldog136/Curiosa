import type { ParsedManifest } from "@/core/modules/manifest";
import { defineModule } from "@/core/modules/types";
import type { BuiltinModule } from "..";

export const manifest: ParsedManifest = {
  apiVersion: 1,
  id: "contact-form",
  name: { en: "Contact form", fr: "Formulaire de contact" },
  version: "1.0.0",
  description: {
    en: "Adds a contact form under a page of your choice. Messages are kept in the admin.",
    fr: "Ajoute un formulaire de contact sous la page de votre choix. Les messages sont consultables dans l'admin.",
  },
  author: "Vitrine",
  license: "MIT",
  icon: "✉️",
  permissions: ["slots", "routes", "storage"],
  settings: [
    {
      key: "pageSlug",
      type: "text",
      translatable: true,
      label: { en: "Slug of the page that shows the form", fr: "Slug de la page qui affiche le formulaire" },
      help: { en: "Example: contact. Create that page in your 'Pages' collection.", fr: "Exemple : contact. Créez cette page dans votre collection « Pages »." },
      default: "contact",
    },
    { key: "onHome", type: "boolean", label: { en: "Also show on the home page", fr: "Afficher aussi sur l'accueil" }, default: false },
  ],
};

export const locales: BuiltinModule["locales"] = {
  en: { name: "Name", email: "Email", message: "Message", send: "Send", sent: "Thanks! Your message was sent.", messages: "Messages received", date: "Date", from: "From" },
  fr: { name: "Nom", email: "Email", message: "Message", send: "Envoyer", sent: "Merci ! Votre message a bien été envoyé.", messages: "Messages reçus", date: "Date", from: "De" },
};

// Anti-abus minimal en mémoire : 5 messages / heure / IP.
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

export const definition = defineModule({
  routes: {
    async send(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
      if (limited(ip)) return Response.json({ ok: false }, { status: 429 });
      const form = await request.formData();
      if (String(form.get("website") ?? "")) return Response.json({ ok: true }); // piège à robots
      const name = String(form.get("name") ?? "").trim().slice(0, 120);
      const email = String(form.get("email") ?? "").trim().slice(0, 200);
      const message = String(form.get("message") ?? "").trim().slice(0, 5000);
      if (!name || !message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return Response.json({ ok: false }, { status: 400 });
      }
      await ctx.api.store.add("messages", { name, email, message });
      return Response.json({ ok: true });
    },
  },
  slots: {
    "entry.bottom"(ctx) {
      const wanted = ctx.setting("pageSlug");
      if (!wanted || ctx.entry?.slug !== wanted) return null;
      return [form(ctx)];
    },
    "home.bottom"(ctx) {
      return ctx.setting<boolean>("onHome") ? [form(ctx)] : null;
    },
  },
  async adminPanel(ctx) {
    const messages = await ctx.api.store.list("messages", { limit: 100 });
    return [
      { type: "heading", text: `${ctx.t("messages")} (${messages.length})` },
      {
        type: "table",
        columns: [ctx.t("date"), ctx.t("from"), ctx.t("message")],
        rows: messages.map((m) => [
          m.createdAt.toISOString().slice(0, 16).replace("T", " "),
          `${String(m.data.name)} <${String(m.data.email)}>`,
          String(m.data.message),
        ]),
      },
    ];
  },
});

function form(ctx: { t(key: string): string }) {
  return {
    type: "form" as const,
    action: "contact-form/send",
    submitLabel: ctx.t("send"),
    successText: ctx.t("sent"),
    fields: [
      { name: "name", label: ctx.t("name"), required: true },
      { name: "email", label: ctx.t("email"), kind: "email" as const, required: true },
      { name: "message", label: ctx.t("message"), kind: "textarea" as const, required: true },
    ],
  };
}
