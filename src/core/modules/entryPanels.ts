import type { EntryPanel, EntryPanelDecl, EntryPanelTarget } from "./types";

/**
 * SECTIONS AJOUTÉES À L'ÉDITEUR D'ENTRÉE (point d'extension générique).
 * Un module déclare (`entryPanels` du manifeste + du code) une section pour les entrées d'un AUTRE module, désigné par un sujet qu'il fournit ou par son identifiant.
 * Le cœur n'affiche la section que si le module fournisseur est installé et actif ET que l'entrée correspond ; le module hôte n'en sait rien et la donnée reste
 * chez le fournisseur. Ce fichier ne contient que la décision (pure) : lecture des modules et rendu sont dans entryPanelsLoad.ts.
 */

/** Ce qu'il faut savoir d'un module pour décider s'il est visé : son identifiant et les sujets qu'il fournit. */
export type HostModule = { id: string; provides: string[] };
/** Un module actif qui peut fournir des sections : son manifeste (déclarations) et son code. */
export type PanelProvider<I> = { instance: I; decls: EntryPanelDecl[]; panels: Record<string, EntryPanel> };

/** Les entrées de ce module hôte sont-elles visées par la déclaration ? */
export function appliesTo(decl: Pick<EntryPanelDecl, "for">, host: HostModule): boolean {
  if (decl.for.topic) return host.provides.includes(decl.for.topic);
  if (decl.for.module) return decl.for.module === host.id;
  return false;
}

/** Les sections à montrer pour une entrée du module `host`, dans l'ordre des fournisseurs puis de leurs déclarations. Une déclaration sans code (`render`) correspondant est ignorée. */
export function panelsFor<I>(host: HostModule, providers: PanelProvider<I>[]): { instance: I; decl: EntryPanelDecl; panel: EntryPanel }[] {
  const out: { instance: I; decl: EntryPanelDecl; panel: EntryPanel }[] = [];
  for (const p of providers) {
    for (const decl of p.decls) {
      const panel = p.panels[decl.id];
      if (panel && typeof panel.render === "function" && appliesTo(decl, host)) out.push({ instance: p.instance, decl, panel });
    }
  }
  return out;
}

/** Les valeurs d'un formulaire de section : textes seulement, bornés, sans les champs internes de React. */
export function panelValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) values[k] = v.slice(0, 20000);
  return values;
}

/** Ancre de la section dans la page (pour y revenir : `#panel-<instance>-<section>`). */
export const panelAnchor = (instanceKey: string, panelId: string) => `panel-${instanceKey}-${panelId}`.replace(/[^a-zA-Z0-9_-]/g, "-");

export type { EntryPanelTarget };
