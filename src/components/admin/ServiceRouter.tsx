"use client";

import { useId, useRef, useState } from "react";
import { ui } from "./ui";

export type RouterNode = { key: string; name: string; icon: string; sub?: string };
export type RouterLabels = {
  consumers: string; providers: string; master: string; replica: string; promote: string; remove: string; hint: string; list: string; save: string; pending: string | null;
};

// Géométrie (unités du viewBox, le dessin s'adapte à la largeur).
const W = 840, ROW = 70, NODE_H = 54, PAD = 24;
const CONS_X = 16, CONS_W = 200, SVC_X = 316, SVC_W = 120, SVC_H = 64, PROV_X = 616, PROV_W = 208;
const curve = (x1: number, y1: number, x2: number, y2: number) => { const mx = (x1 + x2) / 2; return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`; };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Éditeur visuel d'un service offert par plusieurs modules : les modules qui l'utilisent (à gauche) → le service (au centre) → les
 * fournisseurs (à droite). On RELIE le service à un fournisseur en tirant la flèche depuis sa poignée (ou d'un clic sur le fournisseur) :
 * le premier est le MAÎTRE (flèche pleine, il reçoit et répond), les autres sont des RÉPLIQUES (flèche pointillée, elles reçoivent aussi les
 * écritures). Cliquer l'étiquette d'une réplique la promeut maître ; × la retire. La « vue liste » repliée contient les vrais champs du
 * formulaire (boutons radio / cases) : c'est elle qui est envoyée, elle sert aussi au clavier et sans JavaScript.
 */
export function ServiceRouter({ service, consumers, providers, master: initialMaster, replicas: initialReplicas, action, labels }: {
  service: string; consumers: RouterNode[]; providers: RouterNode[]; master: string; replicas: string[]; action: (formData: FormData) => void | Promise<void>; labels: RouterLabels;
}) {
  const [master, setMaster] = useState(initialMaster);
  const [replicas, setReplicas] = useState<string[]>(initialReplicas.filter((k) => k !== initialMaster));
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/:/g, "");

  const rows = Math.max(consumers.length, providers.length, 1);
  const H = rows * ROW + PAD * 2;
  const cy = H / 2;
  const yOf = (i: number, n: number) => (H - n * ROW) / 2 + i * ROW + ROW / 2;
  const provY = new Map(providers.map((p, i) => [p.key, yOf(i, providers.length)]));

  const connect = (key: string) => { if (key !== master && !replicas.includes(key)) setReplicas((r) => [...r, key]); };
  const promote = (key: string) => { setReplicas((r) => [...r.filter((k) => k !== key), master]); setMaster(key); };
  const unlink = (key: string) => setReplicas((r) => r.filter((k) => k !== key));

  const toSvg = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const hit = (p: { x: number; y: number }) => providers.find((n) => p.x >= PROV_X - 12 && p.x <= PROV_X + PROV_W + 12 && Math.abs(p.y - (provY.get(n.key) ?? -1e9)) <= NODE_H / 2 + 6);

  const portX = SVC_X + SVC_W, portY = cy;
  const state = (key: string) => (key === master ? "master" : replicas.includes(key) ? "replica" : "none");

  return (
    <form action={action} className={`${ui.card} space-y-3`}>
      <style>{`@keyframes vr-${uid}{to{stroke-dashoffset:-28}}.vr-${uid}{stroke-dasharray:9 5;animation:vr-${uid} 1.1s linear infinite}@media (prefers-reduced-motion:reduce){.vr-${uid}{animation:none}}`}</style>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium"><span className="font-mono text-sm">{service}</span>{labels.pending && <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 text-xs">{labels.pending}</span>}</p>
        <p className="text-xs text-muted">{labels.hint}</p>
      </div>

      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" role="group" aria-label={service}
        onPointerMove={(e) => { if (drag) setDrag(toSvg(e)); }}
        onPointerUp={(e) => { if (!drag) return; const target = hit(toSvg(e)); if (target) connect(target.key); setDrag(null); }}
        onPointerLeave={() => setDrag(null)}>
        <defs>
          <marker id={`ah-${uid}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="fill-accent" /></marker>
          <marker id={`ag-${uid}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="fill-muted" /></marker>
        </defs>

        {/* utilisateurs du service → service */}
        <text x={CONS_X} y={12} className="fill-muted text-[11px]">{labels.consumers}</text>
        {consumers.map((c, i) => {
          const y = yOf(i, consumers.length);
          return (
            <g key={c.key}>
              <path d={curve(CONS_X + CONS_W, y, SVC_X, cy)} className="fill-none stroke-muted" strokeWidth={1.5} markerEnd={`url(#ag-${uid})`} opacity={0.6} />
              <rect x={CONS_X} y={y - NODE_H / 2} width={CONS_W} height={NODE_H} rx={12} className="fill-surface stroke-line" />
              <text x={CONS_X + 12} y={y + (c.sub ? -3 : 5)} className="fill-fg text-[13px]">{c.icon} {clip(c.name, 24)}</text>
              {c.sub && <text x={CONS_X + 12} y={y + 15} className="fill-muted text-[11px]">{clip(c.sub, 26)}</text>}
            </g>
          );
        })}

        {/* le service */}
        <rect x={SVC_X} y={cy - SVC_H / 2} width={SVC_W} height={SVC_H} rx={16} className="fill-accent/10 stroke-accent" strokeWidth={2} />
        <text x={SVC_X + SVC_W / 2} y={cy + 4} textAnchor="middle" className="fill-fg font-mono text-[12px]">{clip(service, 16)}</text>

        {/* flèches vers les fournisseurs */}
        <text x={PROV_X} y={12} className="fill-muted text-[11px]">{labels.providers}</text>
        {providers.map((p) => {
          const y = provY.get(p.key)!;
          const st = state(p.key);
          if (st === "none") return null;
          const mx = (portX + PROV_X) / 2, my = (cy + y) / 2;
          return (
            <g key={`l-${p.key}`}>
              <path d={curve(portX, cy, PROV_X - 2, y)} className={`fill-none stroke-accent ${st === "master" ? `vr-${uid}` : ""}`} strokeWidth={st === "master" ? 3 : 2} strokeDasharray={st === "replica" ? "4 5" : undefined} markerEnd={`url(#ah-${uid})`} />
              {st === "master" ? (
                <g transform={`translate(${mx},${my})`}><rect x={-44} y={-12} width={88} height={24} rx={12} className="fill-accent" /><text textAnchor="middle" y={4} className="fill-accent-fg text-[11px] font-semibold">👑 {labels.master}</text></g>
              ) : (
                <g transform={`translate(${mx},${my})`}>
                  <g role="button" tabIndex={0} className="cursor-pointer" onClick={() => promote(p.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); promote(p.key); } }}>
                    <title>{labels.promote}</title>
                    <rect x={-50} y={-12} width={86} height={24} rx={12} className="fill-surface stroke-accent" />
                    <text x={-7} textAnchor="middle" y={4} className="fill-fg text-[11px]">↻ {labels.replica}</text>
                  </g>
                  <g role="button" tabIndex={0} className="cursor-pointer" onClick={() => unlink(p.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); unlink(p.key); } }}>
                    <title>{labels.remove}</title>
                    <circle cx={46} cy={0} r={9} className="fill-surface stroke-line" />
                    <text x={46} y={4} textAnchor="middle" className="fill-muted text-[12px]">×</text>
                  </g>
                </g>
              )}
            </g>
          );
        })}

        {/* flèche en cours de tracé */}
        {drag && <path d={curve(portX, portY, drag.x, drag.y)} className="fill-none stroke-accent" strokeWidth={2.5} strokeDasharray="3 5" markerEnd={`url(#ah-${uid})`} />}

        {/* fournisseurs */}
        {providers.map((p) => {
          const y = provY.get(p.key)!;
          const st = state(p.key);
          const over = drag && hit(drag)?.key === p.key;
          return (
            <g key={p.key} className={st === "none" ? "cursor-pointer" : undefined} onClick={() => st === "none" && connect(p.key)}>
              <rect x={PROV_X} y={y - NODE_H / 2} width={PROV_W} height={NODE_H} rx={12}
                className={`fill-surface ${st === "master" ? "stroke-accent" : st === "replica" ? "stroke-accent" : "stroke-line"}`}
                strokeWidth={st === "master" ? 3 : over ? 3 : 1.5} strokeDasharray={st === "replica" ? "5 4" : st === "none" && drag ? "3 4" : undefined} opacity={st === "none" && !over ? 0.85 : 1} />
              <circle cx={PROV_X} cy={y} r={5} className={st === "none" ? "fill-line" : "fill-accent"} />
              <text x={PROV_X + 14} y={y + (p.sub ? -3 : 5)} className="fill-fg text-[14px]">{p.icon} {clip(p.name, 20)}</text>
              {p.sub && <text x={PROV_X + 14} y={y + 15} className="fill-muted text-[11px]">{clip(p.sub, 26)}</text>}
            </g>
          );
        })}

        {/* poignée de sortie du service : on tire la flèche d'ici */}
        <g className="cursor-crosshair" onPointerDown={(e) => { (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); setDrag(toSvg(e)); }}>
          <circle cx={portX} cy={portY} r={14} className="fill-transparent" />
          <circle cx={portX} cy={portY} r={8} className="fill-accent stroke-bg" strokeWidth={2} />
        </g>
      </svg>

      {/* Les vrais champs du formulaire (clavier, lecteurs d'écran, sans JavaScript). */}
      <details>
        <summary className="cursor-pointer text-sm text-muted">{labels.list}</summary>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <fieldset className="space-y-1">
            <legend className="text-sm text-muted">{labels.master}</legend>
            {providers.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-sm">
                <input type="radio" name="master" value={p.key} checked={master === p.key} onChange={() => promote(p.key)} required /> {p.icon} {p.name}
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-sm text-muted">{labels.replica}</legend>
            {providers.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="replicas" value={p.key} checked={replicas.includes(p.key)} disabled={master === p.key} onChange={(e) => (e.target.checked ? connect(p.key) : unlink(p.key))} /> {p.icon} {p.name}
              </label>
            ))}
          </fieldset>
        </div>
      </details>
      <button className={ui.btnPrimary}>{labels.save}</button>
    </form>
  );
}
