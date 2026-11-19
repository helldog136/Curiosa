/** The setting names of a skin's own options are shown as controls with this prefix (group "Variants"): they are saved with `saveSkinOptions`, not with the customization. */
export const OPTION_PREFIX = "opt-";

/** The field name a control's error is shown under (`cz-<id>`). */
export const fieldName = (id: string): string => `cz-${id}`;
