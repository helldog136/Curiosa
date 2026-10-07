// Charge les hooks de résolution pour que les tests importent directement le code de src/ (alias @/, .ts sans extension,
// JSON, paquets Next). À utiliser avec : node --import ./tests/helpers/register.mjs --test …
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
