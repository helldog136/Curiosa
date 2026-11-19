/**
 * (core 0.45.0) The mount order of the public resolver, in one place: the catch-all page (`src/app/(site)/[...path]/page.tsx`) and the "skin for this page" lookup
 * (`core/content/pageSkin.ts`) must answer the same question the same way, or an address could wear the skin of a page that is not the one served there.
 * Order: an instance mounted on the first segment wins; otherwise (after the short-link check, done by the caller) the instance mounted at the root.
 */
import type { ActiveInstance } from "./registry";

/** The instance mounted on this first segment (any kind of instance, not only the ones with a feature). */
export const mountedOnBase = (mounted: readonly ActiveInstance[], first: string): ActiveInstance | undefined =>
  mounted.find((a) => a.instance.basePath && a.instance.basePath === first);

/** The instance mounted at the root. */
export const mountedAtRoot = (mounted: readonly ActiveInstance[]): ActiveInstance | undefined =>
  mounted.find((a) => a.instance.basePath === "");
