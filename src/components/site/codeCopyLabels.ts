import type { Translator } from "@/core/i18n/dictionary";
import type { CodeCopyLabels } from "./CodeBlock";

/** The four texts of the "Copy" button of the code blocks, translated on the server (site layout and admin layout) and given to `CodeCopyProvider`. */
export function codeCopyLabels(t: Translator): CodeCopyLabels {
  return { copy: t("site.code.copy"), aria: t("site.code.copyAria"), copied: t("site.code.copied"), failed: t("site.code.copyFailed") };
}
