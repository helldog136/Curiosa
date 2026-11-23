/**
 * One submit at a time for a form whose action creates something that is shown only once (an access secret).
 *
 * `enter()` returns false while a previous submit is still running: the second one is ignored (double click, Enter pressed twice, an extension that
 * re-dispatches the `submit` event). It is a plain object, not React state, because `pending` only changes after the next render: two submits can
 * arrive before it does. `wrap(action)` releases the gate when the action ends, even when it throws.
 */
export type Gate = { enter(): boolean; busy(): boolean; wrap<A extends unknown[], R>(action: (...args: A) => Promise<R>): (...args: A) => Promise<R> };

export function createGate(): Gate {
  let busy = false;
  return {
    enter() { if (busy) return false; busy = true; return true; },
    busy: () => busy,
    wrap(action) { return async (...args) => { try { return await action(...args); } finally { busy = false; } }; },
  };
}
