const DOTS = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500"];

/** Une couleur stable par extension (la même sur le tableau de bord et dans la liste des brouillons). */
const dot = (key: string) => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DOTS[h % DOTS.length] ?? DOTS[0];
};

/** Pastille d'une extension : un point de couleur ET son nom écrit, lisible en clair comme en sombre (la couleur seule ne suffit jamais). */
export function ModulePill({ id, name, icon }: { id: string; name: string; icon: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-fg">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot(id)}`} />
      <span aria-hidden="true">{icon}</span>{name}
    </span>
  );
}
