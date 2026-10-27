// Événements : modèle « association » (5 types), 9 rendez-vous à venir (dont un complet, un annulé, un répété, un avec programme / intervenants / coordonnées / image) et 5 passés
// (rétrospective, certains avec un album photo). Un second agenda vide.
const rid = (r) => /edit=([^&]+)/.exec(r.redirect)[1];
export default async function events(h, row) {
  await h.act("events", "chooseStarter", { starter: "association" });
  const { ctx } = await h.raw("events");
  const types = (await ctx.api.store.list("ev_types", { limit: 50 })).map((r) => r.data.key);
  const iso = (n) => h.day(n).toISOString().slice(0, 10);
  const UP = [
    [3, "14h", "Atelier d'initiation à la gravure", "Salle des fêtes, rue du Marché", "Venez découvrir la gravure sur bois avec du matériel prêté.", 1],
    [6, "19:30", "Rencontre mensuelle des membres", "Café associatif", "Un moment simple pour se retrouver et présenter ses projets.", 4],
    [9, "10h", "Formation : photographier ses réalisations", "Atelier principal", "Une demi-journée pour apprendre à bien photographier son travail.", 2],
    [14, "18h", "Masterclass de reliure japonaise", "Studio B", "Une masterclass avec une intervenante invitée. Places limitées.", 3],
    [21, "20h", "Soirée projections", "Salle polyvalente", "Courts métrages d'atelier et discussion.", 0],
    [28, "09:00", "Journée portes ouvertes", "Atelier principal", "Toute la journée : visites, démonstrations et café offert.", 0],
    [40, "15h", "Atelier enfants : mon premier carnet", "Salle des fêtes", "Pour les 7-12 ans, accompagnés d'un adulte.", 1],
    [55, "18:30", "Conférence : l'artisanat demain", "Auditorium", "Trois invités parlent de l'avenir des métiers d'art.", 3],
    [70, "10h", "Stage d'été : initiation à la céramique", "Atelier principal", "Cinq matinées pour réaliser ses premières pièces.", 2],
  ];
  const ids = [];
  for (const [d, time, title, place, text, t] of UP) {
    const r = await h.act("events", "quickAdd", { title, date: iso(d), time, place, text, publish: "on" });
    ids.push(rid(r));
  }
  for (let i = 0; i < ids.length; i++) await h.act("events", "saveEvent", { id: ids[i], section: "essential", title: UP[i][2], type: types[UP[i][5] % types.length], date: iso(UP[i][0]), time: UP[i][1], place: UP[i][3], text: UP[i][4], status: "published" });
  // détail riche sur le premier
  await h.act("events", "saveEvent", { id: ids[0], section: "program", program: "14:00 Accueil et présentation\n14:30 Premiers gestes\n16:00 Pause\n16:30 Impression des gravures", speakers: "Camille Durand | Graveuse | /a-propos\nMaël Lefèvre | Imprimeur" });
  await h.act("events", "saveEvent", { id: ids[0], section: "where", endDate: "", endTime: "17:30", tz: "Europe/Paris", lat: "48.8566", lng: "2.3522" });
  await h.act("events", "saveEvent", { id: ids[0], section: "media", image: await h.img(1, 1200, 630), imageAlt: "Établi de gravure", signupUrl: "https://example.org/inscription", seatsLeft: "4", seatsTotal: "12", videoUrl: "" });
  await h.act("events", "saveEvent", { id: ids[3], section: "media", image: await h.img(4, 1200, 630), imageAlt: "Reliure", signupUrl: "https://example.org/inscription", seatsLeft: "0", seatsTotal: "10", videoUrl: "" });
  await h.act("events", "saveEvent", { id: ids[3], section: "essential", title: UP[3][2], type: types[3], date: iso(14), time: UP[3][1], place: UP[3][3], text: UP[3][4], status: "published", state: "full" }).catch(() => {});
  await h.act("events", "saveEvent", { id: ids[5], section: "essential", title: UP[5][2], type: types[0], date: iso(28), time: UP[5][1], place: UP[5][3], text: UP[5][4], status: "published", state: "cancelled" }).catch(() => {});
  await h.act("events", "repeat", { id: ids[1], every: "month", count: "3" }).catch(() => {});
  const PAST = [[-8, "Atelier de linogravure", "Atelier principal"], [-20, "Rencontre de printemps", "Café associatif"], [-35, "Formation : le droit d'auteur", "Auditorium"], [-60, "Journée portes ouvertes d'hiver", "Atelier principal"], [-90, "Soirée de lancement", "Salle polyvalente"]];
  for (const [d, title, place] of PAST) {
    const r = await h.act("events", "quickAdd", { title, date: iso(d), time: "18h", place, text: "Un rendez-vous passé, visible dans la rétrospective.", publish: "on" });
    await h.act("events", "saveEvent", { id: rid(r), section: "media", image: await h.img(7, 1200, 630), imageAlt: "Souvenir", signupUrl: "", seatsLeft: "", seatsTotal: "", videoUrl: "" });
  }
  await h.act("events", "quickAdd", { title: "Brouillon non publié", date: iso(80), time: "10h", place: "—", text: "N'apparaît pas sur le site." });
  const second = await h.extra("events", { nickname: "Formations", fr: "Formations (vide)", en: "Trainings (empty)", basePath: "formations" });
  void second;
}
