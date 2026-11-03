import { getSetting } from "@/core/settings";
import { normalizeExclude, normalizePerPage, normalizePlacement, type SearchPlacementConfig } from "./config";

export * from "./config";

export type SearchSettings = SearchPlacementConfig & { perPage: number; exclude: string[] };

export async function getSearchSettings(): Promise<SearchSettings> {
  return {
    enabled: (await getSetting<boolean>("search.enabled")) !== false,
    placement: normalizePlacement(await getSetting("search.placement")),
    perPage: normalizePerPage(await getSetting("search.perPage")),
    exclude: normalizeExclude(await getSetting("search.exclude")),
  };
}
