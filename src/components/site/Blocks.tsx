import { HeroVideo } from "./HeroVideo";
import { Panel, HeroButton } from "./Panel";
import type { Block } from "@/core/blocks";
import { jsonLd, moduleJsonLd } from "@/core/seo";
import { getInstanceByKey } from "@/core/instances";
import { withLocale } from "@/core/links";
import { listEntries, MAX_PER_PAGE } from "@/core/content/entries";
import { isSafeExternalUrl, safeHref } from "@/core/url";
import { getSiteConfig } from "@/core/settings";
import { makeTranslator } from "@/core/i18n/dictionary";
import { describeNetHealth } from "@/core/netHealthText";
import { EntryList } from "./EntryList";
import { Markdown } from "./Markdown";
import { ModuleForm } from "./ModuleForm";
import { CopyCode } from "./CopyCode";
import { CopyText } from "./CopyText";
import { AdminBlockForm, RowActionButton, type FileLabels } from "../admin/AdminBlocks";
import { ui } from "../admin/ui";
import { GridEditor } from "../admin/GridEditor";
import { floatingLabels } from "../admin/floating";
import { mayShowDownload } from "@/core/modules/downloadAccess";
import { SuggestInstall } from "../admin/SuggestInstall";

const TONES = {
  info: "bg-accent text-accent-fg",
  success: "bg-success text-success-fg",
  warning: "bg-warning text-warning-fg",
};

/** Pastille de couleur de chaque état d'un service externe (bloc « netHealth »). */
const NET_DOT = { ok: "bg-success", slow: "bg-warning", rate: "bg-warning", quota: "bg-warning", down: "bg-danger", unknown: "bg-line" } as const;

/** Rend les blocs renvoyés par les modules. Les blocs "head" sont traités à part (voir HeadTags). */
/** `n` éléments au hasard, sans répétition. */
function pickRandom<T>(items: T[], n: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, Math.max(1, n));
}

/**
 * `adminInstanceId` : blocs du panneau d'admin d'une instance (formulaires et boutons actifs). `adminEntry` : blocs d'une section ajoutée à l'éditeur d'une entrée —
 * les formulaires et boutons passent par les actions de la section (voir core/modules/entryPanels.ts) ; l'éditeur de grille n'y existe pas.
 */
