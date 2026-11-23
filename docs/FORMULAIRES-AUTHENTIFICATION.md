# Authentication forms and password managers

Rules for every form that asks for, creates or changes a password or a one-time code: login, setup, password change, choice of the first password, two-step verification, passkeys, backup. They complete [ERGONOMIE-ADMIN.md](ERGONOMIE-ADMIN.md) (R22: error under the field; R28: linked labels, keyboard). Tests keep them: `tests/core/password-managers.test.mjs` and `tests/core/admin-input-hints.test.mjs`.

Why: a password manager (1Password, Bitwarden, Dashlane, Chrome, Safari) does not "read" the page like a person. It looks, inside **one `<form>`**, for a login and a password, found through `autocomplete`, then listens to the form submit. Anything that blurs this detection makes it give up, silently.

## The rules

1. **A real `<form method="post">`**, with a submit button (`type="submit"`). Submitting by script (`onSubmit` + server action) is fine; a form without `method` goes out as GET and would put the password in the address if the script is not loaded.
2. **The login is in the same form, before the password**: `<input type="email" autocomplete="username">` when the person types it. When the form only asks for the password (change your own, choose one, confirm who you are), add `<UsernameHint value={email} />`: a pre-filled `autocomplete="username"` field, invisible on screen, out of the tab order. Without it the manager does not know which record to update. No `display:none` and no `type="hidden"`: some managers ignore them.
3. **`autocomplete` everywhere, never `off` on a password.**

   | Field | `autocomplete` |
   |---|---|
   | e-mail or login name | `username` |
   | login password, or to confirm who you are | `current-password` |
   | create or change a password, and its confirmation | `new-password` (both fields) |
   | code of the authenticator app or a backup code | `one-time-code` |
   | setup code (a code that is copied over, not a password) | `one-time-code`, as `type="text"` |

   `autocomplete="off"` is ignored by Chrome on a password and loses 1Password. A second `type="password"` field without `new-password` is taken for a confirmation.
4. **One component for the password: `PasswordInput`** (or `TextField type="password"`, which uses it). The "Show" button is a real `<button type="button">` that changes the `type` attribute of the **same** `<input>`: the node is never replaced. `clearSecrets` also empties the field that is still displayed after an error.
5. **Block nothing**: no `onPaste`, no `onCopy`, no `onDrop`, no `readOnly` on a password.
6. **Fields are not recreated** while typing: no `key` that changes at each keystroke. The setup wizard mounts the "access" section (e-mail, password, confirmation) at once at the last step, in the same form as the rest; the e-mail is kept when going back, the password never.
7. **Complexity rules said twice**: in one sentence under the field ("10 characters minimum"), and to the machine through `passwordMin` (the `passwordrules` attribute, read by Safari). No native `minlength`: its browser bubble contradicts R22; the error is written under the field, with an example.
8. **Linked labels**: `<label for>` + `id` (or `aria-label` for a field with no visible label). The "Show" button stays outside the `<label>` (otherwise it enters the field name).
9. **Error under the field**, focus on the first field in error (`errors: { field: message }` in the action, see `core/fieldErrors.ts`). After an error, the e-mail stays and the passwords are emptied.

## Do not offer a password that is not the account's own

`noManager` (on `PasswordInput` or `TextField`) sets `data-1p-ignore`, `data-lpignore`, `data-bwignore`. Keep it for:
- a password given to **another person** (the temporary password, `TemporaryPasswordButton`; the first password in the invitation form of the Team page): otherwise the manager offers to replace mine;
- a **technical secret** (a service key: a module `secret` setting, the password of the mail server).

Everywhere else these attributes are **forbidden on a password field** (the test checks it). `TextField` used to set them on every `new-password` field: 1Password then offered nothing when choosing the first password or changing it.

## Fields that are not credentials

A text input that is not a login (a name, a label, a nickname, an address, a URL, free text, a search box) must not be taken for an e-mail, a user name or a password to fill or to save. Every such input of the administration carries `autoComplete="off"` **and** the hints of the managers: `{...PLAIN_INPUT}` (`src/components/admin/managerHints.ts`: `data-1p-ignore`, `data-lpignore`, `data-bwignore`, `data-form-type="other"`).

- `TextField` does it by default. A credential token (`username`, `email`, `name`, `current-password`, `new-password`, `one-time-code`, `webauthn`) given to `autoComplete` keeps autofill and gets no hints; anything else (nothing, `off`, another value) becomes a plain input.
- A raw `<input>` spreads `{...PLAIN_INPUT}`, or carries the credential token it really needs. `tests/core/admin-input-hints.test.mjs` reads `src/app/admin` and `src/components/admin` and fails on a new raw text-like input with neither: there is no list of accepted offenders.
- A form that creates something with a result shown once (the access creator) also carries the hints on its `<form>`, and names its label field after what it is (`accessLabel`), never `name`, `email` or `username`.
- A form whose result is shown once ignores a second submit while the first runs (`createGate`, `src/components/admin/singleFlight.ts`), so one click or an extension re-sending the event cannot create two accesses and hide the first secret.

Limits: the hints and `autocomplete="off"` are honoured by 1Password, Bitwarden and LastPass on inputs; a manager may still show its own menu on a page that has a real login or sign-up form. A test reads the source and the rendered markup; it does not replace the real extension, which the owner confirms on the real site.
