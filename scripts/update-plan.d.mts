export function latestStableTag(repo: string, fetchJson: (url: string) => Promise<any>): Promise<string>;
export function buildPlan(o: { from: string; to?: string; repo: string; fetchText: (url: string) => Promise<string | null>; fetchJson?: (url: string) => Promise<any> }): Promise<{ ok: boolean; error?: string; from?: string; to?: string; steps?: string[]; tags?: string[]; commands?: string[]; image?: string; upToDate?: boolean; detail?: string }>;
export function main(argv: string[], o?: object): Promise<number>;
