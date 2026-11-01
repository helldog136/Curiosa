// Passerelle : la SEULE copie du faux contexte de module vit dans testsupport/fakeCtx.mjs (API publique du kit de test des modules).
// Ce fichier existe pour les tests qui l'importent depuis tests/helpers, et pour curiosa-extras, dont scripts/test.mjs le recopie : une fois recopié,
// le chemin relatif ne mène plus au cœur, d'où le repli sur le dossier courant (les tests de curiosa-extras tournent dans le dossier du cœur).
import path from "node:path";
import { pathToFileURL } from "node:url";

const sibling = new URL("../../testsupport/fakeCtx.mjs", import.meta.url);
const target = (await import("node:fs")).existsSync(sibling) ? sibling : pathToFileURL(path.join(process.cwd(), "testsupport/fakeCtx.mjs"));
const kit = await import(target.href);
export const fakeCtx = kit.fakeCtx;
