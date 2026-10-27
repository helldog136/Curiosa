// FAQ : 3 thèmes, 9 questions publiées (FR + EN, une longue avec Markdown), quelques votes ; question « posée par un visiteur » en attente côté admin (invisible).
import { pathToFileURL } from "node:url";
export default async function faq(h) {
  const { ctx, dir } = await h.raw("faq");
  const D = await import(pathToFileURL(`${dir}/data.mjs`).href);
  for (const [fr, en] of [["Général", "General"], ["Ateliers", "Workshops"], ["Pratique", "Practical"]]) await h.act("faq", "saveTheme", { name_fr: fr, name_en: en });
  const themes = await D.loadThemes(ctx);
  const Q = [
    [0, "Qui êtes-vous ?", "Who are you?", "Un petit **collectif** de créateurs et créatrices.", "A small **collective** of makers."],
    [0, "Le site est-il gratuit ?", "Is the site free?", "Oui, tout le contenu est en accès libre.", "Yes, all content is free to access."],
    [0, "Comment vous contacter ?", "How can I contact you?", "Par le formulaire de contact ou par e-mail.", "Through the contact form or by e-mail."],
    [1, "Faut-il du matériel pour participer ?", "Do I need equipment?", "Non, tout est prêté sur place.\n\n- cutters\n- plaques\n- encre\n\nPensez seulement à des vêtements qui peuvent se salir.", "No, everything is lent on site."],
    [1, "À partir de quel âge ?", "From what age?", "À partir de 7 ans, accompagné d'un adulte jusqu'à 12 ans.", "From 7, accompanied by an adult up to 12."],
    [1, "Puis-je annuler ma place ?", "Can I cancel my seat?", "Oui, jusqu'à 48 heures avant, sans frais.", "Yes, up to 48 hours before, free of charge."],
    [2, "Où se trouve l'atelier ?", "Where is the workshop?", "Au centre-ville, à deux minutes de la gare.", "Downtown, two minutes from the station."],
    [2, "Y a-t-il un accès pour les personnes à mobilité réduite ?", "Is there step-free access?", "Oui, de plain-pied, avec des toilettes adaptées.", "Yes, ground level with accessible toilets."],
    [2, "Peut-on venir avec un chien ?", "Can I bring a dog?", "Les chiens sont les bienvenus tant qu'ils sont calmes.", "Dogs are welcome as long as they are calm."],
  ];
  for (const [t, qf, qe, af, ae] of Q) await h.act("faq", "saveItem", { state: "published", theme: themes[t]?.id ?? "", q_fr: qf, a_fr: af, q_en: qe, a_en: ae });
  // thème vide + une question sans thème
  await h.act("faq", "saveTheme", { name_fr: "Thème sans question", name_en: "Theme without questions" });
  await h.act("faq", "saveItem", { state: "published", theme: "", q_fr: "Une question sans thème ?", a_fr: "Elle apparaît sous les thèmes.", q_en: "A question without a theme?", a_en: "It appears below the themes." });
}