export async function Blocks({ blocks, locale, adminInstanceId: panelInstanceId, adminEntry }: { blocks: Block[]; locale: string; adminInstanceId?: string; adminEntry?: { instanceId: string; panelId: string; entryId: string } }) {
  const adminInstanceId = adminEntry?.instanceId ?? panelInstanceId;
  const entryScope = adminEntry ? { panelId: adminEntry.panelId, entryId: adminEntry.entryId } : undefined;
  const config = await getSiteConfig();
  const out: React.ReactNode[] = [];
  for (const [i, block] of blocks.entries()) {
    switch (block.type) {
      case "markdown":
        out.push(<Markdown key={i} text={block.text} />);
        break;
      case "html":
        out.push(<div key={i} dangerouslySetInnerHTML={{ __html: block.html }} />);
        break;
      case "panel": {
        const t = makeTranslator(locale);
        out.push(<Panel key={i} block={block} labels={{ play: t("site.video.play"), pause: t("site.video.pause"), soundOn: t("site.video.soundOn"), soundOff: t("site.video.soundOff") }} />);
        break;
      }
      case "hero":
        if (block.video) {
          const t = makeTranslator(locale);
          out.push(<HeroVideo key={i} src={block.video} poster={block.videoPoster} sound={!!block.videoSound} title={block.title} text={block.text} logo={block.image} eyebrow={block.eyebrow} button={block.button}
            labels={{ play: t("site.video.play"), pause: t("site.video.pause"), soundOn: t("site.video.soundOn"), soundOff: t("site.video.soundOff") }} />);
          break;
        }
        out.push(
          <section key={i} className="space-y-4 py-8 text-center">
            {block.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={block.image} alt="" className="mx-auto h-28 w-28 rounded-full object-cover" />
            )}
            {block.eyebrow && <p className="text-sm font-semibold uppercase tracking-wide text-muted">{block.eyebrow}</p>}
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{block.title}</h1>
            {block.text && <p className="mx-auto max-w-2xl text-lg text-muted">{block.text}</p>}
            {block.button && <p><HeroButton button={block.button} /></p>}
          </section>,
        );
        break;
      case "swatches": {
        const t = makeTranslator(locale);
        out.push(
          <ul key={i} className="grid gap-3 sm:grid-cols-2">
            {block.items.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c.hex)).map((c) => (
              <li key={c.name + c.hex} data-card="" className="flex items-center gap-4 rounded-xl border border-line bg-surface p-3">
                <span className="h-14 w-14 shrink-0 rounded-lg border border-line" style={{ backgroundColor: c.hex }} aria-hidden="true" />
                <div className="flex min-w-0 flex-col items-start gap-1">
                  <span className="text-sm font-semibold">{c.name}</span>
                  {c.role && <span className="text-xs text-muted">{c.role}</span>}
                  <CopyCode code={c.hex.toUpperCase()} copyLabel={t("site.copy")} copiedLabel={t("site.copied")} />
                </div>
              </li>
            ))}
          </ul>,
        );
        break;
      }
      case "downloads": {
        const t = makeTranslator(locale);
        out.push(
          <ul key={i} className="grid gap-4 sm:grid-cols-2">
            {block.items.filter((d) => d.src.startsWith("/") || /^https?:\/\//.test(d.src)).map((d) => (
              <li key={d.src} data-card="" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.src} alt={d.label} className="h-40 w-full object-contain" />
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>{d.label}{d.detail && <span className="block text-xs text-muted">{d.detail}</span>}</span>
                  <a href={d.src} download data-btn="primary" className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-fg hover:opacity-90">{t("site.download")}</a>
                </div>
              </li>
            ))}
          </ul>,
        );
        break;
      }
      case "copy": {
        const t = makeTranslator(locale);
        out.push(
          <div key={i} data-card="" className="space-y-2 rounded-xl border border-line bg-surface p-4">
            {block.label && <p className="text-xs uppercase tracking-wide text-muted">{block.label}</p>}
            <p className="text-sm">{block.text}</p>
            <CopyText text={block.text} copyLabel={t("site.copy")} copiedLabel={t("site.copied")} />
          </div>,
        );
        break;
      }
      case "heading":
        out.push(<h2 key={i} className="mt-6 text-xl font-semibold">{block.text}</h2>);
        break;
      case "banner": {
        const tone = TONES[block.tone ?? "info"];
        const inner = <span className="font-medium">{block.text}</span>;
        out.push(
          <div key={i} className={`px-4 py-2 text-center text-sm ${tone}`} role="status">
            {block.href && (block.href.startsWith("/") || isSafeExternalUrl(block.href)) ? (
              <a href={safeHref(block.href)} className="underline-offset-2 hover:underline">{inner}</a>
            ) : inner}
          </div>,
        );
        break;
      }
      case "links":
        out.push(
          <ul key={i} className="flex flex-wrap gap-3">
            {block.items.map((item) => (
              <li key={`${item.href}-${item.label}`}>
                <a href={safeHref(item.href)} data-chip="" className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent hover:text-accent">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>,
        );
        break;
      case "entries": {
        const instance = await getInstanceByKey(block.instance);
        if (!instance) break;
        // Toujours borné : la base trie et tronque (jamais toutes les entrées). Tirage au hasard : parmi les 100 premières, non expirées.
        const wanted = block.limit && block.limit > 0 ? block.limit : MAX_PER_PAGE;
        let entries = await listEntries({ instance, locale, limit: block.pick === "random" ? 100 : wanted });
        if (block.pick === "random") entries = pickRandom(entries.filter((e) => !e.expired), block.limit ?? 1);
        if (block.link && entries.length === 0) break;
        const seeAll = block.link && instance.basePath ? withLocale(`/${instance.basePath}`, locale, config.defaultLocale) : null;
        out.push(
          <section key={i} className="space-y-4">
            {(block.title || seeAll) && (
              <div className="flex items-baseline justify-between gap-4">
                {block.title && <h2 data-marker="" className="text-2xl font-semibold">{block.title}</h2>}
                {seeAll && <a href={seeAll} className="text-sm text-accent hover:underline">{makeTranslator(locale)("site.seeAll")}</a>}
              </div>
            )}
            <EntryList entries={entries} collection={instance} locale={locale} defaultLocale={config.defaultLocale} />
          </section>,
        );
        break;
      }
      case "embed":
        if (!block.src.startsWith("https://")) break;
        out.push(
          <div key={i} className="overflow-hidden rounded-xl border border-line" style={{ aspectRatio: block.ratio ?? "16 / 9" }}>
            <iframe src={block.src} title={block.title} className="h-full w-full" allowFullScreen loading="lazy" />
          </div>,
        );
        break;
      case "form":
        out.push(
          <ModuleForm key={i} action={block.action} fields={block.fields} submitLabel={block.submitLabel} successText={block.successText} />,
        );
        break;
      case "adminForm":
        // Les formulaires d'admin n'existent que dans le panneau d'admin (jamais sur le site public).
        if (adminInstanceId) {
          // Textes du champ fichier (envoi par la route du cœur, pas par une action serveur) : seulement si le formulaire en a un.
          const t = makeTranslator(locale);
          const fileLabels: FileLabels | undefined = block.fields.some((f) => f.kind === "file")
            ? { tooBig: t("transfer.file.tooLarge"), sending: t("transfer.sending"), failed: t("transfer.failed"), done: t("transfer.done") }
            : undefined;
          out.push(<AdminBlockForm key={i} instanceId={adminInstanceId} block={block} entry={entryScope} fileLabels={fileLabels} />);
        }
        break;
      case "download":
        // Téléchargement d'administration : un petit formulaire POST (le navigateur envoie alors l'en-tête Origin, que la route du cœur contrôle). Jamais sur le site public.
        if (panelInstanceId && !entryScope && /^[A-Za-z0-9_-]{1,64}$/.test(block.name) && (await mayShowDownload(panelInstanceId, block.name))) {
          out.push(
            <form key={i} method="post" action={`/api/admin/modules/${encodeURIComponent(panelInstanceId)}/download/${encodeURIComponent(block.name)}`} className="flex">
              {Object.entries(block.params ?? {}).slice(0, 20).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v).slice(0, 1000)} />)}
              <button type="submit" className={ui.btn}>{block.label}</button>
            </form>,
          );
        }
        break;
      case "gridEditor":
        if (adminInstanceId && !entryScope) out.push(<GridEditor key={i} instanceId={adminInstanceId} block={block} floating={floatingLabels(makeTranslator(locale))} />);
        break;
      case "table":
        out.push(
          <div key={i} className="relative overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  {block.columns.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}
                  {adminInstanceId && block.rowActions && <th />}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="border-t border-line align-top">
                    {row.map((cell, c) => <td key={c} className="whitespace-pre-wrap px-3 py-2">{cell}</td>)}
                    {adminInstanceId && block.rowActions && (
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex items-start gap-2">
                          {block.rowActions.map((a) => (
                            <RowActionButton key={a.label} instanceId={adminInstanceId} label={a.label} action={a.action}
                              href={a.href?.replace("{id}", encodeURIComponent(block.rowIds?.[r] ?? ""))} id={block.rowIds?.[r]} confirm={a.confirm} danger={a.danger} entry={entryScope} />
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        break;
      case "netHealth": {
        // Santé des services externes : panneau d'admin uniquement (jamais sur le site public : l'état des fournisseurs ne regarde pas les visiteurs).
        if (!adminInstanceId) break;
        const view = describeNetHealth(block.items, locale);
        if (view.lines.length === 0) break;
        out.push(
          <section key={i} data-card="" className="space-y-3 rounded-xl border border-line bg-surface p-4" aria-label={view.title}>
            <h3 className="text-sm font-semibold">{view.title}</h3>
            {view.summary && (
              <div className="rounded-lg border border-warning p-3 text-sm" role="status">
                <p className="font-medium">{view.summary}</p>
                {view.hint && <p className="mt-1 text-muted">{view.hint}</p>}
              </div>
            )}
            <ul className="space-y-2">
              {view.lines.map((l) => (
                <li key={`${l.host}-${l.label}`} className="flex items-start gap-2 text-sm">
                  <span aria-hidden="true" className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${NET_DOT[l.state]}`} />
                  <span className="min-w-0 break-words">{l.text}</span>
                </li>
              ))}
            </ul>
          </section>,
        );
        break;
      }
      case "suggestInstall":
        // Panneau d'admin d'une instance seulement (jamais sur le site public, ni dans une section de l'éditeur d'entrée).
        if (panelInstanceId && !entryScope) out.push(<SuggestInstall key={i} instanceId={panelInstanceId} service={block.service} min={block.min} reason={block.reason} locale={locale} />);
        break;
      case "head":
        break;
    }
  }
  if (out.length === 0) return null;
  return <div className="space-y-6">{out}</div>;
}

export function HeadTags({ blocks }: { blocks: Block[] }) {
  const tags = blocks.flatMap((b) => (b.type === "head" ? b.tags : []));
  return (
    <>
      {tags.map((tag, i) => {
        if (tag.tag === "meta") return <meta key={i} name={tag.name} property={tag.property} content={tag.content} />;
        if (tag.tag === "link") return <link key={i} rel={tag.rel} href={tag.href} type={tag.type} title={tag.title} />;
        if (tag.jsonLd) {
          const data = moduleJsonLd(tag.jsonLd);
          return data ? <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} /> : null;
        }
        if (tag.inline) return <script key={i} dangerouslySetInnerHTML={{ __html: tag.inline }} />;
        return <script key={i} src={tag.src} defer={tag.defer} />;
      })}
    </>
  );
}
