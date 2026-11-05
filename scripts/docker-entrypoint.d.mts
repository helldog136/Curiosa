export function resolveIds(env?: Record<string, string | undefined>): { uid: number; gid: number } | { error: string };
export function prepareDataDir(dataDir: string, ids: { uid: number; gid: number }, fsApi?: unknown): { changed: number };
export function notWritableMessage(dataDir: string, uid: number, gid: number): string;
export function dropPrivileges(ids: { uid: number; gid: number }, proc?: unknown): void;
export function main(o?: object): Promise<number>;
export function spawnServer(o: { appDir: string; env: Record<string, string | undefined> }): Promise<number>;
