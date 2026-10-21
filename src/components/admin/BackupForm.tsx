"use client";

import { useRef } from "react";
import { AnimatedActionButton } from "./AnimatedActionButton";
import { ui } from "./ui";

type Labels = Record<string, string>;

/** Nom du fichier proposé par le serveur (`Content-Disposition`), sans chemin ; à défaut un nom neutre. */
export function filenameFrom(header: string | null): string {
  const m = /filename="([^"\\/]{1,120})"/.exec(header ?? "");
  return m?.[1] ?? "backup.tar.gz.enc";
}

/**
 * « Télécharger la sauvegarde » : le fichier est fabriqué côté serveur (copie des données, images, chiffrement) : une barre d'étapes réelle s'affiche pendant ce temps,
 * puis le navigateur enregistre le fichier. Les erreurs (mots de passe différents, trop court, session expirée) s'affichent ici au lieu de remplacer la page.
 */
export function BackupForm({ labels, minLength }: { labels: Labels; minLength: number }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} onSubmit={(e) => e.preventDefault()} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm"><span className={ui.label}>{labels.password}</span><input name="password" type="password" required minLength={minLength} autoComplete="new-password" className={ui.input} /></label>
        <label className="block text-sm"><span className={ui.label}>{labels.passwordConfirm}</span><input name="confirm" type="password" required minLength={minLength} autoComplete="new-password" className={ui.input} /></label>
      </div>
      <AnimatedActionButton look="primary" icon="💾" track="backup" testid="backup-button" className="items-start"
        labels={{ idle: labels.createButton!, working: labels.working!, done: labels.downloaded!, failed: labels.failed! }}
        beforeRun={() => form.current?.reportValidity() ?? false}
        run={async (opId) => {
          const f = form.current;
          if (!f) return { ok: false };
          const data = new FormData(f);
          data.set("_op", opId);
          try {
            const res = await fetch("/api/admin/backup", { method: "POST", body: data, credentials: "same-origin" });
            if (!res.ok) {
              const json = (await res.json().catch(() => null)) as { error?: string } | null;
              const key = json?.error ?? "";
              return { ok: false, error: labels[`error.${key}`] ?? labels.failed };
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = filenameFrom(res.headers.get("content-disposition"));
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 30_000);
            f.reset();   // les mots de passe ne restent pas affichés
            return { ok: true };
          } catch { return { ok: false, error: labels["error.network"] }; }
        }} />
    </form>
  );
}
