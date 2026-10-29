import type { Block } from "@/core/blocks";
import { isExternalHref } from "@/core/url";
import { UPLOADED_RASTER_SOURCE } from "@/core/imageCrop";
import { safeHref } from "@/core/url";
import { Markdown } from "./Markdown";
import { PanelTabs } from "./PanelTabs";
import { HeroVideo } from "./HeroVideo";

type PanelBlock = Extract<Block, { type: "panel" }>;
type VideoLabels = { play: string; pause: string; soundOn: string; soundOff: string };

/** Une image de bloc : un fichier du site, ou une adresse https ; le reste est ignoré. */
const IMAGE_RE = new RegExp(`^(${UPLOADED_RASTER_SOURCE}|https://[^\\s"'()<>\\\\]+)$`);
export const safeImage = (v: unknown): string | undefined => (typeof v === "string" && IMAGE_RE.test(v) ? v : undefined);
const POSITIONS: Record<string, string> = { center: "center", left: "left center", right: "right center", top: "center top", bottom: "center bottom", "top-left": "left top", "top-right": "right top", "bottom-left": "left bottom", "bottom-right": "right bottom" };
const SIZES: Record<string, string> = { cover: "cover", contain: "contain", auto: "auto" };

/** Collage de 1 à 3 images décalées (mise en page fixe, pas de placement libre : pour un placement précis, l'image de fond du bloc). */
function Collage({ images }: { images: string[] }) {
  const [a, b, c] = images;
  if (!a) return null;
  const card = "absolute overflow-hidden rounded-panel border-4 border-bg object-cover shadow-lg";
  /* eslint-disable @next/next/no-img-element */
  if (!b) return <div className="flex justify-center"><img src={a} alt="" loading="lazy" data-skin-part="image" className="max-h-96 rounded-panel object-cover shadow-lg" /></div>;
  return (
    <div className="relative mx-auto aspect-[4/5] w-full max-w-md" data-testid="collage" data-skin-part="media">
      <img src={a} alt="" loading="lazy" data-skin-part="image" className={`${card} left-0 top-0 h-[55%] w-[52%]`} />
      <img src={b} alt="" loading="lazy" data-skin-part="image" className={`${card} bottom-0 left-[18%] z-10 h-[58%] w-[56%]`} />
      {c && <img src={c} alt="" loading="lazy" data-skin-part="image" className={`${card} right-0 top-[30%] h-[42%] w-[44%]`} />}
    </div>
  );
  /* eslint-enable @next/next/no-img-element */
}

/** Où le bouton est posé : sur un voile sombre (texte blanc), sur un fond d'accent (texte `accent-fg`, calculé pour être lisible sur l'accent), ou sur le fond du site. */
type ButtonOn = "veil" | "accent";
const BUTTON_STYLES: Record<ButtonOn | "page", string> = {
  veil: "border-on-veil text-on-veil hover:bg-on-veil hover:text-veil-ink",
  accent: "border-accent-fg text-accent-fg hover:bg-accent-fg hover:text-accent",
  page: "border-accent text-accent hover:bg-accent hover:text-accent-fg",
};

