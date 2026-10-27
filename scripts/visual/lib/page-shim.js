// Injecté AVANT tout script de la page : horloge figée et hasard déterministe côté navigateur (mêmes principes que preload.cjs).
(() => {
  const NOW = Date.parse("__NOW__");
  const RealDate = Date;
  window.Date = new Proxy(RealDate, {
    construct(t, a, nt) { return a.length === 0 ? new t(NOW) : Reflect.construct(t, a, nt === window.Date ? t : nt); },
    apply() { return new RealDate(NOW).toString(); },
    get(t, p, r) { return p === "now" ? () => NOW : Reflect.get(t, p, r); },
  });
  let a = 0x9e3779b9;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  Math.random = next;
  const fill = (arr) => { const u = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); for (let i = 0; i < u.length; i++) u[i] = Math.floor(next() * 256); return arr; };
  try { Object.defineProperty(crypto, "getRandomValues", { value: fill, configurable: true, writable: true }); } catch {}
  try { Object.defineProperty(crypto, "randomUUID", { value: () => "00000000-0000-4000-8000-" + String(Math.floor(next() * 1e12)).padStart(12, "0"), configurable: true, writable: true }); } catch {}
  // Le curseur clignotant et les animations sont aussi coupés en CSS (voir capture.mjs) ; ici : plus de défilement animé.
  try { Element.prototype.scrollTo = function (o, y) { typeof o === "object" ? (this.scrollLeft = o.left ?? this.scrollLeft, this.scrollTop = o.top ?? this.scrollTop) : (this.scrollLeft = o, this.scrollTop = y); }; } catch {}
})();
