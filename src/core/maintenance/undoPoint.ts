import { deleteSetting, getSetting, setSetting } from "@/core/settings";

/**
 * The restore point of the last change an AI made to the menu or to the home page: the PREVIOUS state, who changed it and when, and a fingerprint of the
 * state that change produced. The admin offers "Restore the previous menu / home page" only while the current state still has that fingerprint (nobody
 * edited it since), so a restore can never wipe a person's later work. One point per target: a newer change replaces it. Stored as a core setting
 * (no migration). Content: the structure of the menu or of the home page only, never a secret.
 */
export type UndoTarget = "navigation" | "home";
export type UndoPoint = { at: number; by: string; previous: unknown; applied: string };

const KEY: Record<UndoTarget, string> = { navigation: "mcp.undo.navigation", home: "mcp.undo.home" };

export const fingerprintOf = (value: unknown): string => JSON.stringify(value);

export async function saveUndoPoint(target: UndoTarget, point: UndoPoint): Promise<void> { await setSetting(KEY[target], point); }
export async function clearUndoPoint(target: UndoTarget): Promise<void> { await deleteSetting(KEY[target]); }

export async function loadUndoPoint(target: UndoTarget): Promise<UndoPoint | null> {
  const v = await getSetting<Partial<UndoPoint>>(KEY[target]);
  return v && typeof v === "object" && typeof v.at === "number" && typeof v.by === "string" && typeof v.applied === "string" && "previous" in v ? (v as UndoPoint) : null;
}
