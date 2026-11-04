/** Pure logic of the rights page (no React): counters, profile preset, changes to save. Tested without a browser. */
export type GrantProfileId = "read" | "assistant" | "full";
const RANK: Record<GrantProfileId, number> = { read: 0, assistant: 1, full: 2 };

export type GrantTool = {
  name: string; label: string; code?: string; help?: string;
  kind: "read" | "write" | "destructive"; kindLabel: string;
  /** What is saved now (already counts the ceiling). */
  initial: boolean;
  /** Above the access ceiling (a read-only access cannot write) or cut off by the module: cannot be changed here. */
  blocked: boolean; locked: boolean;
  /** Lowest profile that allows it, or null when no profile does. */
  rank: GrantProfileId | null;
  /** An irreversible action asks for a confirmation when it is ticked one by one. */
  confirm?: string;
};
export type GrantSection = { id: string; group: string; title: string; help?: string; risky?: boolean; tools: GrantTool[]; header?: React.ReactNode };
export type Draft = Record<string, boolean>;

export const editable = (t: GrantTool) => !t.blocked && !t.locked;
export const initialDraft = (sections: GrantSection[]): Draft => Object.fromEntries(sections.flatMap((s) => s.tools.map((t) => [t.name, t.initial])));

export const countOn = (s: GrantSection, draft: Draft) => s.tools.filter((t) => draft[t.name]).length;

/** The preset a profile gives, over the tools that can be changed. */
export function presetDraft(profile: GrantProfileId, sections: GrantSection[], draft: Draft): { draft: Draft; blocked: number } {
  const next = { ...draft };
  let blocked = 0;
  for (const t of sections.flatMap((s) => s.tools)) {
    const wanted = t.rank !== null && RANK[t.rank] <= RANK[profile];
    if (t.blocked) { if (wanted) blocked++; continue; }
    if (!t.locked) next[t.name] = wanted;
  }
  return { draft: next, blocked };
}

/** The profile that exactly matches the current boxes, if any. */
export function matchingProfileOf(sections: GrantSection[], draft: Draft): GrantProfileId | null {
  const tools = sections.flatMap((s) => s.tools).filter(editable);
  return (["read", "assistant", "full"] as const).find((p) => tools.every((t) => !!draft[t.name] === (t.rank !== null && RANK[t.rank] <= RANK[p]))) ?? null;
}

/** Only what differs from what is saved. */
export function changesOf(sections: GrantSection[], draft: Draft, saved: Draft): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const t of sections.flatMap((s) => s.tools)) if (editable(t) && !!draft[t.name] !== !!saved[t.name]) out[t.name] = !!draft[t.name];
  return out;
}

export function setSection(section: GrantSection, draft: Draft, on: boolean): Draft {
  const next = { ...draft };
  for (const t of section.tools) if (editable(t)) next[t.name] = on;
  return next;
}
