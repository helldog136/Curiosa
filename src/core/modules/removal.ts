/**
 * RETIRER — qui est retiré quand on appuie sur « Retirer de mon site » dans la fenêtre de réglages d'une instance ? Logique pure, testée seule.
 *   - le propriétaire, pour la SEULE instance de son module : c'est le module qu'il retire (plus rien de ce module sur le site) ;
 *   - sinon (un autre rôle, ou d'autres instances du même module) : seulement cette instance ; le module reste installé.
 * Dans les deux cas le choix est le même : garder mes données (rangées, retrouvées à la réinstallation) ou tout effacer.
 */
export type RemovalScope = "module" | "instance";
export function removalScope(o: { isOwner: boolean; otherInstances: number }): RemovalScope {
  return o.isOwner && o.otherInstances === 0 ? "module" : "instance";
}

export type RemovalNotice = "kept" | "erased" | "restored";
/** Avis à montrer en haut d'Extensions : retiré en gardant les données, retiré en effaçant tout, ou données retrouvées. */
export const noticeFor = (keepData: boolean): RemovalNotice => (keepData ? "kept" : "erased");

/** Adresse d'arrivée après un retrait ou une remise en place : la liste des extensions, avec l'avis à montrer et le nom concerné. */
export function removalNoticeHref(base: string, o: { notice: RemovalNotice; name: string }): string {
  return `${base}?${new URLSearchParams({ notice: o.notice, name: o.name.slice(0, 80) }).toString()}`;
}
