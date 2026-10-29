// Accueil (blocs du cœur + sections de modules) et menu (liens simples, deux sous-menus), réglages du bandeau d'en-tête.
export default async function home(h) {
  const { inst, S, prisma } = h;
  const menu = await import("@/core/menuStore");
  const has = (id) => !!inst[id];
  const link = (id) => ({ kind: "instance", ref: inst[id].id });
  const about = await prisma.entry.findFirst({ where: { instanceId: inst.pages.id }, orderBy: { publishedAt: "asc" } });
  await menu.saveMenu([
    { kind: "system", ref: "home" },
    ...["blog", "planning", "events"].filter(has).map(link),
    { kind: "group", label: { fr: "Média", en: "Media" }, children: ["gallery", "videos", "daily-game", "countdown"].filter(has).map(link) },
    { kind: "group", label: { fr: "Communauté", en: "Community" }, children: ["faq", "polls", "thanks-wall", "directory", "testimonials", "map", "supporters"].filter(has).map(link) },
    ...(about ? [{ kind: "entry", ref: about.id }] : []),
    { kind: "link", href: "/privacy", label: { fr: "Confidentialité", en: "Privacy" } },
  ]);
  // Hero (module) : titre, texte, bouton, image d'illustration.
  await h.setBoth("hero", "title", "Un atelier ouvert à tout le monde", "A workshop open to everyone");
  await h.setBoth("hero", "eyebrow", "Bienvenue", "Welcome");
  await h.setBoth("hero", "text", "Découvrez nos projets, nos ateliers et notre communauté. Tout ici est fictif, pour la démonstration.", "Discover our projects, workshops and community. Everything here is fictional, for demonstration.");
  await h.setBoth("hero", "buttonLabel", "Voir l'agenda", "See the calendar");
  await h.set("hero", "buttonUrl", "/events");
  await h.set("hero", "poster", await h.img(1, 1600, 700));
  await h.set("hero", "showLogo", true);
  const L = (fr, en) => ({ fr, en });
  const block = (def) => ({ instance: "core", section: "block", options: { block: def } });
  const cover = await h.img(3, 900, 600);
  const sec = (id, section, extra = {}) => has(id) ? [{ id: `s-${id}-${section}`, instance: inst[id].key, section, options: {}, ...extra }] : [];
  let n = 0;
  const withId = (x) => ({ id: `b${++n}`, ...x });
  const sections = [
    ...sec("hero", "hero"),
    withId(block({ kind: "media", eyebrow: L("Notre démarche", "Our approach"), title: L("Créer ensemble", "Creating together"), text: L("Nous partageons nos outils, nos brouillons et nos idées pour que chacun puisse se lancer.", "We share our tools, drafts and ideas so everyone can get started."), buttonLabel: L("En savoir plus", "Learn more"), buttonUrl: "/privacy", images: [cover], imageSide: "right", tone: "surface" })),
    withId(block({ kind: "stats", title: L("En quelques chiffres", "In numbers"), items: [{ title: L("120", "120"), heading: L("Ateliers", "Workshops"), text: L("", ""), image: "" }, { title: L("48", "48"), heading: L("Projets", "Projects"), text: L("", ""), image: "" }, { title: L("1 200", "1,200"), heading: L("Membres", "Members"), text: L("", ""), image: "" }] })),
    ...sec("planning", "next"), ...sec("countdown", "featured"), ...sec("events", "next"), ...sec("polls", "current"),
    ...sec("planning", "upcoming"),
    ...sec("gallery", "latest"), ...sec("videos", "latest"),
    withId(block({ kind: "tabs", title: L("Nos activités", "Our activities"), items: [{ title: L("Ateliers", "Workshops"), heading: L("Des ateliers pour tous", "Workshops for all"), text: L("Gravure, reliure, céramique : chacun trouve son rythme.", "Engraving, binding, ceramics: everyone finds their pace."), image: await h.img(5, 600, 400) }, { title: L("Rencontres", "Meetups"), heading: L("Des rencontres régulières", "Regular meetups"), text: L("Une fois par mois, autour d'un café.", "Once a month, over coffee."), image: await h.img(6, 600, 400) }, { title: L("Formations", "Training"), heading: L("Se former", "Learn"), text: L("Des formations courtes et concrètes.", "Short, practical training."), image: "" }] })),
    ...sec("testimonials", "featured"), ...sec("testimonials", "rating"),
    ...sec("faq", "top"), ...sec("daily-game", "today"),
    withId(block({ kind: "cta", title: L("Envie de participer ?", "Want to join?"), text: L("Rejoignez la prochaine rencontre ou écrivez-nous.", "Join the next meetup or write to us."), buttonLabel: L("Nous écrire", "Write to us"), buttonUrl: "/privacy", tone: "accent" })),
    ...sec("contact-form", "form"),
    ...sec("live-status", "player"), ...sec("youtube-channel", "featured"), ...sec("commissions", "status"),
  ];
  await S("home.sections", sections.map((s, i) => ({ id: s.id ?? `h${i}`, ...s })));
  // En-tête : le lien secondaire et le bouton ne servent qu'aux profils qui les réglent (profiles.mjs).
}
