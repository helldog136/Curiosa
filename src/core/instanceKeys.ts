/**
 * The settings an instance keeps about itself live in the `Setting` table under `instance.<id>.<name>`. This leaf module (no imports) is the ONE place that spells
 * those keys: the book-keeping names the core writes itself (`__seenFeatures`, `__dataVersion`, `__dataStatus`) are built here and nowhere else
 * (tests/core/instance-keys-single-source.test.mjs scans the sources for raw copies).
 */

/** `instance.<id>.` : the start of every setting key of one instance. */
export const instanceKeyPrefix = (instanceId: string): string => `instance.${instanceId}.`;

/** The full setting key `instance.<id>.<key>`. */
export const instanceSettingKey = (instanceId: string, key: string): string => `${instanceKeyPrefix(instanceId)}${key}`;

/** A `where` that selects every setting of one instance. */
export const instanceSettingsWhere = (instanceId: string): { key: { startsWith: string } } => ({ key: { startsWith: instanceKeyPrefix(instanceId) } });

/** The names (after `instance.<id>.`) of the book-keeping settings, for readers that work on keys already stripped of their prefix. */
export const SEEN_FEATURES_NAME = "__seenFeatures";
export const DATA_VERSION_NAME = "__dataVersion";
export const DATA_STATUS_NAME = "__dataStatus";

/** The content features of the manifest the instance has already adopted (see modules/instanceFeatures.ts). */
export const seenFeaturesKey = (instanceId: string): string => instanceSettingKey(instanceId, SEEN_FEATURES_NAME);
/** The version of the data of the instance (absent = 1, see modules/dataMigrations.ts). */
export const dataVersionKey = (instanceId: string): string => instanceSettingKey(instanceId, DATA_VERSION_NAME);
/** The "set aside" status of an instance whose data migration failed (see modules/dataMigrations.ts). */
export const dataStatusKey = (instanceId: string): string => instanceSettingKey(instanceId, DATA_STATUS_NAME);
