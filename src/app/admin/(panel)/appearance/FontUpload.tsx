import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, FieldLabel, TextField } from "@/components/admin/Field";
import { HelpBelow } from "@/components/admin/HelpTip";
import { ui } from "@/components/admin/ui";
import type { Translator } from "@/core/i18n/dictionary";
import { UPLOAD_LIMITS, type UploadedFont } from "@/core/fonts/types";
import { deleteFontAction, uploadFontAction } from "./actions";

/** « 400 » → « Normale », « 700 » → « Grasse », une plage → « Variable ». */
function weightLabel(f: UploadedFont, t: Translator): string {
  const base = f.weight.includes(" ") ? t("appearance.font.weight.variable") : Number(f.weight) >= 600 ? t("appearance.font.weight.bold") : t("appearance.font.weight.regular");
  return f.style === "italic" ? `${base}, ${t("appearance.font.style.italic")}` : base;
}

/** Envoyer sa propre police : trois champs (fichier, nom, case de licence), puis les polices déjà envoyées (4 au plus). Replié : la bibliothèque suffit à presque tout le monde. */
export function FontUpload({ t, uploads }: { t: Translator; uploads: UploadedFont[] }) {
  return (
    <details className="rounded-xl border border-line bg-bg" data-testid="font-upload" open={uploads.length > 0 ? true : undefined}>
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-[15px] font-medium">{t("appearance.font.mine.summary", { n: uploads.length, max: UPLOAD_LIMITS.maxFiles })}</summary>
      <div className="space-y-4 border-t border-line p-4">
        <p className={ui.help}>{t("appearance.font.mine.intro")}</p>
        {uploads.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line" data-testid="font-uploads">
            {uploads.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0 [overflow-wrap:anywhere]"><span className="font-medium">{f.family}</span> <span className={ui.chip}>{weightLabel(f, t)}</span> <span className="text-sm text-muted">{Math.max(1, Math.round(f.bytes / 1024))} {t("appearance.font.kb")}</span></span>
                <ActionForm action={deleteFontAction} submitLabel={t("appearance.font.delete")} secondary pendingLabel={t("appearance.font.deleting")} confirm={t("appearance.font.deleteConfirm", { name: f.family })} className="space-y-1">
                  <input type="hidden" name="id" value={f.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        {uploads.length < UPLOAD_LIMITS.maxFiles ? (
          <ActionForm action={uploadFontAction} submitLabel={t("appearance.font.upload")} pendingLabel={t("appearance.font.uploading")} reset className="space-y-4">
            <div>
              <FieldLabel id="font" className={ui.label} help={t("appearance.font.fileHelp")} text={t("appearance.font.file")}>{t("appearance.font.file")}</FieldLabel>
              <input id="font" name="font" type="file" accept=".woff2,font/woff2" required className={ui.input} />
              <HelpBelow help={t("appearance.font.fileHelp")} className={ui.help} />
            </div>
            <TextField name="fontName" label={t("appearance.font.name")} help={t("appearance.font.nameHelp")} example={t("appearance.font.nameExample")} />
            <Checkbox name="license" label={t("appearance.font.license")} help={t("appearance.font.licenseHelp")} />
          </ActionForm>
        ) : (
          <p className={ui.help}>{t("appearance.font.mine.full", { max: UPLOAD_LIMITS.maxFiles })}</p>
        )}
      </div>
    </details>
  );
}
