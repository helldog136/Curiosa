import type { Translator } from "./i18n/dictionary";

/**
 * POLITIQUE DE CONFIDENTIALITÉ du site, fabriquée par le cœur à partir de ce que le site fait VRAIMENT (réglages réels, modules actifs) et publiée sur /privacy,
 * avec un lien permanent dans le pied de page. Le texte obligatoire n'est pas modifiable : le propriétaire peut seulement AJOUTER ses propres paragraphes
 * (section finale « Informations complémentaires »), jamais retirer ni changer ce que Curiosa déclare de son propre fonctionnement.
 * Un module déclare ce qu'il collecte dans `privacy` de son manifeste ; sa déclaration est reprise telle quelle.
 */
export type PrivacyInput = {
  siteName: string;
  contactEmail: string;
  statsEnabled: boolean;
  newsToggle: boolean;
  /** Fonctionnalités qui collectent des données : nom de l'instance + ce que son module déclare. */
  features: { name: string; text: string }[];
  /** Ajout du propriétaire (Markdown), après le texte obligatoire. */
  extra: string;
  t: Translator;
};

export function buildPrivacyPolicy({ siteName, contactEmail, statsEnabled, newsToggle, features, extra, t }: PrivacyInput): string {
  const out: string[] = [t("privacy.intro", { name: siteName }), ""];
  out.push(`## ${t("privacy.who")}`, "", contactEmail ? t("privacy.whoContact", { name: siteName, email: contactEmail }) : t("privacy.whoNoContact", { name: siteName }), "");
  out.push(`## ${t("privacy.cookies")}`, "", `- ${t("privacy.cookies.locale")}`);
  if (newsToggle) out.push(`- ${t("privacy.cookies.news")}`);
  out.push(`- ${t("privacy.cookies.none")}`, "");
  out.push(`## ${t("privacy.stats")}`, "", statsEnabled ? t("privacy.stats.on") : t("privacy.stats.off"), "");
  if (features.length > 0) {
    out.push(`## ${t("privacy.features")}`, "");
    for (const f of features) out.push(`### ${f.name}`, "", f.text.trim(), "");
  }
  out.push(`## ${t("privacy.rights")}`, "", t("privacy.rights.text"), "");
  const own = extra.trim();
  if (own) out.push(`## ${t("privacy.extra")}`, "", own, "");
  return out.join("\n").trim() + "\n";
}
