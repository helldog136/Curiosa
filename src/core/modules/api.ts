import { isDarkBackground, pickLogo } from "../logos";
import type { AdminUser } from "../auth/access";
import { getBrand } from "@/core/brand";
import { moduleAdminTheme } from "@/core/adminTheme";
import { siteUrl } from "@/core/config";
import { moduleJsonLd } from "@/core/seo";
import { measuredHref } from "@/core/redirectMeasure";
import { entryPath, listEntries, MAX_LIST_LIMIT } from "@/core/content/entries";
import { getInstanceByKey, listInstances, pickName, type InstanceView } from "@/core/instances";
import { isMailConfigured, sendMail } from "@/core/services/mail";
import { sharedNet } from "@/core/services/net";
import { qrSvg } from "@/core/services/qr";
import { relayedCandidates, relayedConfigured, relayedCover } from "@/core/services/rawgRelay";
import { renderPng, type PngSpec } from "@/core/services/render";
import { createStore } from "@/core/services/store";
import { claimFile, filesUsage, FILES_QUOTA_BYTES, FILES_QUOTA_COUNT, ownsFile, removeFile, type FileOwner } from "@/core/services/files";
import { collect, collectPage } from "@/core/services/topics";
import { getSiteConfig } from "@/core/settings";
import { remainingBudgetMs } from "./budget";
import { callService, callServiceAll, providersOf, serviceAvailable } from "./dependencies";
import { visitorFingerprint } from "./visitorFingerprint";
import { privacyDeclarations } from "./privacyDeclarations";
import { getActiveInstances, getModule, type ActiveInstance } from "./registry";
import { pendingSetUps, setUpFor } from "./setUp";
import { eventsOf } from "@/core/journal/events";
import { writeModuleLog, type JournalActor } from "@/core/journal/write";
import type { ModuleApi } from "./types";
import { instanceHref } from "@/core/adminLinks";

/**
 * `ctx.api` : tout ce que le cœur met à disposition d'un module. Un module n'importe jamais rien du
 * cœur : il n'a que cet objet. Deux familles, volontairement distinctes :
 *
 *   SERVICES (helpers génériques, src/core/services/) — indépendants de toute fonctionnalité
 *     qr      générateur de QR code
 *     png     rendu d'une image PNG à partir d'une arborescence de boîtes
 *     store   stockage privé de l'instance
 *     mail    envoi d'e-mails au nom du site (SMTP réglé dans l'admin)
 *     files   fichiers que le module revendique et supprime (permission « files », cœur 0.2.13 ; services/files.ts)
 *     rawg    (DÉPRÉCIÉ depuis la 0.3.0 ; permission « rawg ») simple relais vers le service `game.cover` du module « Jaquettes de jeux » pour les anciens modules ; préférez ce service
 *     topics  échange d'informations typées entre modules
 *     net     client réseau neutre et borné (délai, pauses 429, quota, disjoncteur, file bornée, santé) ; aucun fournisseur connu du cœur
 *     services  appel du service d'un autre module (`call` : maître, ou l'instance `provider` choisie ; `providers` : qui l'offre ; `callAll` : toutes les instances d'un service `each`)
 *     (MCP : pas d'appel côté module ; un module déclare ses actions `mcp`, le cœur les expose)
 *
 *   LECTURE DU SITE (en lecture seule, pour que les modules s'articulent avec le reste)
 *     site, brand (identité visuelle), adminTheme (apparence de l'admin pour les pages secrètes), instances, entries
 *
 * Voir docs/PLATFORM.md.
 */
/** Marge laissée à la section pour afficher son repli quand un appel réseau épuise le temps de la page. */
const NET_PAGE_MARGIN_MS = 500;

/** La personne dont l'action d'administration s'exécute, quand le cœur accepte qu'elle porte ses droits (voir context.ts) ; `null` partout ailleurs. */
export type CallerRef = {
  person: AdminUser | null;
  /**
   * (core 0.14.0) The person whose upload a SERVICE method may keep with `ctx.api.files.claim`: set by the core ONLY on the provider side of a service call that carried the
   * caller's rights (`asCaller` + the method listed in `callerRights`, see dependencies.ts). It opens nothing else: no `ctx.can`, no journal identity.
   */
  uploader?: AdminUser | null;
  /** Journal central : nom du jeton d'un assistant IA qui appelle une action MCP du module (n'ouvre AUCUN droit : voir `asAssistant` dans context.ts). */
  assistant?: string | null;
};

/** Qui agit, DÉDUIT par le cœur (jamais fourni par le module) : la personne connectée, un assistant IA ou, sinon, le module lui-même (le « système » est réservé aux écritures du cœur). */
export function journalActor(instance: Pick<InstanceView, "key">, caller?: CallerRef): JournalActor {
  if (caller?.assistant) return { kind: "assistant", name: `mcp:${caller.assistant}` };
  if (caller?.person) return { kind: "person", name: caller.person.email };
  return { kind: "module", name: `module:${instance.key}` };
}

