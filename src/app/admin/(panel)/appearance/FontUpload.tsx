import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, FieldLabel, TextField } from "@/components/admin/Field";
import { HelpBelow } from "@/components/admin/HelpTip";
import { MoreOptions } from "@/components/admin/MoreOptions";
import { ui } from "@/components/admin/ui";
import type { Translator } from "@/core/i18n/dictionary";
import { UPLOAD_LIMITS } from "@/core/fonts/types";
import { uploadFontAction } from "./actions";

/**
 * Le formulaire d'envoi d'une police, DANS la section « Polices » (juste sous les deux listes). Court : un fichier et la case de licence ; le nom est facultatif,
 * sous « Plus d'options ». Il est affiché par `FontPickers` (ligne « Utiliser ma propre police… » au bout de chaque liste) ; les polices envoyées sont dans les listes.
 */
export function FontUpload({ t, count }: { t: Translator; count: number }) {
  if (count >= UPLOAD_LIMITS.maxFiles) return <p className={ui.help}>{t("appearance.font.mine.full", { max: UPLOAD_LIMITS.maxFiles })}</p>;
  return (
    <ActionForm action={uploadFontAction} submitLabel={t("appearance.font.upload")} pendingLabel={t("appearance.font.uploading")} reset className="space-y-4">
      <div>
        <FieldLabel id="font" className={ui.label} help={t("appearance.font.fileHelp")} text={t("appearance.font.file")}>{t("appearance.font.file")}</FieldLabel>
        <input id="font" name="font" type="file" accept=".woff2,.otf,.ttf,font/woff2,font/otf,font/ttf" required className={ui.input} />
        <p className={ui.help}>{t("appearance.font.fileLimit")}</p>
        <HelpBelow help={t("appearance.font.fileHelp")} className={ui.help} />
      </div>
      <Checkbox name="license" label={t("appearance.font.license")} help={t("appearance.font.licenseHelp")} />
      <MoreOptions title={t("appearance.font.more")}>
        <TextField name="fontName" label={t("appearance.font.name")} help={t("appearance.font.nameHelp")} example={t("appearance.font.nameExample")} />
      </MoreOptions>
    </ActionForm>
  );
}
