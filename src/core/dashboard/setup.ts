/**
 * TABLEAU DE BORD — « Mise en route » d'un site neuf : une liste de contrôle CALCULÉE (jamais cochée à la main), avec sa progression.
 *
 * Chaque étape se déduit d'un fait que le site connaît déjà (un nom choisi, un logo envoyé, une page publiée…) : rien n'est enregistré en plus, sauf le choix de la masquer
 * (réglage additif `dashboard.setup.hidden`, un ancien cœur l'ignore). La liste disparaît d'elle-même quand tout est fait, ou quand la personne la masque ; elle ne revient pas
 * seule. Elle est réservée à qui règle le site (Administration et au-dessus) : une rédaction n'a pas à voir des étapes qu'elle ne peut pas faire.
 * La partie pure (`evaluateSetup`) ne lit rien et se teste seule.
 */
import { prisma } from "../db";
import { hasRole, type AdminUser } from "../auth/access";
import { listLogos } from "../logos";
import { getSetting, setSetting, deleteSetting, getSiteConfig } from "../settings";
import { audit } from "../permissions";

export const SETUP_HIDDEN_KEY = "dashboard.setup.hidden";
/** Le nom que porte un site qu'on n'a pas encore nommé. */
export const DEFAULT_SITE_NAME = "Curiosa";

export const SETUP_STEPS = ["name", "tagline", "logo", "page", "social", "look"] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];

/** Ce que le site sait de lui-même. */
export type SetupFacts = {
  nameChosen: boolean;
  taglineWritten: boolean;
  logoSent: boolean;
  /** Au moins un contenu publié. */
  pagePublished: boolean;
  socialAdded: boolean;
  /** Un skin autre que celui de départ, ou des couleurs choisies. */
  lookChosen: boolean;
};

export type SetupStep = { id: SetupStepId; done: boolean; href: string };
export type SetupState = {
  steps: SetupStep[];
  done: number;
  total: number;
  /** Pourcentage entier, 0 à 100. */
  percent: number;
  complete: boolean;
  /** La personne l'a masquée. */
  hidden: boolean;
  /** À montrer : pas masquée, pas finie. */
  visible: boolean;
};

export type SetupLinks = { settings: string; appearance: string; social: string; newPage: string };
export const DEFAULT_SETUP_LINKS: SetupLinks = { settings: "/admin/settings", appearance: "/admin/appearance", social: "/admin/social", newPage: "/admin/extensions" };

/** Pur : l'état de la liste à partir des faits. */
export function evaluateSetup(facts: SetupFacts, hidden: boolean, links: SetupLinks = DEFAULT_SETUP_LINKS): SetupState {
  const steps: SetupStep[] = [
    { id: "name", done: facts.nameChosen, href: links.settings },
    { id: "tagline", done: facts.taglineWritten, href: links.settings },
    { id: "logo", done: facts.logoSent, href: links.settings },
    { id: "page", done: facts.pagePublished, href: links.newPage },
    { id: "social", done: facts.socialAdded, href: links.social },
    { id: "look", done: facts.lookChosen, href: links.appearance },
  ];
  const done = steps.filter((s) => s.done).length;
  const complete = done === steps.length;
  return { steps, done, total: steps.length, percent: Math.round((done / steps.length) * 100), complete, hidden, visible: !hidden && !complete };
}

/** Qui voit la liste de mise en route. */
export const canSeeSetup = (user: AdminUser): boolean => hasRole(user, "admin");

/** Lit les faits sur le site (huit lectures simples au plus, aucune ne peut faire échouer le tableau de bord : un fait illisible vaut « pas encore fait »). */
export async function loadSetupFacts(opts: { contentInstanceIds: readonly string[]; locale: string }): Promise<SetupFacts> {
  const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => { try { return await f(); } catch { return fallback; } };
  const config = await getSiteConfig(opts.locale);
  const [published, socials, skin, accent, background] = await Promise.all([
    opts.contentInstanceIds.length ? safe(() => prisma.entry.count({ where: { status: "published", instanceId: { in: [...opts.contentInstanceIds] } } }), 0) : Promise.resolve(0),
    safe(async () => (await import("../social")).loadSocialLinks(opts.locale, 1).then((l) => l.length), 0),
    safe(() => getSetting<string>("skin.active"), undefined),
    safe(() => getSetting<string>("theme.accent"), undefined),
    safe(() => getSetting<string>("theme.background"), undefined),
  ]);
  return {
    nameChosen: config.name.trim() !== "" && config.name.trim() !== DEFAULT_SITE_NAME,
    taglineWritten: config.tagline.trim() !== "",
    logoSent: !!config.logo || listLogos(config.logos).length > 0,
    pagePublished: published > 0,
    socialAdded: socials > 0,
    lookChosen: (typeof skin === "string" && skin !== "" && skin !== "basic") || typeof accent === "string" || typeof background === "string",
  };
}

export async function loadSetup(opts: { contentInstanceIds: readonly string[]; locale: string; links?: SetupLinks }): Promise<SetupState> {
  const hidden = (await getSetting<boolean>(SETUP_HIDDEN_KEY).catch(() => undefined)) === true;
  return evaluateSetup(await loadSetupFacts(opts), hidden, opts.links);
}

/** Masque (ou réaffiche) la liste. Réservé à qui la voit ; noté au journal. */
export async function setSetupHidden(user: AdminUser, hidden: boolean): Promise<boolean> {
  if (!canSeeSetup(user)) return false;
  if (hidden) await setSetting(SETUP_HIDDEN_KEY, true);
  else await deleteSetting(SETUP_HIDDEN_KEY);
  await audit(user.email, "settings.update", hidden ? "dashboard.setup.hide" : "dashboard.setup.show");
  return true;
}
