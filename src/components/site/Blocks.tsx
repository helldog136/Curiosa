import type { Block } from "@/core/blocks";
import { getCollectionByKey } from "@/core/collections";
import { listEntries } from "@/core/entries";
import { isSafeExternalUrl, safeHref } from "@/core/url";
import { getSiteConfig } from "@/core/settings";
import { EntryList } from "./EntryList";
import { Markdown } from "./Markdown";
import { ModuleForm } from "./ModuleForm";

const TONES = {
  info: "bg-accent text-accent-fg",
  success: "bg-emerald-600 text-white",
  warning: "bg-amber-500 text-black",
};

/** Rend les blocs renvoyés par les modules. Les blocs "head" sont traités à part (voir HeadTags). */
export async function Blocks({ blocks, locale }: { blocks: Block[]; locale: string }) {
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
        const collection = await getCollectionByKey(block.collection);
        if (!collection) break;
        const entries = await listEntries({ collection, locale, limit: block.limit });
        out.push(
          <section key={i} className="space-y-4">
            {block.title && <h2 className="text-xl font-semibold">{block.title}</h2>}
            <EntryList entries={entries} collection={collection} locale={locale} defaultLocale={config.defaultLocale} />
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
      case "table":
        out.push(
          <div key={i} className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>{block.columns.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="border-t border-line align-top">
                    {row.map((cell, c) => <td key={c} className="whitespace-pre-wrap px-3 py-2">{cell}</td>)}
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
