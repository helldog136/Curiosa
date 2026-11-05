// Change counter of the Setting table, bumped by the database client after every write to it (see db.ts). The settings cache (settings.ts) is valid only
// for the generation it was read at, so a write made anywhere in this process is seen by the very next read.
let generation = 0;

export const settingsGeneration = (): number => generation;
export const bumpSettingsGeneration = (): void => { generation++; };

/** Operations of the Prisma Setting model that change rows. */
export const SETTING_WRITES: ReadonlySet<string> = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
