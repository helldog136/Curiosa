// D'où vient la page : une adresse publique (téléchargée avec prudence), un fichier HTML enregistré depuis le navigateur, un fichier JSON, ou une fiche déjà produite.
import fs from "node:fs";
import path from "node:path";
import { fetchPage } from "./fetch.mjs";
import { importError } from "./urls.mjs";
import { PROFILE_KIND } from "./model.mjs";

export const MAX_FILE = 5 * 1024 * 1024;

/** → { kind: "page", url, html, json, finalUrl, redirects } ou { kind: "profile", profile } */
export async function readSource(input, { url: hintUrl } = {}) {
  const arg = String(input ?? "").trim();
  if (!arg) throw importError("no-input", "indiquez l'adresse de la page de liens (ou un fichier enregistré)");
  if (/^file:/i.test(arg)) throw importError("bad-scheme", "les adresses file: sont refusées : donnez le chemin du fichier tel quel");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg) && !/^https?:\/\//i.test(arg)) throw importError("bad-scheme", `seules les adresses http(s) sont acceptées (reçu : ${arg.split(":")[0]})`);
  if (/^https?:\/\//i.test(arg)) {
    const r = await fetchPage(arg);
    return { kind: "page", input: arg, url: r.url, html: /json/.test(r.contentType) ? "" : r.text, json: /json/.test(r.contentType) ? safeJson(r.text) : undefined, redirects: r.redirects };
  }
  if (fs.existsSync(arg)) {
    const stat = fs.statSync(arg);
    if (!stat.isFile()) throw importError("bad-file", `${arg} n'est pas un fichier`);
    if (stat.size > MAX_FILE) throw importError("too-large", `fichier trop volumineux (${Math.round(stat.size / 1024 / 1024)} Mo, 5 Mo au plus)`);
    const text = fs.readFileSync(arg, "utf8");
    const isJson = /\.json$/i.test(arg) || /^\s*[[{]/.test(text);
    const json = isJson ? safeJson(text) : undefined;
    if (json?.kind === PROFILE_KIND) return { kind: "profile", input: path.resolve(arg), profile: json };
    if (isJson && json === undefined) throw importError("bad-json", "ce fichier JSON est illisible");
    return { kind: "page", input: path.resolve(arg), url: hintUrl ?? "", html: isJson ? "" : text, json, redirects: [] };
  }
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(arg)) return readSource(`https://${arg}`, { url: hintUrl }); // « linktr.ee/nom » sans https://
  throw importError("not-found", `« ${arg.slice(0, 80)} » n'est ni une adresse web ni un fichier existant`);
}
const safeJson = (t) => { try { return JSON.parse(t); } catch { return undefined; } };
