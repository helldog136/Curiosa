// Which versions must a site pass through to reach a target, and what to run for each? A thin wrapper over planUpdate (scripts/shared-lib.mjs):
// the host-side install script asks the container for the plan, so no second implementation exists in bash.
//
//   node scripts/update-plan.mjs --json [--from 0.6.10] [--to v0.7.0 | latest] [--repo owner/name]
//
// --from defaults to the version of this install, --to to the latest stable release, --repo to CURIOSA_UPDATE_REPO, release.json, then the official repository.
// JSON output: { ok, from, to, steps: ["v0.6.10","v0.7.0"], tags: ["0.6.10","0.7.0"], commands: [...], image }. Exit code 1 with { ok:false, error } on failure.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_REPO, dockerCommands, IMAGE_NAME, imageTag } from "./install-kind.mjs";
import { compareVersions, fetchTextHttps, planUpdate } from "./shared-lib.mjs";

const REPO_RE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const STABLE_RE = /^v\d+\.\d+\.\d+$/;
const VERSION_RE = /^v?\d+\.\d+\.\d+$/;

/** Latest STABLE tag of the repository (GitHub's "latest release" is never a pre-release or a draft). */
export async function latestStableTag(repo, fetchJson) {
  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
  const tag = release?.tag_name;
  if (typeof tag !== "string" || !STABLE_RE.test(tag) || release.draft === true || release.prerelease === true) throw new Error("no stable release found");
  return tag;
}

/**
 * @param {{ from: string, to?: string, repo: string, fetchText: (url: string) => Promise<string | null>, fetchJson?: (url: string) => Promise<any> }} o
 */
export async function buildPlan({ from, to = "latest", repo, fetchText, fetchJson }) {
  if (!VERSION_RE.test(String(from))) return { ok: false, error: "invalid-from" };
  if (!REPO_RE.test(String(repo))) return { ok: false, error: "invalid-repo" };
  let target = to;
  try {
    if (to === "latest") target = await latestStableTag(repo, fetchJson);
    if (!VERSION_RE.test(String(target))) return { ok: false, error: "invalid-target" };
    target = String(target).startsWith("v") ? String(target) : `v${target}`;
    if (compareVersions(from, target) >= 0) return { ok: true, from: String(from).replace(/^v/, ""), to: target.slice(1), steps: [], tags: [], commands: [], image: IMAGE_NAME, upToDate: true };
    const steps = await planUpdate({ current: String(from).replace(/^v/, ""), target, repo, fetchText });
    const tags = steps.map(imageTag);
    return { ok: true, from: String(from).replace(/^v/, ""), to: target.slice(1), steps, tags, commands: dockerCommands(tags), image: IMAGE_NAME, upToDate: false };
  } catch (e) {
    return { ok: false, error: "plan-failed", detail: String(e?.message ?? e).slice(0, 200) };
  }
}

function readVersionHere(appDir) {
  for (const f of ["release.json", "package.json"]) {
    try { const v = JSON.parse(fs.readFileSync(path.join(appDir, f), "utf8")).version; if (typeof v === "string") return v; } catch { /* next */ }
  }
  return null;
}

const arg = (argv, name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

export async function main(argv, { appDir = process.cwd(), env = process.env, out = (s) => process.stdout.write(s), fetchText = fetchTextHttps, fetchJson } = {}) {
  let release = null;
  try { release = JSON.parse(fs.readFileSync(path.join(appDir, "release.json"), "utf8")); } catch { /* not an archive install */ }
  const getJson = fetchJson ?? (async (url) => { const r = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "curiosa-updater" }, signal: AbortSignal.timeout(15_000) }); if (!r.ok) throw new Error(`http ${r.status}`); return r.json(); });
  const plan = await buildPlan({
    from: arg(argv, "--from") ?? readVersionHere(appDir) ?? "",
    to: arg(argv, "--to") ?? "latest",
    repo: arg(argv, "--repo") ?? (REPO_RE.test(env.CURIOSA_UPDATE_REPO ?? "") ? env.CURIOSA_UPDATE_REPO : REPO_RE.test(release?.repo ?? "") ? release.repo : DEFAULT_REPO),
    fetchText, fetchJson: getJson,
  });
  if (argv.includes("--json")) out(JSON.stringify(plan) + "\n");
  else if (!plan.ok) out(`Cannot compute the steps (${plan.error}).\n`);
  else if (plan.upToDate) out(`Already on ${plan.from}: nothing to do.\n`);
  else out(plan.commands.map((c, i) => `${plan.commands.length > 1 ? `${i + 1}. ` : ""}${c}`).join("\n") + "\n");
  return plan.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));
