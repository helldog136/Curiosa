import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isExternalHref } from "@/core/url";

const components: Components = {
  a: ({ href, children }) => {
    const external = !!href && isExternalHref(href);
    return (
      <a href={href} className="text-accent underline-offset-2 hover:underline"
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {children}
      </a>
    );
  },
  h1: ({ children }) => <h2 className="mt-8 text-2xl font-semibold">{children}</h2>,
  h2: ({ children }) => <h2 className="mt-8 text-2xl font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-6 text-xl font-semibold">{children}</h3>,
  p: ({ children }) => <p className="mt-4 leading-7">{children}</p>,
  ul: ({ children }) => <ul className="mt-4 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="mt-4 list-decimal space-y-1 pl-6">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="mt-4 rounded-r-lg border-l-4 border-accent/60 bg-surface/60 py-1 pl-4 pr-3 text-muted">{children}</blockquote>,
  h4: ({ children }) => <h4 className="mt-5 text-lg font-semibold">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-4 font-semibold">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-4 text-sm font-semibold uppercase tracking-wide text-muted">{children}</h6>,
  li: ({ children }) => <li className="leading-7 marker:text-muted">{children}</li>,
  hr: () => <hr className="my-8 border-line" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  del: ({ children }) => <del className="text-muted">{children}</del>,
  code: ({ children }) => <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[0.9em]">{children}</code>,
  // Blocs de code : fond sombre lisible, défilement horizontal plutôt que de déborder (l'inline `code` ci-dessus y perd son style).
  pre: ({ children }) => (
    <pre className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface p-4 text-sm leading-6 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]">{children}</pre>
  ),
  // Tableaux (GFM) : défilement horizontal sur petit écran, lignes fines.
  table: ({ children }) => <div className="mt-4 overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-max text-left text-sm">{children}</table></div>,
  thead: ({ children }) => <thead className="bg-surface text-muted">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-t border-line px-3 py-2 align-top">{children}</td>,
  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} loading="lazy" className="mt-4 max-w-full rounded-lg" />
  ),
};

/** Contenu écrit par un tiers (README d'un module avant installation) : aucune image distante chargée (elle révélerait l'administrateur), liens relatifs en simple texte. */
const untrustedComponents: Components = {
  ...components,
  a: ({ href, children }) => (href && /^https?:\/\//i.test(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline-offset-2 hover:underline">{children}</a>
    : <span>{children}</span>),
  img: ({ alt }) => <span className="text-muted">[{alt || "image"}]</span>,
};

/** Markdown sans HTML brut : un éditeur ne peut pas injecter de script. `untrusted` : texte d'un tiers (voir ci-dessus). */
export function Markdown({ text, untrusted = false }: { text: string; untrusted?: boolean }) {
  return (
    <div className="max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={untrusted ? untrustedComponents : components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