export function makeApi(instance: InstanceView, locale: string, permissions: readonly string[] = [], caller?: CallerRef): ModuleApi {
  const rawgAllowed = permissions.includes("rawg");
  const privacyAllowed = permissions.includes("privacy");
  const filesAllowed = permissions.includes("files");
  const setUpAllowed = permissions.includes("instances.setup");
  const fileOwner: FileOwner = { moduleId: instance.moduleId, instanceId: instance.id, instanceKey: instance.key };
  /**
   * L'instance appelante, pour un appel de service. Une instance mise à l'écart (migration échouée) ne tourne pas, SAUF pendant sa propre
   * migration (« Réessayer ») : elle doit alors pouvoir appeler les services dont elle dépend, d'où le repli sur son module chargé.
   */
  const consumer = async (): Promise<Pick<ActiveInstance, "mod" | "instance"> | null> => {
    const live = (await getActiveInstances()).find((a) => a.instance.id === instance.id);
    if (live) return live;
    const mod = await getModule(instance.moduleId).catch(() => null);
    return mod ? { mod, instance } : null;
  };
  return {
    siteUrl,

    // Lecture seule des déclarations `privacy` des modules actifs ; sans la permission « privacy » : rien (jamais d'erreur).
    privacy: {
      declarations: async () => {
        if (!privacyAllowed) return { modules: [], truncated: false };
        const config = await getSiteConfig();
        return privacyDeclarations(await getActiveInstances(), locale, config.defaultLocale);
      },
    },

    // Empreinte salée, non réversible et cloisonnée du visiteur d'une requête (limites de débit) : jamais l'adresse, jamais la première entrée de X-Forwarded-For.
    visitor: { fingerprint: (request, scope) => visitorFingerprint(instance.moduleId, request, scope) },

    // Adresse mesurée d'un bouton (réglage « Compter les clics sur mes liens ») : un simple relais, sans permission ; sans le réglage, l'adresse revient telle quelle.
    links: { measured: (url, opts) => measuredHref(String(url ?? ""), { absolute: opts?.absolute === true }) },

    seo: { jsonLd: (data) => { const ld = moduleJsonLd(data); return ld ? { tag: "script", jsonLd: ld } : null; } },

    // Journal central : le module dit QUOI (événement déclaré dans `logEvents`), le cœur déduit QUI, injecte module et instance, écarte les champs non déclarés et purge. Aucune permission.
    log: {
      write: async (entry) => {
        try {
          const mod = await getModule(instance.moduleId).catch(() => null);
          return await writeModuleLog({ action: entry?.action, target: entry?.target, level: entry?.level, data: entry?.data, actor: journalActor(instance, caller), module: instance.moduleId, instance: instance.key, events: eventsOf(mod?.manifest) });
        } catch {
          return false;
        }
      },
    },

    // ── SERVICES du cœur ────────────────────────────────────────────────────────
    qr: qrSvg,
    png: (spec) => renderPng(spec as PngSpec, siteUrl),
    services: {
      available: serviceAvailable,
      async providers(service) {
        const me = await consumer();
        return me ? providersOf(me, service, locale) : [];
      },
      async call(service, method, args, opts) {
        const me = await consumer();
        const provider = opts && typeof opts === "object" && opts.provider !== undefined ? String(opts.provider) : undefined;
        const asCaller = opts && typeof opts === "object" && opts.asCaller === true ? caller?.person ?? null : null;
        return me ? callService(me, service, method, args, locale, { provider, caller: asCaller }) : { ok: false, reason: "unavailable" };
      },
      async callAll(service, method, args) {
        const me = await consumer();
        return me ? callServiceAll(me, service, method, args, locale) : [];
      },
    },
    store: createStore(instance.id),
    // Sans la permission « files » : rien n'est revendiqué ni supprimé (jamais d'erreur levée). La revendication exige la personne de l'action d'administration en cours (caller), ou celle dont une méthode de service listée dans `callerRights` porte les droits (caller.uploader, cœur 0.14.0).
    files: {
      claim: async (url) => {
        if (!filesAllowed) return { ok: false, reason: "no-permission" };
        const who = caller?.person ?? caller?.uploader ?? null;
        try { return await claimFile(fileOwner, who ? { id: who.id, email: who.email } : null, url); } catch { return { ok: false, reason: "unknown" }; }
      },
      remove: async (url) => {
        if (!filesAllowed) return { ok: false, reason: "no-permission" };
        try { return await removeFile(fileOwner, caller?.person?.email ?? caller?.uploader?.email ?? `module:${instance.key}`, url); } catch { return { ok: false, reason: "failed" }; }
      },
      owns: async (url) => { try { return filesAllowed && (await ownsFile(fileOwner, url)); } catch { return false; } },
      usage: async () => {
        if (!filesAllowed) return { files: 0, bytes: 0, limitFiles: 0, limitBytes: 0 };
        try { return await filesUsage(instance.moduleId); } catch { return { files: 0, bytes: 0, limitFiles: FILES_QUOTA_COUNT, limitBytes: FILES_QUOTA_BYTES }; }
      },
    },
    mail: { configured: isMailConfigured, send: (message) => sendMail(message, instance.key) },
    // DÉPRÉCIÉ depuis la 0.3.0 (voir services/rawgRelay.ts). Les jaquettes sont le service `game.cover` du module « Jaquettes de jeux » : les anciens modules (permission « rawg »)
    // sont relayés vers lui, sans aucun repli sur du code du cœur. Sans la permission « rawg », ou sans le module : comme s'il n'y avait pas de clé (jamais d'exception).
    rawg: {
      configured: async () => rawgAllowed && (await relayedConfigured().catch(() => false)),
      cover: async (title) => (rawgAllowed ? await relayedCover(title).catch((): { status: "unreachable"; url: null } => ({ status: "unreachable", url: null })) : { status: "no-key", url: null }),
      candidates: async (title) => (rawgAllowed ? await relayedCandidates(title).catch((): { status: "unreachable"; candidates: [] } => ({ status: "unreachable", candidates: [] })) : { status: "no-key", candidates: [] }),
    },
    net: {
      // Dans une page publique : le délai ne dépasse pas le temps restant de la page, moins une marge pour que le module affiche son repli.
      request: (req) => {
        const left = remainingBudgetMs();
        return sharedNet().request(req, { module: instance.moduleId, budgetMs: left === null ? null : left - NET_PAGE_MARGIN_MS });
      },
      health: async () => sharedNet().health(),
      budgetMs: remainingBudgetMs,
    },
    topics: {
      async collect(topic, opts) {
        const consumer = (await getActiveInstances()).find((a) => a.instance.id === instance.id);
        return consumer ? collect(consumer, topic, { limit: opts?.limit, from: opts?.from, to: opts?.to, locale }) : [];
      },
      async collectPage(topic, opts) {
        const consumer = (await getActiveInstances()).find((a) => a.instance.id === instance.id);
        return consumer ? collectPage(consumer, topic, { limit: opts?.limit, cursor: opts?.cursor, from: opts?.from, to: opts?.to, locale }) : { items: [], next: null };
      },
    },

    // ── LECTURE du site ─────────────────────────────────────────────────────────
    async site(loc) {
      const c = await getSiteConfig(loc);
      return { name: c.name, tagline: c.tagline, logo: pickLogo(c.logos, "any", isDarkBackground(c.background)) };
    },
    brand: (loc) => getBrand(loc ?? locale),
    adminTheme: (opts) => moduleAdminTheme(opts),
    instances: {
      async list({ locale: loc, module } = {}) {
        const config = await getSiteConfig();
        return (await listInstances())
          .filter((i) => !module || i.moduleId === module)
          .map((i) => ({ id: i.id, key: i.key, module: i.moduleId, basePath: i.basePath, name: pickName(i, loc ?? config.defaultLocale, config.defaultLocale), adminPath: instanceHref(i.id) }));
      },
      // Cœur 0.15.0, permission « instances.setup » (voir setUp.ts). Sans elle : rien à proposer, et `setUp` refuse. `caller.person` n'existe que dans une adminAction.
      pending: async (opts) => (setUpAllowed ? pendingSetUps(instance.moduleId, opts?.locale ?? locale) : []),
      setUp: async (moduleId) => (setUpAllowed ? setUpFor({ moduleId: instance.moduleId, instanceKey: instance.key }, caller?.person ?? null, moduleId) : { ok: false, reason: "no-permission" }),
    },
    entries: {
      async list({ instance: key, locale: loc, limit } = {}) {
        const config = await getSiteConfig();
        const target = key ? await getInstanceByKey(key) : instance;
        if (!target) return [];
        const views = await listEntries({ instance: target, locale: loc ?? config.defaultLocale, limit: Number.isFinite(limit) && limit! > 0 ? limit : MAX_LIST_LIMIT }); // borné (200 au plus)
        return views.map((e) => ({
          id: e.id, slug: e.slug, cover: e.cover, icon: e.icon, tags: e.tags, fields: e.fields,
          title: e.title, summary: e.summary, body: e.body, url: e.url, code: e.code,
          path: entryPath(e, config.defaultLocale), publishedAt: e.publishedAt,
        }));
      },
    },
  };
}
