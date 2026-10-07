// Charge les hooks de résolution pour que les tests importent directement le code de src/ (alias @/, .ts sans extension,
// JSON, paquets Next). À utiliser avec : node --import ./tests/helpers/register.mjs --test …
import { register } from "node:module";

// Les tests ne sortent jamais sur le réseau : le Catalogue n'interroge pas le dépôt d'origine, sauf test qui l'active explicitement.
process.env.CURIOSA_CATALOGUE_RUNTIME ??= "0";

register("./alias-hooks.mjs", import.meta.url);
