// The interactive admin components that `Blocks` renders in an admin panel (forms, edit dialogs, grid editor, row buttons). Only ADMIN pages import this file and pass it
// to `Blocks` as `kit`: when the public pages imported it (even through a dynamic import) its ~136 KB of JavaScript went into the first load of every public page.
export { AdminBlockForm, RowActionButton } from "../admin/AdminBlocks";
export { DialogLink } from "../admin/EditDialog";
export { GridEditor } from "../admin/GridEditor";
export { SuggestInstall } from "../admin/SuggestInstall";
export { AdminTable } from "../admin/AdminTable";

export type AdminKit = typeof import("./adminKit");
