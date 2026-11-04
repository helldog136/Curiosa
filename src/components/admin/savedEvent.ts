// The edit dialog tells the list under it that a row was saved (a window event: the dialog and the table are separate client trees, with no parent in common).

/** Name of the window event sent by an edit dialog after a successful save. */
export const SAVED_EVENT = "curiosa:row-saved";

/** `id`: the value of the form field named `id` (the row identifier, as in `rowIds`), when the form has one. `message`: what the action answered ("Saved."). */
export type SavedDetail = { instanceId: string; id?: string; message: string };
