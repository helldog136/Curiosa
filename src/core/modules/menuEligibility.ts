import { hasPage, type ParsedManifest } from "./manifest";
import { isOverlayManifest } from "./menuPlacement";

// Quelles instances peuvent entrer dans le MENU PUBLIC du site, et lesquelles le module SUGGÈRE d'y mettre. Une seule règle, lue dans le manifeste.
// Ne pas confondre avec `menuPlacement.ts`, qui range les instances dans le menu de l'ADMINISTRATION (épinglée / seulement dans Extensions) : les deux
// règles partagent le même repère (`isOverlayManifest` : une source navigateur OBS n'a pas de page publique, donc ni menu public ni menu de travail).

type Eligibility = Pick<ParsedManifest, "page" | "content" | "type" | "permissions" | "suggestInMenu">;

/** Une instance de ce module peut-elle figurer au menu du site ? Il lui faut une page publique, et ce n'est pas une source OBS. */
export const menuEligible = (m: Eligibility): boolean => hasPage(m) && !isOverlayManifest(m);

/**
 * Le module suggère-t-il d'être au menu ? `suggestInMenu`, sinon l'ancien `content.showInNav`. Une suggestion ne fait jamais entrer la page au menu :
 * elle la met en avant (« Suggérée par l'extension ») dans la liste des pages qui n'y sont pas.
 */
export const suggestsMenu = (m: Eligibility): boolean => menuEligible(m) && (m.suggestInMenu ?? m.content?.showInNav ?? false);
