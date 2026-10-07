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
  blockquote: ({ children }) => <blockquote className="mt-4 border-l-2 border-accent/60 pl-4 text-muted">{children}</blockquote>,
  code: ({ children }) => <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[0.9em]">{children}</code>,
  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} loading="lazy" className="mt-4 max-w-full rounded-lg" />
  ),
};

/** Markdown sans HTML brut : un éditeur ne peut pas injecter de script. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
