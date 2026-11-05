/**
 * Crédit exigé par la licence (section 4) : « Powered by Curiosa ». Le dépôt du projet : adresse des signalements et des guides, et lien du pied de l'administration.
 */
export const CREDIT_URL = "https://github.com/helldog136/Curiosa";

/**
 * Le lien « Curiosa » du crédit dans le pied de page PUBLIC de chaque site : la page du projet, en anglais par défaut et en français pour une personne qui visite en français
 * (toute autre langue : l'adresse anglaise). SEUL endroit qui écrit cette adresse ; pas de numéro de version, jamais.
 */
export const CREDIT_SITE_URL = "https://curiosa.helldog136.be";
export const CREDIT_SITE_URL_FR = `${CREDIT_SITE_URL}/fr`;
export function creditSiteUrl(locale: string): string {
  return locale === "fr" ? CREDIT_SITE_URL_FR : CREDIT_SITE_URL;
}

/**
 * Signalement d'un défaut : les « issues » du dépôt du projet (même adresse que le crédit), avec un titre et un corps PRÉREMPLIS par l'adresse.
 * On n'y met QUE ce qui aide à comprendre (version de Curiosa, de Node, système, canal de mise à jour) : jamais d'adresse du site, de nom,
 * d'e-mail, de réglage ni de donnée. Le texte vient des traductions de l'appelant (`labels`), donc dans la langue de l'interface.
 */
export const BUG_REPORT_URL = `${CREDIT_URL}/issues/new`;

export type BugReportEnv = { version: string; node: string; system: string; channel: string };
export type BugReportLabels = { title: string; intro: string; did: string; expected: string; happened: string; environment: string; version: string; node: string; system: string; channel: string };

export function bugReportUrl(env: BugReportEnv, labels: BugReportLabels): string {
  const one = (s: string) => String(s ?? "").replace(/[^\w.+\- ]/g, "").slice(0, 40);
  const body = [
    labels.intro, "", `### ${labels.did}`, "", "", `### ${labels.expected}`, "", "", `### ${labels.happened}`, "", "",
    `### ${labels.environment}`, "",
    `- ${labels.version} : ${one(env.version)}`, `- ${labels.node} : ${one(env.node)}`, `- ${labels.system} : ${one(env.system)}`, `- ${labels.channel} : ${one(env.channel)}`, "",
  ].join("\n");
  const query = new URLSearchParams({ title: labels.title, body });
  return `${BUG_REPORT_URL}?${query.toString()}`;
}
