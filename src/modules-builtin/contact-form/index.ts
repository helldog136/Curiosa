import type { ParsedManifest } from "@/core/modules/manifest";
import { defineModule } from "@/core/modules/types";
import type { BuiltinModule } from "..";

export const manifest: ParsedManifest = {
  apiVersion: 2,
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
  consumes: [],
  provides: [],
  instances: "multiple",
  sections: [{ id: "form", label: { en: "Contact form", fr: "Formulaire de contact" } }],
  permissions: ["slots", "routes", "storage", "sections"],
  settings: [
    {
      key: "pageSlug",
      type: "text",
      translatable: true,
      label: { en: "Slug of a page that shows the form under its content (optional)", fr: "Slug d'une page qui affiche le formulaire sous son contenu (facultatif)" },
      help: { en: "Example: contact. Or place the form's section on the home page instead.", fr: "Exemple : contact. Ou placez la section du formulaire sur l'accueil." },
    },
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
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return Response.json({ ok: false }, { status: 400 }); // corps qui n'est pas un formulaire
      }
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
  },
  sections: {
    form: (ctx) => [form(ctx)],
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

function form(ctx: { t(key: string): string; instance: { key: string } }) {
  return {
    type: "form" as const,
    action: `${ctx.instance.key}/send`,
    submitLabel: ctx.t("send"),
    successText: ctx.t("sent"),
    fields: [
      { name: "name", label: ctx.t("name"), required: true },
      { name: "email", label: ctx.t("email"), kind: "email" as const, required: true },
      { name: "message", label: ctx.t("message"), kind: "textarea" as const, required: true },
    ],
  };
}
