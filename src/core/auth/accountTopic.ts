import type { TopicField } from "../modules/types";
import { isSystemKey, levelOfRow, SYSTEM_ROLE_KEYS } from "./rights";

/**
 * Topic `core.user` (core 0.47.0): the people who can log in to the admin (the `User` accounts), told to the modules that DECLARE they consume it.
 *
 * This is the whole door. A module never gets the database: it reads this list through `ctx.api.topics.collect("core.user")` and receives, for each
 * account, ONLY the fields of `ACCOUNT_SCHEMA` below. The list is closed on purpose:
 *
 *   - the database is read with `ACCOUNT_SELECT`, which names every column read (an unlisted column, such as the password hash, is never loaded in memory);
 *   - `accountItem` builds the item field by field (never a spread of the row), so a column added to `User` later is NOT exposed;
 *   - `tests/core/account-topic.test.mjs` fails when a column is added to the `User` model without a decision (exposed here, or listed as hidden there).
 *
 * Never exposed: password hash, passkeys, recovery codes, double-verification secrets, session counters, trusted addresses, locks, sign-in addresses,
 * interface preferences, assistant access. See docs/MODULES.md, "Topic core.user".
 */
export const CORE_USER = "core.user";

/** The format of one item. `id` is the stable key of the account (it never changes and is never reused); everything else may change. */
export const ACCOUNT_SCHEMA: TopicField[] = [
  { key: "id", type: "string", required: true },
  { key: "name", type: "string", required: true },
  { key: "email", type: "string", required: true },
  /** The level of the account: `owner`, `coordinator`, `admin`, `editor` or `none` (a person who only has custom roles). Not translated: safe to compare. */
  { key: "level", type: "string" },
  /** Names of ALL the roles of the account, in the language asked for (the predefined ones are translated, a custom role has the name given by the owner). */
  { key: "roles", type: "string[]" },
  { key: "createdAt", type: "datetime" },
  { key: "updatedAt", type: "datetime" },
];

/** The columns read from the database, and nothing else. `roles` joins the role rows (key, name, system flag only). */
export const ACCOUNT_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  coordinator: true,
  createdAt: true,
  updatedAt: true,
  roles: { select: { role: { select: { key: true, name: true, system: true } } } },
} as const;

/** The shape `ACCOUNT_SELECT` returns. */
export type AccountRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  coordinator: boolean;
  createdAt: Date;
  updatedAt: Date;
  roles: { role: { key: string; name: string; system: boolean } }[];
};

const order = (key: string, system: boolean) => (system && isSystemKey(key) ? SYSTEM_ROLE_KEYS.indexOf(key) : 99);

/** One account as the modules see it: the fields of `ACCOUNT_SCHEMA`, built one by one. `systemName(key)`: the translated name of a predefined role. */
export function accountItem(row: AccountRow, systemName: (key: string) => string): Record<string, unknown> {
  const roles = [...(Array.isArray(row.roles) ? row.roles : [])]
    .map((r) => r.role)
    .sort((a, b) => order(a.key, a.system) - order(b.key, b.system) || a.name.localeCompare(b.name))
    .map((r) => (r.system ? systemName(r.key) : r.name));
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    level: levelOfRow(row),
    roles,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The accounts, oldest first (so a long list is cut at the newest, never at the owner). At most `limit`. Read from the database at each call: nothing is kept. */
export async function readAccounts({ locale, limit }: { locale: string; limit: number }): Promise<Record<string, unknown>[]> {
  const [{ prisma }, { makeTranslator }, { getSiteConfig }] = await Promise.all([import("../db"), import("../i18n/dictionary"), import("../settings")]);
  const config = await getSiteConfig();
  const t = makeTranslator(locale, config.defaultLocale);
  const rows = (await prisma.user.findMany({ select: ACCOUNT_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit })) as AccountRow[];
  return rows.map((row) => accountItem(row, (key) => t(`role.${key}`)));
}
