// TEST MULTI-LECTEURS des éléments de page d'overlay (docs/OVERLAY-ELEMENTS.md, section « Plusieurs lecteurs »). API publique du kit de test.
//
// Un même élément peut figurer dans plusieurs pages d'overlay : plusieurs lecteurs lisent alors le MÊME flux d'événements au même moment. Chaque lecteur doit avoir
// SON repère (un curseur à lui) : jamais une file partagée que le premier lecteur viderait. Ce test le vérifie pour VOTRE flux, en trois gestes à fournir :
//
//   import { assertMultiReaders } from "<dossier du cœur>/testsupport/index.mjs";
//   await assertMultiReaders({
//     publish: (event) => publishEvent(ctx, event),                    // ajoute un événement au flux
//     open: async () => { let cursor = (await readFeed(ctx, "now")).cursor; return { read: async () => { const r = await readFeed(ctx, cursor); cursor = r.cursor; return r.events; } }; },
//   });
//
// `open()` crée un lecteur neuf, dont le repère est pris TOUT DE SUITE à la fin du flux ; `read()` rend les événements arrivés depuis SA dernière lecture. Rien d'autre n'est supposé de votre module.
import assert from "node:assert/strict";

const keyOf = (e) => (typeof e === "string" ? e : typeof e?.text === "string" ? e.text : JSON.stringify(e));

/**
 * @param {object} a
 * @param {(event: string) => Promise<void>} a.publish ajoute un événement (une chaîne) au flux
 * @param {() => Promise<{ read: () => Promise<unknown[]> }>} a.open crée un lecteur neuf, à la fin du flux
 * @param {number} [a.readers] nombre de lecteurs simultanés (3 par défaut, 2 à 10)
 * @param {(event: unknown) => string} [a.keyOf] comment reconnaître un événement lu (par défaut : la chaîne, ou son champ `text`)
 */
export async function assertMultiReaders({ publish, open, readers = 3, keyOf: key = keyOf }) {
  const n = Math.min(10, Math.max(2, Math.trunc(readers)));
  const all = Array.from({ length: 6 }, (_, i) => `evt-${i + 1}`);
  const readers_ = [];
  for (let i = 0; i < n; i++) readers_.push(await open());
  const seen = readers_.map(() => []);
  const drain = async (i, label) => {
    const got = (await readers_[i].read()).map(key);
    seen[i].push(...got);
    return got;
  };

  // 1. Deux événements arrivent ; le PREMIER lecteur lit tout. Les autres doivent encore tout recevoir (rien n'a été volé).
  await publish(all[0]); await publish(all[1]);
  assert.deepEqual(await drain(0), all.slice(0, 2), "le premier lecteur doit recevoir les événements publiés");
  for (let i = 1; i < n; i++) assert.deepEqual(await drain(i), all.slice(0, 2), `le lecteur ${i + 1} n'a pas reçu les événements déjà lus par le lecteur 1 : le flux est partagé et se vide à la lecture (chaque lecteur doit avoir son propre repère)`);

  // 2. Relire sans nouvel événement ne rend rien (et ne dérègle personne).
  for (let i = 0; i < n; i++) assert.deepEqual(await drain(i), [], `le lecteur ${i + 1} reçoit encore des événements alors qu'il n'y en a pas de nouveau`);

  // 3. Lectures entrelacées : chacun, dans un ordre différent, avec des lectures en même temps.
  await publish(all[2]);
  const together = await Promise.all(readers_.map((r) => r.read().then((e) => e.map(key))));
  together.forEach((got, i) => { seen[i].push(...got); assert.deepEqual(got, [all[2]], `lecture simultanée : le lecteur ${i + 1} devait recevoir exactement ${all[2]}`); });
  await publish(all[3]); await publish(all[4]);
  for (let i = n - 1; i >= 0; i--) assert.deepEqual(await drain(i), all.slice(3, 5), `lecture en ordre inverse : le lecteur ${i + 1} devait recevoir ${all.slice(3, 5).join(", ")}`);

  // 4. Un lecteur qui s'ouvre plus tard n'empêche personne de lire, et les autres ne perdent rien.
  const late = await open();
  await publish(all[5]);
  const lateGot = (await late.read()).map(key);
  assert.deepEqual(lateGot, [all[5]], "un lecteur ouvert en cours de route doit commencer à la fin du flux et recevoir la suite");
  for (let i = 0; i < n; i++) { await drain(i); assert.deepEqual(seen[i], all, `le lecteur ${i + 1} doit avoir reçu tous les événements, dans l'ordre, une seule fois`); }
}
