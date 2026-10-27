// Streams saisis à la main : une semaine de streams autour de l'horloge figée (lundi 15 juin 2026, 12 h à Paris) : un en cours, un ce soir, des répétitions, un annulé, une journée entière, un sans jeu.
export default async function calendarManual(h) {
  const { mod, ctx, dir } = await h.raw("calendar-manual");
  const { cleanStream } = await import(`${dir}/schedule.mjs`);
  const iso = (n) => h.day(n).toISOString().slice(0, 10);
  const S = [
    { title: "Exploration en direct", startDate: iso(0), startTime: "11:00", endTime: "14:00", games: "Stellar Drift, Pixel Harbor" },
    { title: "Soirée détente", startDate: iso(0), startTime: "21:00", endTime: "23:30", games: "Moss and Lantern" },
    { title: "Défi du mardi", startDate: iso(1), startTime: "20:30", games: "Tiny Rails" },
    { title: "Discussion avec la communauté", startDate: iso(2), startTime: "19:00", endTime: "20:00", games: "" },
    { title: "Série hebdomadaire", startDate: iso(3), startTime: "18:00", games: "Cave Chronicles", repeat: "weekly", repeatUntil: iso(60) },
    { title: "Journée caritative", startDate: iso(4), allDay: "yes" },
    { title: "Stream annulé", startDate: iso(5), startTime: "15:00", games: "Echo Garden", cancelled: "yes" },
    { title: "Rediffusion du dimanche", startDate: iso(6), startTime: "20:00", endTime: "22:00", games: "Stellar Drift", repeat: "weekly" },
    { title: "Marathon de la semaine suivante", startDate: iso(9), startTime: "14:00", endTime: "20:00", games: "Pixel Harbor, Tiny Rails, Cave Chronicles" },
  ];
  for (const s of S) { const r = cleanStream(s); if (r.error) throw new Error(`calendar-manual ${s.title}: ${r.error}`); await ctx.api.store.add("streams", r.stream); }
  void mod;
}
