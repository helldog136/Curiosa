/**
 * Waits for a piece of work for a limited time. The work itself is NOT cancelled when the time is over (a network read cannot be taken back politely):
 * it goes on in the background and whatever it caches stays cached. A failure is reported, never thrown.
 */
export type Within<T> = { ok: true; value: T } | { ok: false; reason: "timeout" | "error"; error?: unknown };

export async function within<T>(ms: number, work: () => Promise<T>): Promise<Within<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), Math.max(0, ms)); });
  const running = work().then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, reason: "error" as const, error }));
  try {
    const first = await Promise.race([running, timeout]);
    return first === "timeout" ? { ok: false, reason: "timeout" } : first;
  } finally { clearTimeout(timer); }
}
