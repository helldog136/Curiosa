import { prisma } from "@/core/db";
import { hostProblem } from "@/core/url";

/**
 * TRUSTED IMAGE SOURCES: the only places `media_import` may download an image from (see mediaImport.ts, trustedImageFetch.ts).
 *
 * The OWNER writes this list in Admin > AI assistants. It starts EMPTY, which means the feature is off. No MCP tool reads it for writing,
 * and none writes it: an assistant can never add an entry (a test walks the whole tool catalogue to keep it that way).
 *
 * An entry is a host (exact, lower case, no wildcard, never an IP number), an optional port (443 when absent) and a path prefix that always
 * starts and ends with "/" ("/" alone = the whole host). A web address matches an entry when the host is the same text, the port is the same
 * and the path starts with the prefix, whole segments only ("/etoile_nord/" does not match "/etoile_nord2/x.png").
 */
export const TRUSTED_SOURCES_KEY = "mcp.trustedImageSources";
export const MAX_SOURCES = 30;
export const PRESET_SOURCE: TrustedSource = { host: "raw.githubusercontent.com", path: "/helldog136/" };

export type TrustedSource = { host: string; port?: number; path: string };
export type SourceProblem = "empty" | "scheme" | "invalid" | "host" | "port" | "path" | "duplicate" | "full";
export type ParsedSource = { ok: true; source: TrustedSource } | { ok: false; problem: SourceProblem };

const SEGMENT = /^[A-Za-z0-9._~+=,-]{1,100}$/;

/** What the owner typed ("images.example.org/screens/", "https://images.example.org:8443/") → an entry, or the reason it is refused. */
export function parseSource(input: string): ParsedSource {
  let text = String(input ?? "").trim();
  if (!text) return { ok: false, problem: "empty" };
  if (text.length > 200 || /[\s\\*?#%@\u0000-\u001f\u007f]/.test(text)) return { ok: false, problem: "invalid" };
  if (/^https:\/\//i.test(text)) text = text.slice(8);
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return { ok: false, problem: "scheme" };
  const slash = text.indexOf("/");
  const authority = (slash === -1 ? text : text.slice(0, slash)).toLowerCase();
  const rest = slash === -1 ? "" : text.slice(slash);
  const m = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!m) return { ok: false, problem: "host" };
  const host = m[1]!;
  let url: URL;
  try { url = new URL(`https://${host}/`); } catch { return { ok: false, problem: "host" }; }
  if (url.hostname !== host || host.endsWith(".") || host.startsWith(".") || host.includes("..") || hostProblem(url) !== null) return { ok: false, problem: "host" };
  let port: number | undefined;
  if (m[2] !== undefined) {
    port = Number(m[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, problem: "port" };
    if (port === 443) port = undefined;
  }
  const segments = rest.split("/").filter((s, i, all) => !(s === "" && (i === 0 || i === all.length - 1)));
  if (segments.some((s) => !SEGMENT.test(s) || s === "." || s === "..")) return { ok: false, problem: "path" };
  const path = segments.length ? `/${segments.join("/")}/` : "/";
  return { ok: true, source: { host, ...(port ? { port } : {}), path } };
}

const same = (a: TrustedSource, b: TrustedSource) => a.host === b.host && (a.port ?? 443) === (b.port ?? 443) && a.path === b.path;

/** The text the owner sees and types: host, port if not the default, path prefix. */
export const sourceLabel = (s: TrustedSource): string => `${s.host}${s.port ? `:${s.port}` : ""}${s.path}`;

/** The saved list, always read from the database (a deletion takes effect at once), cleaned: an unreadable entry is dropped, never trusted. */
export async function listTrustedSources(): Promise<TrustedSource[]> {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key: TRUSTED_SOURCES_KEY, locale: "" } } });
  if (!row) return [];
  let raw: unknown;
  try { raw = JSON.parse(row.value); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: TrustedSource[] = [];
  for (const x of raw.slice(0, MAX_SOURCES)) {
    if (!x || typeof x !== "object") continue;
    const e = x as Record<string, unknown>;
    const parsed = parseSource(`${String(e.host ?? "")}${e.port ? `:${String(e.port)}` : ""}${String(e.path ?? "/")}`);
    if (parsed.ok && !out.some((o) => same(o, parsed.source))) out.push(parsed.source);
  }
  return out;
}

async function save(list: TrustedSource[]): Promise<void> {
  const value = JSON.stringify(list);
  await prisma.setting.upsert({ where: { key_locale: { key: TRUSTED_SOURCES_KEY, locale: "" } }, create: { key: TRUSTED_SOURCES_KEY, locale: "", value }, update: { value } });
}

/** Adds an entry (owner only: the caller checked the right). */
export async function addTrustedSource(source: TrustedSource): Promise<{ ok: true; list: TrustedSource[] } | { ok: false; problem: "duplicate" | "full" }> {
  const list = await listTrustedSources();
  if (list.some((s) => same(s, source))) return { ok: false, problem: "duplicate" };
  if (list.length >= MAX_SOURCES) return { ok: false, problem: "full" };
  list.push(source);
  await save(list);
  return { ok: true, list };
}

/** Removes an entry given as its label; true when something was removed. */
export async function removeTrustedSource(label: string): Promise<TrustedSource | null> {
  const list = await listTrustedSources();
  const found = list.find((s) => sourceLabel(s) === label);
  if (!found) return null;
  await save(list.filter((s) => s !== found));
  return found;
}

/** Does this address fall under an entry? Host and port exactly, path by whole segments. The caller already refused credentials and other schemes. */
export function matchSource(url: URL, sources: readonly TrustedSource[]): TrustedSource | null {
  const port = url.port ? Number(url.port) : url.protocol === "http:" ? 80 : 443;
  const path = url.pathname;
  if (/%2f|%5c|\\/i.test(path)) return null; // an encoded slash could be read differently by the server than by us
  return sources.find((s) => s.host === url.hostname && (s.port ?? 443) === port && path.startsWith(s.path)) ?? null;
}
