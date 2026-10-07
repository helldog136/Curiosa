// Charge les hooks de résolution pour que les tests importent directement le code de src/ (alias @/, .ts sans extension,
// JSON, paquets Next). À utiliser avec : node --import ./tests/helpers/register.mjs --test …
import { register } from "node:module";

// Les tests ne sortent jamais sur le réseau : la Marketplace n'interroge pas le dépôt d'origine, sauf test qui l'active explicitement.
process.env.VITRINE_MARKETPLACE_RUNTIME ??= "0";

register("./alias-hooks.mjs", import.meta.url);
