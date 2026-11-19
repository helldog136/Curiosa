/**
 * THE ONE validator of a git reference (branch, tag or commit) that comes from outside the core (a repository address, a catalogue entry, an index).
 * A reference never starts with a dash (git would read it as an option), and the characters are the ones a tag, a branch or a commit can carry.
 */
export const GIT_REF_RE = /^(?!-)[\w./-]{1,100}$/;
export const isSafeGitRef = (ref: unknown): ref is string => typeof ref === "string" && GIT_REF_RE.test(ref);