function Button({ button, on }: { button?: { label: string; href: string }; on?: ButtonOn }) {
  if (!button?.label) return null;
  const href = safeHref(button.href);
  return (
    <a href={href} data-skin-part="button" data-btn={on ? undefined : "primary"} {...(isExternalHref(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`inline-block rounded-button border-token-strong px-6 py-3 font-semibold transition-colors ${BUTTON_STYLES[on ?? "page"]}`}>
      {button.label}
    </a>
  );
}

/** Bouton du bandeau d'accueil (même bouton que celui des blocs de page). */
export function HeroButton({ button }: { button: { label: string; href: string } }) {
  return <Button button={button} />;
}

export function Panel({ block, labels }: { block: PanelBlock; labels: VideoLabels }) {
  const images = (block.images ?? []).map(safeImage).filter((x): x is string => !!x).slice(0, 3);
  if (block.kind === "video" && block.video) {
    return <HeroVideo src={block.video} poster={safeImage(block.videoPoster)} sound={!!block.videoSound} title={block.title ?? ""} text={block.text} eyebrow={block.eyebrow} button={block.button} labels={labels} />;
  }
  const bg = block.bg && safeImage(block.bg.src);
  const veil = bg ? block.bg?.veil : undefined;
  const on: ButtonOn | undefined = veil === "dark" ? "veil" : block.tone === "accent" ? "accent" : undefined;
  const dark = on !== undefined;
  const tone = block.tone === "accent" ? (on === "veil" ? "bg-accent" : "bg-accent text-accent-fg") : block.tone === "surface" ? "bg-surface" : "";
  const heading = block.title ? <h2 data-skin-part="heading" data-level="2" data-marker={!dark ? "" : undefined} className={`text-3xl font-bold tracking-tight sm:text-4xl ${!dark ? "text-accent" : ""}`}>{block.title}</h2> : null;
  const head = (
    <>
      {block.eyebrow && <p data-skin-part="eyebrow" className="text-sm font-semibold uppercase tracking-wide">{block.eyebrow}</p>}
      {heading}
      {block.text && <Markdown text={block.text} />}
    </>
  );

  let body: React.ReactNode;
  if (block.kind === "tabs" && block.items?.length) {
    const tabs = block.items.map((it) => ({
      label: it.title,
      image: safeImage(it.image),
      content: (<>{it.heading && <h3 data-skin-part="heading" data-level="3" className="text-xl font-semibold">{it.heading}</h3>}{it.text && <Markdown text={it.text} />}</>),
    }));
    body = <div className="space-y-6"><div className="max-w-[var(--sk-prose-width-wide,48rem)] space-y-3">{head}</div><PanelTabs tabs={tabs} side={<Collage images={images} />} /></div>;
  } else if (block.kind === "stats" && block.items?.length) {
    body = (
      <div className="space-y-8">
        <div className="mx-auto max-w-[var(--sk-prose-width-wide,48rem)] space-y-3 text-center">{head}</div>
        <ul data-skin-part="list" data-kind="figures" className="flex flex-wrap justify-center gap-x-14 gap-y-8 text-center">
          {block.items.map((it, i) => (
            <li key={i} data-skin-part="list-item" className="min-w-40 max-w-xs flex-1 basis-40"><p data-stat={dark ? undefined : ""} data-skin-part="stat" className="text-balance text-4xl font-extrabold tracking-tight sm:text-5xl">{it.title}</p>{it.heading && <p className={`mx-auto mt-2 max-w-[22ch] text-balance text-sm ${on === "accent" ? "" : "opacity-80"}`}>{it.heading}</p>}</li>
          ))}
        </ul>
      </div>
    );
  } else if (block.kind === "cta") {
    body = <div className="mx-auto max-w-[var(--sk-prose-width,42rem)] space-y-4 py-6 text-center">{head}<Button button={block.button} on={on} /></div>;
  } else {
    // « media » : texte d'un côté, images de l'autre (côté réglable). Sans image, le texte prend toute la place.
    const text = <div className="space-y-4">{head}<Button button={block.button} on={on} /></div>;
    body = images.length ? (
      <div className="grid items-center gap-8 md:grid-cols-2">
        {block.imageSide === "left" ? <><Collage images={images} />{text}</> : <>{text}<Collage images={images} /></>}
      </div>
    ) : text;
  }

  return (
    <section data-testid="panel" data-skin-part="panel" data-kind={block.kind} data-on={on} className={`relative isolate overflow-hidden rounded-panel px-6 py-10 sm:px-10 ${tone} ${veil === "dark" ? "text-on-veil" : ""}`}
      style={bg ? { backgroundImage: `url("${bg}")`, backgroundSize: SIZES[block.bg?.size ?? "cover"] ?? "cover", backgroundPosition: POSITIONS[block.bg?.position ?? "center"] ?? "center", backgroundRepeat: "no-repeat" } : undefined}>
      {veil && veil !== "none" && <div aria-hidden="true" className={`absolute inset-0 -z-10 ${veil === "dark" ? "bg-veil" : "bg-bg/70"}`} />}
      {body}
    </section>
  );
}
