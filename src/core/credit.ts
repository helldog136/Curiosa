/**
 * Crédit exigé par la licence (section 4) : « Powered by Curiosa », « Curiosa » étant un lien vers le dépôt du projet.
 * Une seule adresse, utilisée par le pied de page du site (sans numéro de version : jamais de version côté public) et par celui de l'admin.
 */
export const CREDIT_URL = "https://github.com/helldog136/Curiosa";

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
