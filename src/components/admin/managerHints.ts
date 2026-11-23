/**
 * Password managers and autofill (1Password, Bitwarden, Dashlane, LastPass, Chrome, Safari): what an admin text input says about itself.
 *
 * Rule (docs/FORMULAIRES-AUTHENTIFICATION.md, "Champs qui ne sont pas des identifiants"): a text-like input of the administration is a plain input
 * (a name, a label, an address, a search...) unless it is a real credential field. A plain input carries `autoComplete="off"` AND the "ignore me" hints
 * of the managers (`PLAIN_INPUT`), so none of them offers to fill it or to save what is typed. A credential field (login e-mail or user name, a password,
 * a one-time code, the owner's own name in the setup wizard) keeps its precise `autoComplete` token and never gets the hints.
 * `tests/core/admin-input-hints.test.mjs` fails on a raw text-like `<input>` that does neither.
 */

/** What the managers understand as "offer nothing here": 1Password, LastPass, Bitwarden, and the generic form-type hint (Dashlane and others). */
export const MANAGER_IGNORE = { "data-1p-ignore": true, "data-lpignore": "true", "data-bwignore": "true", "data-form-type": "other" } as const;

/** Spread on a plain input (name, label, address, search, free text): `<input {...PLAIN_INPUT} />`. */
export const PLAIN_INPUT = { autoComplete: "off", ...MANAGER_IGNORE } as const;

/** The `autocomplete` tokens that mark a deliberate credential or identity field. Anything else is a plain input. */
export const CREDENTIAL_TOKENS = ["username", "email", "name", "current-password", "new-password", "one-time-code", "webauthn"] as const;

/**
 * Attributes for an input whose `autoComplete` the caller may or may not have chosen: a credential token is kept as is (no hints),
 * anything else (absent, `off`, an unknown value) becomes a plain input.
 */
export function fieldHints(autoComplete?: string): { autoComplete?: string } {
  if (autoComplete && (CREDENTIAL_TOKENS as readonly string[]).includes(autoComplete)) return { autoComplete };
  return PLAIN_INPUT;
}
