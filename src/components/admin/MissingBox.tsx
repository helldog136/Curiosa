"use client";

/**
 * Encadré « Il reste à renseigner : » en haut des réglages d'une extension : un lien par champ à remplir. Un clic amène au champ (défilement doux, ou
 * immédiat si l'animation est réduite), le met en évidence quelques secondes et y place le curseur. Si le champ est dans une zone repliée, elle s'ouvre.
 * Sans JavaScript, le lien reste une ancre ordinaire vers le champ.
 */
export function MissingBox({ title, items }: { title: string; items: { key: string; label: string; id: string }[] }) {
  if (items.length === 0) return null;
  const go = (e: React.MouseEvent, id: string) => {
    const input = document.getElementById(id);
    if (!input) return;
    e.preventDefault();
    const fold = input.closest("details");
    if (fold && !fold.open) fold.open = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    input.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    input.focus({ preventScroll: true });
    const cell = input.closest<HTMLElement>("[data-setting]");
    if (cell) {
      cell.classList.add("setting-flash");
      window.setTimeout(() => cell.classList.remove("setting-flash"), 2600);
    }
  };
  return (
    <section role="region" aria-label={title} data-testid="missing-box" className="rounded-2xl border border-amber-500/50 bg-amber-500/10 p-4 sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <ul className="mt-2 space-y-1">
        {items.map((i) => (
          <li key={i.key}>
            <a href={`#${i.id}`} onClick={(e) => go(e, i.id)} data-testid={`missing-link-${i.key}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg py-1 font-medium underline decoration-amber-600/60 underline-offset-4 hover:text-accent sm:min-h-0">
              <span aria-hidden>✎</span>{i.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
