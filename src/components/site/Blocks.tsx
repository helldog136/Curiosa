import type { Block } from "@/core/blocks";
import { getInstanceByKey } from "@/core/instances";
import { withLocale } from "@/core/links";
import { listEntries } from "@/core/content/entries";
import { isSafeExternalUrl, safeHref } from "@/core/url";
import { getSiteConfig } from "@/core/settings";
import { makeTranslator } from "@/core/i18n/dictionary";
import { EntryList } from "./EntryList";
import { Markdown } from "./Markdown";
import { ModuleForm } from "./ModuleForm";
import { CopyCode } from "./CopyCode";
import { CopyText } from "./CopyText";
import { AdminBlockForm, RowActionButton } from "../admin/AdminBlocks";

const TONES = {
  info: "bg-accent text-accent-fg",
  success: "bg-emerald-600 text-white",
  warning: "bg-amber-500 text-black",
};

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

export async function Blocks({ blocks, locale, adminInstanceId }: { blocks: Block[]; locale: string; adminInstanceId?: string }) {
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
      case "hero":
        out.push(
          <section key={i} className="space-y-4 py-8 text-center">
            {block.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={block.image} alt="" className="mx-auto h-28 w-28 rounded-full object-cover" />
            )}
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{block.title}</h1>
            {block.text && <p className="mx-auto max-w-2xl text-lg text-muted">{block.text}</p>}
          </section>,
        );
        break;
      case "swatches": {
        const t = makeTranslator(locale);
        out.push(
          <ul key={i} className="grid gap-3 sm:grid-cols-2">
            {block.items.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c.hex)).map((c) => (
              <li key={c.name + c.hex} className="flex items-center gap-4 rounded-xl border border-line bg-surface p-3">
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
              <li key={d.src} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.src} alt={d.label} className="h-40 w-full object-contain" />
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>{d.label}{d.detail && <span className="block text-xs text-muted">{d.detail}</span>}</span>
                  <a href={d.src} download className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-fg hover:opacity-90">{t("site.download")}</a>
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
          <div key={i} className="space-y-2 rounded-xl border border-line bg-surface p-4">
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
                <a href={safeHref(item.href)} className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent hover:text-accent">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>,
        );
        break;
      case "entries": {
        const instance = await getInstanceByKey(block.instance);
        if (!instance || !instance.enabled) break;
        let entries = await listEntries({ instance, locale, limit: block.pick === "random" ? undefined : block.limit });
        if (block.pick === "random") entries = pickRandom(entries.filter((e) => !e.expired), block.limit ?? 1);
        if (block.link && entries.length === 0) break;
        const seeAll = block.link && instance.basePath ? withLocale(`/${instance.basePath}`, locale, config.defaultLocale) : null;
        out.push(
          <section key={i} className="space-y-4">
            {(block.title || seeAll) && (
              <div className="flex items-baseline justify-between gap-4">
                {block.title && <h2 className="text-2xl font-semibold">{block.title}</h2>}
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
        if (adminInstanceId) out.push(<AdminBlockForm key={i} instanceId={adminInstanceId} block={block} />);
        break;
      case "table":
        out.push(
          <div key={i} className="overflow-x-auto">
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
                        <div className="flex gap-2">
                          {block.rowActions.map((a) => (
                            <RowActionButton key={a.label} instanceId={adminInstanceId} label={a.label} action={a.action}
                              href={a.href?.replace("{id}", encodeURIComponent(block.rowIds?.[r] ?? ""))} id={block.rowIds?.[r]} confirm={a.confirm} danger={a.danger} />
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
        if (tag.inline) return <script key={i} dangerouslySetInnerHTML={{ __html: tag.inline }} />;
        return <script key={i} src={tag.src} defer={tag.defer} />;
      })}
    </>
  );
}
