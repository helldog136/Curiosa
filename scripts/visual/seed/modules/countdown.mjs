// Comptes à rebours : un mis en avant (dans 12 jours), deux autres à venir, un passé (nettoyé ou « terminé »).
export default async function countdown(h) {
  const iso = (n) => h.day(n).toISOString().slice(0, 10);
  const mk = async (title, n, time) => h.act("countdown", "create", { title, date: iso(n), time, tz: "Europe/Paris" });
  const a = await mk("Lancement du nouveau projet", 12, "18:00");
  await mk("Ouverture de la billetterie", 4, "10:00");
  await mk("Fin de la campagne de soutien", 45, "23:59");
  await mk("Événement terminé", -3, "12:00");
  void a;
}
