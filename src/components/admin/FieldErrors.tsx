"use client";

import { createContext, useContext, useEffect, type RefObject } from "react";
import type { FieldErrorMap } from "@/core/fieldErrors";

/**
 * RÈGLE : une erreur de validation s'affiche TOUJOURS juste sous le champ concerné (couleur d'erreur + icône, `aria-invalid`, message relié par `aria-describedby`,
 * contour d'erreur) ; la page défile jusqu'au premier champ en erreur et lui donne le focus ; l'erreur disparaît dès que la personne corrige le champ.
 * Le bandeau en haut n'est QUE pour les erreurs qui ne concernent aucun champ.
 *  - Champs nommés (input name="…") : `useFieldErrorsDom` s'en charge pour tout formulaire, sans toucher aux champs.
 *  - Champs d'un éditeur répétable (menu, grille, liste) : l'éditeur lit `useFieldError(chemin)` et affiche `<FieldErrorText>` sous le champ de CETTE ligne.
 */
export const ERROR_BORDER = "border-red-500";
const ICON = "⚠";

type Ctx = { errors: FieldErrorMap; clear: (path: string) => void };
const FieldErrorsContext = createContext<Ctx>({ errors: {}, clear: () => {} });
export const FieldErrorsProvider = FieldErrorsContext.Provider;

export const useFieldErrorsContext = (): Ctx => useContext(FieldErrorsContext);

/** Erreur du champ `path` (chemin d'un éditeur), et de quoi marquer le champ : à étaler sur l'`<input>`. Pur : s'utilise dans une boucle de rendu. */
export function errorOf(ctx: Ctx, path: string): { message: string | null; props: { "aria-invalid"?: true; "aria-describedby"?: string; "data-error-path"?: string; onInput?: () => void }; id: string; className: string } {
  const message = ctx.errors[path] ?? null;
  const id = `err-${path.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  return message
    ? { message, id, className: ERROR_BORDER, props: { "aria-invalid": true, "aria-describedby": id, "data-error-path": path, onInput: () => ctx.clear(path) } }
    : { message, id, className: "", props: {} };
}

/** Comme `errorOf`, pour un composant. */
export const useFieldError = (path: string) => errorOf(useContext(FieldErrorsContext), path);

/** Le message, sous le champ : icône + texte, annoncé aux lecteurs d'écran. */
export function FieldErrorText({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} data-field-error="" className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-red-700">
      <span aria-hidden="true">{ICON}</span><span>{message}</span>
    </p>
  );
}

/** Défile jusqu'au premier champ marqué en erreur du formulaire et lui donne le focus (sans second défilement). */
export function focusFirstError(form: HTMLElement | null): void {
  const first = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (!first) return;
  // Dans une zone repliée (options avancées…) : on l'ouvre, sinon le champ ne peut ni s'afficher ni recevoir le focus.
  const fold = first.closest("details");
  if (fold && !fold.open) fold.open = true;
  const calm = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  first.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
  first.focus({ preventScroll: true });
}

/** Marque les champs NOMMÉS du formulaire (hors éditeurs, qui s'en chargent eux-mêmes) : contour, `aria-invalid`, message juste dessous ; retiré dès que le champ change. */
export function useFieldErrorsDom(form: RefObject<HTMLElement | null>, errors: FieldErrorMap | undefined, token: unknown): void {
  useEffect(() => {
    const root = form.current;
    if (!root || !errors) return;
    const undo: (() => void)[] = [];
    for (const [key, message] of Object.entries(errors)) {
      const found = (root as HTMLFormElement).elements?.namedItem?.(key) ?? root.querySelector(`[name="${CSS.escape(key)}"]`);
      let el = found instanceof RadioNodeList ? (found[0] as HTMLElement | undefined) : (found as HTMLElement | null);
      // Valeur portée par un champ caché (image, choix parmi…) : le message va sous la saisie visible du même réglage.
      if (el && (el as HTMLInputElement).type === "hidden") el = el.closest("[data-setting], [data-choice]")?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select') ?? null;
      if (!el || (el as HTMLInputElement).type === "hidden") continue;
      const id = `err-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
      const p = document.createElement("p");
      p.id = id; p.setAttribute("data-field-error", "");
      p.className = "mt-1.5 flex items-start gap-1.5 text-sm font-medium text-red-700";
      const icon = document.createElement("span"); icon.setAttribute("aria-hidden", "true"); icon.textContent = ICON;
      const text = document.createElement("span"); text.textContent = message;
      p.append(icon, text);
      el.after(p);
      const before = el.getAttribute("aria-describedby");
      el.setAttribute("aria-invalid", "true");
      el.setAttribute("aria-describedby", [before, id].filter(Boolean).join(" "));
      el.classList.add(ERROR_BORDER);
      const clear = () => {
        p.remove(); el.removeAttribute("aria-invalid"); el.classList.remove(ERROR_BORDER);
        if (before) el.setAttribute("aria-describedby", before); else el.removeAttribute("aria-describedby");
        el.removeEventListener("input", clear); el.removeEventListener("change", clear);
      };
      el.addEventListener("input", clear); el.addEventListener("change", clear);
      undo.push(clear);
    }
    const frame = requestAnimationFrame(() => focusFirstError(root));
    return () => { cancelAnimationFrame(frame); undo.forEach((u) => u()); };
  }, [form, errors, token]);
}
