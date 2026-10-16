// Noms identiques à ceux de core/visit.ts (qui lit la base : ce fichier doit rester utilisable dans le navigateur ; un test vérifie l'égalité).
const NEWS_COOKIE = "curiosa_news";
const SEEN_COOKIE = "curiosa_seen";
const SINCE_COOKIE = "curiosa_since";

/**
 * BANDEAU DE COOKIES (« tray » qui monte du bas de l'écran). Logique pure, sans navigateur : ce qui s'affiche et ce qui est déposé.
 *
 * Ce que le site dépose, et quand :
 *  - `curiosa_locale`  : la langue choisie (nécessaire, toujours) ;
 *  - `curiosa_news` (+ `curiosa_seen`, `curiosa_since`) : SEULEMENT après « Accepter les cookies » ; la date de la dernière visite, pour signaler les nouveautés ;
 *  - `curiosa_cookies` : le souvenir d'un « Non merci » (30 jours) ou d'un « plus tard » par Échap (le temps de la session du navigateur). Il ne contient
 *    que « no » ou « later » : c'est un cookie de choix, strictement nécessaire pour ne pas redemander à chaque page ; il n'identifie personne.
 * Le serveur lit ces cookies : il décide seul d'afficher ou non le bandeau, donc aucun clignotement au chargement.
 */
export const CHOICE_COOKIE = "curiosa_cookies";
export const CHOICE_REFUSED_DAYS = 30;
const YEAR = 60 * 60 * 24 * 365;

export type Choice = "no" | "later";

/** Valeur du cookie de choix : toute valeur inconnue est ignorée. */
export function parseChoice(raw: unknown): Choice | null {
  return raw === "no" || raw === "later" ? raw : null;
}

export type TrayState = {
  /** Le site propose-t-il ce choix ? (réglage « news.toggle ») Sinon : ni bandeau ni lien. */
  enabled: boolean;
  /** Le visiteur a accepté (cookie `curiosa_news=1`). */
  accepted: boolean;
  /** Le bandeau est ouvert dès le chargement. */
  showTray: boolean;
  /** Le lien « Cookies » du pied de page est affiché. */
  showLink: boolean;
};

/** Ce que le serveur affiche, d'après le réglage et les cookies du visiteur. */
export function trayState(input: { enabled: boolean; newsCookie?: string | null; choiceCookie?: string | null }): TrayState {
  if (!input.enabled) return { enabled: false, accepted: false, showTray: false, showLink: false };
  const accepted = input.newsCookie === "1";
  const answered = accepted || parseChoice(input.choiceCookie) !== null;
  return { enabled: true, accepted, showTray: !answered, showLink: true };
}

/** Cookies à écrire (document.cookie) pour chaque action. */
export const cookieWrites = {
  accept: [`${NEWS_COOKIE}=1; path=/; max-age=${YEAR}; samesite=lax`, `${CHOICE_COOKIE}=; path=/; max-age=0; samesite=lax`],
  refuse: [`${CHOICE_COOKIE}=no; path=/; max-age=${CHOICE_REFUSED_DAYS * 86400}; samesite=lax`],
  later: [`${CHOICE_COOKIE}=later; path=/; samesite=lax`],
  /** Retirer l'accord : efface tout ce que l'accord avait permis. */
  withdraw: [NEWS_COOKIE, SEEN_COOKIE, SINCE_COOKIE].map((n) => `${n}=; path=/; max-age=0; samesite=lax`),
} as const;

export type TrayMode = "ask" | "withdraw";

/** Le bandeau s'ouvre en « Retirer mon accord » si l'accord existe, sinon en « Accepter » . */
export function modeFor(accepted: boolean): TrayMode {
  return accepted ? "withdraw" : "ask";
}

export type TrayAction = "accept" | "refuse" | "later" | "withdraw";

/** Les cookies lus dans `document.cookie` : y a-t-il un accord ? */
export function hasAccepted(cookieString: string): boolean {
  return /(?:^|;\s*)curiosa_news=1(?:;|$)/.test(cookieString);
}

/** Clés de texte du bandeau (toutes sous « cookies. »), pour construire les libellés côté serveur. */
export const TRAY_TEXT_KEYS = [
  "title", "intro", "necessaryTitle", "necessaryText", "optionalTitle", "optionalText", "promise", "more",
  "accept", "refuse", "withdrawTitle", "withdrawText", "withdraw", "close",
  "doneAccepted", "doneRefused", "doneWithdrawn", "settings", "manage",
] as const;
export type TrayLabels = Record<(typeof TRAY_TEXT_KEYS)[number], string>;
