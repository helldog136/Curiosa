import type { AccessProfile } from "./profiles";

/** Translation keys of the plain lines that say what a profile allows (3 to 5 per profile): one list, used by the setup step and the rights page. */
export const PROFILE_LINES: Record<AccessProfile, readonly string[]> = {
  read: ["ai.profile.read.l1", "ai.profile.read.l2", "ai.profile.read.l3"],
  assistant: ["ai.profile.assistant.l1", "ai.profile.assistant.l2", "ai.profile.assistant.l3", "ai.profile.assistant.l4"],
  full: ["ai.profile.full.l1", "ai.profile.full.l2", "ai.profile.full.l3", "ai.profile.full.l4"],
};
export const profileLines = (p: AccessProfile): readonly string[] => PROFILE_LINES[p];
