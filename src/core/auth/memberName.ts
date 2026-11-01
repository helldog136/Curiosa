/** Le nom affiché d'une personne ajoutée sans nom : le début de son e-mail, mis en forme (« camille.martin@exemple.org » devient « Camille Martin »). Logique pure. */
export function nameFromEmail(email: string): string {
  const local = String(email ?? "").split("@")[0] ?? "";
  return local.split(/[._\-+]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").slice(0, 80) || local;
}
