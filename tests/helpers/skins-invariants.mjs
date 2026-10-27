// Invariants de sécurité d'une feuille de skin ASSAINIE (docs/SKINS.md §6, §15) : vérifiés par les tests d'attaques et le fuzz.
// Ils sont écrits INDÉPENDAMMENT de l'assainisseur : on relit la sortie avec PostCSS et on contrôle ce qu'un navigateur verrait.
import postcss from "postcss";

const AT_RULES = new Set(["media", "supports", "container", "keyframes", "font-face"]);
const FORBIDDEN_TEXT = [/@import/i, /expression\s*\(/i, /javascript:/i, /data:/i, /vbscript:/i, /behavior/i, /-moz-binding/i, /!\s*important/i, /<\s*\/?\s*(style|script)/i, /<[\/!a-z]/i, /\\/, /\u0000/, /\bhttps?:/i, /\/\//];
const SAFE_PROP = /^(--(sk|v)-[a-z0-9-]+|-?[a-z][a-z-]*)$/;
const URL_OK = /^url\((?:skin:(?:images|fonts)\/[a-z0-9._-]+|"\/skins\/[a-z0-9-]+\/[0-9A-Za-z.+-]+\/(?:images|fonts)\/[a-z0-9._-]+")\)$/;

/** Vérifie que `css` (sortie de l'assainisseur pour le skin `id`) ne contient rien d'interdit. Lève une AssertionError sinon. */
export function assertSafeOutput(assert, css, id, context = "") {
  const where = context ? ` [${context}]` : "";
  if (css === "") return;
  // les chaînes de `content` sont entièrement échappées en \HEX ; les urls servies sont normalisées avant la recherche
  const scan = css.replace(/"(?:\\[0-9a-f]+ |[A-Za-z0-9 _.,-])*"/g, '""').replace(/url\("\/skins\/[^"]*"\)/g, "url()");
  for (const re of FORBIDDEN_TEXT) assert.ok(!re.test(scan), `motif interdit ${re} dans la sortie${where}: ${css.slice(0, 300)}`);
  const root = postcss.parse(css);
  const prefix = `:root[data-skin="${id}"] `;
  root.walk((node) => {
    if (node.type === "atrule") {
      assert.ok(AT_RULES.has(node.name), `at-règle interdite @${node.name}${where}`);
      return;
    }
    if (node.type === "rule") {
      if (node.parent?.type === "atrule" && node.parent.name === "keyframes") {
        assert.match(node.selector, /^(from|to|\d{1,3}(\.\d+)?%)(,(from|to|\d{1,3}(\.\d+)?%))*$/, `image de keyframes${where}`);
        return;
      }
      const parts = node.selector.split(/,(?=:root\[data-skin=)/);
      for (const part of parts) {
        assert.ok(part.startsWith(prefix), `sélecteur sans préfixe : ${part}${where}`);
        const body = part.slice(prefix.length).replace(/"[^"]*"/g, '""').replace(/\|=/g, "=");
        assert.ok(!/[.#*&|\\]/.test(body), `classe, id ou joker dans ${part}${where}`);
        assert.ok(/\[data-skin-(region|part)=/.test(body), `aucune ancre dans ${part}${where}`);
        assert.ok(!/(^|[\s,>+~(])(html|body)(?![a-z-])/.test(body), `html/body dans ${part}${where}`);
        assert.ok(!/:root/.test(body), `:root dans ${part}${where}`);
      }
    }
    if (node.type === "decl") {
      assert.match(node.prop, SAFE_PROP, `propriété suspecte ${node.prop}${where}`);
      assert.ok(!node.important, `!important${where}`);
      for (const m of node.value.matchAll(/url\([^)]*\)/gi)) assert.match(m[0], URL_OK, `url() non conforme : ${m[0]}${where}`);
      assert.ok(!/\b(attr|expression|image-set|-webkit-image-set|element|paint|src|image|counter|counters)\(/i.test(node.value), `fonction interdite dans ${node.prop}: ${node.value}${where}`);
    }
  });
}
