import { ACCESS_LABEL_KEYS } from "@/components/admin/accessLabelKeys";

/** The texts the personal catalogues blocks need (the page translates them once; the blocks are client components). */
export const PERSONAL_LABEL_KEYS = [
  ...ACCESS_LABEL_KEYS, "access.error.empty",
  "personal.url", "personal.url.example", "personal.name", "personal.name.example", "personal.check", "personal.check.code", "personal.checking", "personal.change", "personal.found",
  "personal.needsCore", "personal.add", "personal.adding", "personal.added", "personal.trust", "personal.error.exists", "personal.refresh", "personal.refreshing", "personal.menu",
  "personal.remove", "personal.removing", "personal.remove.title", "personal.remove.kept", "personal.remove.nothing",
] as const;
