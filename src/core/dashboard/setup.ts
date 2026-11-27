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
import { APPEARANCE_HREF, EXTENSIONS_ADD_HREF, EXTENSIONS_HREF, SETTINGS_HREF, SETUP_ASSISTANT_HREF, SOCIAL_HREF } from "@/core/adminLinks";

export const SETUP_HIDDEN_KEY = "dashboard.setup.hidden";
/** Le nom que porte un site qu'on n'a pas encore nommé. */
export const DEFAULT_SITE_NAME = "Curiosa";

export const SETUP_STEPS = ["name", "tagline", "logo", "modules", "page", "social", "look", "assistant"] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];
/**
 * (C5i) Les étapes facultatives de l'ancien assistant d'installation (choisir des modules, connecter un assistant IA) : elles s'affichent et se comptent dans la liste,
 * mais ne la gardent pas ouverte à elles seules. Un site déjà réglé dont la liste avait disparu ne la voit donc pas revenir.
 */
export const OPTIONAL_SETUP_STEPS: readonly SetupStepId[] = ["modules", "assistant"];

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
  /** Au moins un module installé. */
  modulesAdded: boolean;
  /** Au moins un accès d'assistant IA actif. */
  assistantConnected: boolean;
};

export type SetupStep = { id: SetupStepId; done: boolean; href: string; optional: boolean };
export type SetupState = {
  steps: SetupStep[];
  done: number;
  total: number;
  /** Pourcentage entier, 0 à 100. */
  percent: number;
  /** Toutes les étapes qui ne sont pas facultatives sont faites. */
  complete: boolean;
  /** La personne l'a masquée. */
  hidden: boolean;
  /** À montrer : pas masquée, pas finie. */
  visible: boolean;
};

export type SetupLinks = { settings: string; appearance: string; social: string; newPage: string; modules: string; assistant: string };
export const DEFAULT_SETUP_LINKS: SetupLinks = { settings: SETTINGS_HREF, appearance: APPEARANCE_HREF, social: SOCIAL_HREF, newPage: EXTENSIONS_HREF, modules: EXTENSIONS_ADD_HREF, assistant: SETUP_ASSISTANT_HREF };

/** Pur : l'état de la liste à partir des faits. */
export function evaluateSetup(facts: SetupFacts, hidden: boolean, links: Partial<SetupLinks> = DEFAULT_SETUP_LINKS): SetupState {
  const l: SetupLinks = { ...DEFAULT_SETUP_LINKS, ...links };
  const raw: { id: SetupStepId; done: boolean; href: string }[] = [
    { id: "name", done: facts.nameChosen, href: l.settings },
    { id: "tagline", done: facts.taglineWritten, href: l.settings },
    { id: "logo", done: facts.logoSent, href: l.settings },
    { id: "modules", done: facts.modulesAdded, href: l.modules },
    { id: "page", done: facts.pagePublished, href: l.newPage },
    { id: "social", done: facts.socialAdded, href: l.social },
    { id: "look", done: facts.lookChosen, href: l.appearance },
    { id: "assistant", done: facts.assistantConnected, href: l.assistant },
  ];
  const steps: SetupStep[] = raw.map((s) => ({ ...s, optional: OPTIONAL_SETUP_STEPS.includes(s.id) }));
  const done = steps.filter((s) => s.done).length;
  const complete = steps.every((s) => s.done || s.optional);
  return { steps, done, total: steps.length, percent: Math.round((done / steps.length) * 100), complete, hidden, visible: !hidden && !complete };
}

/** Qui voit la liste de mise en route. */
export const canSeeSetup = (user: AdminUser): boolean => hasRole(user, "admin");

/** Lit les faits sur le site (dix lectures simples au plus, aucune ne peut faire échouer le tableau de bord : un fait illisible vaut « pas encore fait »). */
export async function loadSetupFacts(opts: { contentInstanceIds: readonly string[]; locale: string }): Promise<SetupFacts> {
  const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => { try { return await f(); } catch { return fallback; } };
  const config = await getSiteConfig(opts.locale);
  const [published, socials, skin, accent, background, modules, assistants] = await Promise.all([
    opts.contentInstanceIds.length ? safe(() => prisma.entry.count({ where: { status: "published", instanceId: { in: [...opts.contentInstanceIds] } } }), 0) : Promise.resolve(0),
    safe(async () => (await import("../social")).loadSocialLinks(opts.locale, 1).then((l) => l.length), 0),
    safe(() => getSetting<string>("skin.active"), undefined),
    safe(() => getSetting<string>("theme.accent"), undefined),
    safe(() => getSetting<string>("theme.background"), undefined),
    safe(() => prisma.moduleInstance.count(), 0),
    safe(() => prisma.apiToken.count({ where: { revokedAt: null } }), 0),
  ]);
  return {
    nameChosen: config.name.trim() !== "" && config.name.trim() !== DEFAULT_SITE_NAME,
    taglineWritten: config.tagline.trim() !== "",
    logoSent: !!config.logo || listLogos(config.logos).length > 0,
    pagePublished: published > 0,
    socialAdded: socials > 0,
    lookChosen: (typeof skin === "string" && skin !== "" && skin !== "basic") || typeof accent === "string" || typeof background === "string",
    modulesAdded: modules > 0,
    assistantConnected: assistants > 0,
  };
}

export async function loadSetup(opts: { contentInstanceIds: readonly string[]; locale: string; links?: Partial<SetupLinks> }): Promise<SetupState> {
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
