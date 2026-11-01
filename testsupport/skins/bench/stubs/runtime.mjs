// Aucun module installé sur le banc : les emplacements (menu, pied, bandeau…) sont vides ; les pièces des modules passent par leurs `demo`.
export async function runSlot() { return []; }
export async function filterEntryBody(body) { return body; }
export async function runSection() { return []; }
export async function runPage() { return null; }
export async function instanceHasNews() { return false; }
