// Linktree (linktr.ee/<nom>) : page Next.js, tout est dans <script id="__NEXT_DATA__"> → props.pageProps.{account, links, socialLinks}.
// Liens : { type: "CLASSIC" | "HEADER" | "GROUP"…, title, url, position, locked } ; un « HEADER » ouvre une section, un « GROUP » porte ses liens (links/children).
import { scanJson } from "../jsonScan.mjs";
import { readJson, readSocials } from "./shared.mjs";
import { extractIdentity } from "../domEngine.mjs";

const KEYS = { name: ["pageTitle", "displayName", "name", "username"], bio: ["description", "bio"], avatar: ["profilePictureUrl", "avatar", "profilePicture", "image"] };

const adapter = {
  id: "linktree", name: "Linktree", hosts: ["linktr.ee", "linktree.com"],
  detect: (page) => { const pp = page.nextData()?.props?.pageProps; return !!(pp && (pp.account || pp.socialLinks) && (Array.isArray(pp.links) || Array.isArray(pp.account?.links))) || /linktr\.ee\/s\/|<title>[^<]*\| Linktree/i.test(page.html); },
  extract(page) {
    const pp = page.nextData()?.props?.pageProps;
    if (!pp) return null;
    const account = pp.account ?? {};
    const list = Array.isArray(pp.links) ? pp.links : Array.isArray(account.links) ? account.links : null;
    const notes = [];
    let r;
    if (list) {
      const scan = scanJson(list);
      const id = readJson(account, KEYS);
      r = { name: id.name, description: id.description, avatar: id.avatar, links: scan.links, skipped: scan.skipped, socials: [...readSocials(account.socialLinks), ...readSocials(pp.socialLinks)] };
    } else {
      r = readJson(pp, KEYS);
      notes.push("forme inhabituelle des données Linktree : lecture générique du JSON de la page");
    }
    if (page.html && (!r.name || !r.avatar || !r.description)) { const d = extractIdentity(page); r = { ...r, name: r.name || d.name, description: r.description || d.description, avatar: r.avatar || d.avatar }; }
    return { ...r, notes };
  },
};

export default adapter;
