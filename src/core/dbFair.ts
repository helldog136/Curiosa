/**
 * One SQLite connection, used fairly — what Prisma 6 gave the site and what better-sqlite3 alone does not.
 *
 * better-sqlite3 runs every query synchronously on the main thread, on ONE connection. Two consequences once Prisma 7 talks to it:
 *  1. a long series of queries (a restore, a large import) never lets the event loop breathe: timers, overlays and other visitors wait for the end
 *     (Prisma 6 ran queries on its own threads). Here every query is followed by one turn of the event loop (setImmediate).
 *  2. once the loop breathes, a query of another visitor could run in the middle of an open transaction, on the same connection: it would join that
 *     transaction and be undone with it. Here queries and transactions take turns: a transaction holds the connection from BEGIN to COMMIT or ROLLBACK,
 *     and every other query waits for it — exactly what Prisma 6 did with one connection (`connection_limit=1`, the setting of the test suite).
 * The queries inside a transaction go through untouched (they already hold the connection). tests/core/db-fair.test.mjs.
 */

type Query = unknown;
type Queryable = { queryRaw(q: Query): Promise<unknown>; executeRaw(q: Query): Promise<unknown> };
type Tx = Queryable & { commit(): Promise<void>; rollback(): Promise<void> } & Record<string, unknown>;
type Adapter = Queryable & { executeScript(s: string): Promise<void>; startTransaction(level?: unknown): Promise<Tx> } & Record<string, unknown>;
type Factory = { provider: string; adapterName: string; connect(): Promise<Adapter> } & Record<string, unknown>;

const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A first-come, first-served lock: `acquire()` resolves with the function that releases it. */
export function turnLock() {
  let tail: Promise<void> = Promise.resolve();
  return {
    acquire(): Promise<() => void> {
      let release!: () => void;
      const mine = new Promise<void>((resolve) => { release = resolve; });
      const before = tail;
      tail = before.then(() => mine);
      return before.then(() => { let done = false; return () => { if (!done) { done = true; release(); } }; });
    },
  };
}

function fairTransaction(tx: Tx, release: () => void): Tx {
  return new Proxy(tx, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "queryRaw" || key === "executeRaw") return async (q: Query) => { try { return await (value as (q: Query) => Promise<unknown>).call(target, q); } finally { await breathe(); } };
      if (key === "commit" || key === "rollback") return async () => { try { return await (value as () => Promise<void>).call(target); } finally { release(); } };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function fairAdapter(adapter: Adapter): Adapter {
  const lock = turnLock();
  const inTurn = async <T>(work: () => Promise<T>): Promise<T> => {
    const release = await lock.acquire();
    try { return await work(); } finally { release(); await breathe(); }
  };
  return new Proxy(adapter, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "queryRaw" || key === "executeRaw" || key === "executeScript") return (arg: Query) => inTurn(() => (value as (a: Query) => Promise<unknown>).call(target, arg));
      if (key === "startTransaction") {
        return async (level?: unknown) => {
          const release = await lock.acquire();
          try { return fairTransaction(await (value as (l?: unknown) => Promise<Tx>).call(target, level), release); } catch (e) { release(); throw e; }
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The factory Prisma receives: the same driver, connected through `fairAdapter`. */
export function fairFactory<F extends Factory>(factory: F): F {
  return new Proxy(factory, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "connect") return async () => fairAdapter(await (value as () => Promise<Adapter>).call(target));
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
