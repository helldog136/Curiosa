// À importer AVANT les composants : `node --import ./testsupport/skins/bench/register.mjs …` (les crochets d'abord, puis ceux des tests s'il y en a).
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
