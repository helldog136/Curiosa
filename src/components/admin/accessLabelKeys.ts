/** Keys of the texts the access-code parts need: the page passes them already translated (`labels`), so the same parts serve Appearance and Extensions.
 * A plain module on purpose: it is read by server code too, and an export of a "use client" file is only a client reference there, not the value. */
export const ACCESS_LABEL_KEYS = [
  "access.configured", "access.reenter", "access.reenter.why", "access.edit", "access.edit.title", "access.edit.save", "access.checking", "access.remove",
  "access.remove.confirm", "access.removing", "access.field.label", "access.field.example", "access.field.keep", "access.field.help", "modal.close",
] as const;
