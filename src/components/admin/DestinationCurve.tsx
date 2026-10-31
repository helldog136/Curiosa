import { ui } from "./ui";

type Point = { day: string; hits: number };
type Labels = { alt: string; table: string; day: string; hits: string; none: string };

/**
 * Mini-courbe des 30 derniers jours d'une destination : un petit SVG écrit à la main (aucune bibliothèque, aucun chargement venu d'ailleurs).
 * Accessible : l'image porte un texte alternatif (`role="img"` + `aria-label` + `<title>`), la couleur ne porte rien seule, et les mêmes chiffres jour par jour
 * sont dans un tableau juste dessous (repliable). Sans donnée sur 30 jours : une phrase, pas de courbe vide.
 */
export function DestinationCurve({ series, labels, format }: { series: Point[]; labels: Labels; format: (day: string) => string }) {
  const max = Math.max(1, ...series.map((p) => p.hits));
  const empty = series.every((p) => p.hits === 0);
  if (empty) return <p className="text-sm text-muted">{labels.none}</p>;
  const W = 240, H = 48, PAD = 3, n = series.length;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, n - 1);
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const line = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.hits).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${H - PAD} L${x(0).toFixed(1)} ${H - PAD} Z`;
  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={labels.alt} className="h-12 w-full max-w-xs text-accent" preserveAspectRatio="none" data-testid="destination-curve">
        <title>{labels.alt}</title>
        <path d={area} fill="currentColor" opacity="0.14" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="currentColor" strokeWidth="0.6" opacity="0.35" vectorEffect="non-scaling-stroke" />
      </svg>
      <details className="rounded-xl border border-line p-2.5">
        <summary className="cursor-pointer text-sm font-medium">{labels.table}</summary>
        <div className="relative mt-2 overflow-x-auto"><table className="w-full text-sm">
          <thead><tr><th className={ui.th}>{labels.day}</th><th className={`${ui.th} text-right`}>{labels.hits}</th></tr></thead>
          <tbody>
            {[...series].reverse().filter((p) => p.hits > 0).map((p) => (
              <tr key={p.day} className="border-t border-line"><td className="px-3 py-1.5">{format(p.day)}</td><td className="px-3 py-1.5 text-right tabular-nums">{p.hits}</td></tr>
            ))}
          </tbody>
        </table></div>
      </details>
    </div>
  );
}
