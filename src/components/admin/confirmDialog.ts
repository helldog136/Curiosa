/**
 * Demande de confirmation dans la page, à la place de `window.confirm`. Le navigateur supprime en silence la boîte native quand l'onglet
 * n'est pas au premier plan (outils de développement, autre fenêtre, clic relayé) : la réponse est alors « non » et l'action ne part jamais,
 * sans aucun message. Cette boîte-ci s'affiche toujours et se ferme au clavier (Échap = annuler).
 */
export function askConfirm(message: string): Promise<boolean> {
  const fr = (document.documentElement.lang || "fr").toLowerCase().startsWith("fr");
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "m-auto w-[min(92vw,28rem)] rounded-2xl border border-line bg-surface p-6 text-fg shadow-2xl backdrop:bg-black/60";
    dialog.setAttribute("role", "alertdialog");
    const text = document.createElement("p");
    text.className = "mb-6 whitespace-pre-line text-base";
    text.textContent = message;
    const row = document.createElement("div");
    row.className = "flex justify-end gap-3";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "rounded-full border border-line px-5 py-2 text-sm font-medium";
    cancel.textContent = fr ? "Annuler" : "Cancel";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-fg";
    ok.textContent = fr ? "Continuer" : "Continue";
    let answer = false;
    cancel.onclick = () => dialog.close();
    ok.onclick = () => { answer = true; dialog.close(); };
    dialog.addEventListener("close", () => { dialog.remove(); resolve(answer); });
    row.append(cancel, ok);
    dialog.append(text, row);
    document.body.append(dialog);
    dialog.showModal();
    ok.focus();
  });
}
