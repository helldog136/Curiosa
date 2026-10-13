// Carrd (<nom>.carrd.co ou domaine personnel) : page statique. Le titre est un <h1 id="title01">, le texte un <p id="text01">, la photo un <div id="image01"><img>,
// les boutons une liste <ul class="buttons"> (<a class="button">), les réseaux une liste <ul class="icons"> dont chaque lien porte un <span class="label">.
// Les intertitres (h2/h3) ouvrent des sections. Une page Carrd n'est pas forcément une page de liens : on dit ce qu'on y a trouvé, sans rien inventer.
import { find, hasClass, isInside, textOf } from "../html.mjs";
import { readDom } from "./shared.mjs";

const inList = (a, cls) => isInside(a, (p) => p.tag === "ul" && hasClass(p, cls));

const adapter = {
  id: "carrd", name: "Carrd", hosts: ["carrd.co"],
  detect: (page) => /carrd\.co/i.test(page.html.slice(0, 300_000)) || (/class="[^"]*\bbuttons\b/.test(page.html) && /class="[^"]*\bicons\b/.test(page.html) && /id="(wrapper|main|container01)"/.test(page.html)),
  extract(page) {
    const r = readDom(page, {
      root: (n) => n.attrs.id === "main" || n.attrs.id === "wrapper",
      name: (pg) => { const h = find(pg.doc, (n) => /^title\d+$/.test(n.attrs.id ?? "") || (n.tag === "h1")); return h ? textOf(h) : ""; },
      bio: (pg) => { const p = find(pg.doc, (n) => /^text\d+$/.test(n.attrs.id ?? "")); return p ? textOf(p) : ""; },
      avatar: (pg) => { const box = find(pg.doc, (n) => /^image\d+$/.test(n.attrs.id ?? "")); const img = box && find(box, (n) => n.tag === "img"); return img?.attrs.src ?? ""; },
      isSocial: (a) => inList(a, "icons"),
      isLink: (a) => inList(a, "buttons") || hasClass(a, "button"),
      titleOf: (a) => { const label = find(a, (n) => hasClass(n, "label")); return label ? textOf(label) : textOf(a) || a.attrs["aria-label"] || a.attrs.title || ""; },
    });
    const notes = r.links.length ? [] : ["aucun bouton (<ul class=\"buttons\">) trouvé sur cette page Carrd"];
    return { ...r, notes };
  },
};

export default adapter;
