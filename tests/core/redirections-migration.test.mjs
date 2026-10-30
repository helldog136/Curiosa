// Redirections 2 : la migration est additive — un site existant se met à jour sans rien perdre (testée sur une copie d'une base d'avant).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { makeTempDir } from "../helpers/tmp.mjs";

const root = process.cwd();
const MIGRATION = "20261022090000_redirections_2";
const sqlite = (db, sql) => execFileSync("node", ["-e", `const {PrismaClient}=require(${JSON.stringify(path.join(root, "node_modules/@prisma/client"))});const p=new PrismaClient({datasources:{db:{url:${JSON.stringify("file:" + db)}}}});(async()=>{const q=${JSON.stringify(sql)};const rows=await p.$queryRawUnsafe(q);console.log(JSON.stringify(rows,(k,v)=>typeof v==="bigint"?Number(v):v));await p.$disconnect()})()`], { encoding: "utf8" });
const deploy = (schema, db) => execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", schema], { cwd: root, env: { ...process.env, DATABASE_URL: `file:${db}` }, stdio: "pipe" });

test("migration : la base d'avant garde ses redirections (chemin, destination, total) ; colonnes et table ajoutées seulement", () => {
  createRequire(import.meta.url);
  const dir = makeTempDir("curiosa-mig-");
  try {
    // Un dossier prisma/ copié SANS la nouvelle migration = l'état d'un site existant.
    const old = path.join(dir, "prisma");
    fs.cpSync(path.join(root, "prisma"), old, { recursive: true });
    fs.rmSync(path.join(old, "migrations", MIGRATION), { recursive: true });
    const db = path.join(dir, "site.db");
    deploy(path.join(old, "schema.prisma"), db);
    assert.ok(!/expiresAt/.test(sqlite(db, `SELECT sql FROM sqlite_master WHERE name='Redirect'`)), "état d'avant : pas de date de fin");
    sqlite(db, `INSERT INTO "Redirect" (id, path, targetUrl, permanent, active, hits, createdAt, updatedAt) VALUES ('r1','twitch','https://twitch.tv/x',1,1,42,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).toString();
    // Mise à jour du site : les migrations du dépôt s'appliquent sur cette base.
    deploy(path.join(root, "prisma", "schema.prisma"), db);
    const rows = JSON.parse(sqlite(db, `SELECT path, targetUrl, permanent, active, hits, expiresAt, endMessage FROM "Redirect"`));
    assert.deepEqual(rows, [{ path: "twitch", targetUrl: "https://twitch.tv/x", permanent: true, active: true, hits: 42, expiresAt: null, endMessage: "" }]);
    assert.deepEqual(JSON.parse(sqlite(db, `SELECT COUNT(*) AS n FROM "RedirectDay"`)), [{ n: 0 }]);
    sqlite(db, `INSERT INTO "RedirectDay" (redirectId, day, hits) VALUES ('r1','2026-10-22',3)`);
    sqlite(db, `DELETE FROM "Redirect" WHERE id='r1'`);
    assert.deepEqual(JSON.parse(sqlite(db, `SELECT COUNT(*) AS n FROM "RedirectDay"`)), [{ n: 0 }], "supprimer un lien supprime ses chiffres");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("migration : texte SQL purement additif (aucun DROP, aucun RENAME, aucune colonne retirée)", () => {
  const sql = fs.readFileSync(path.join(root, "prisma/migrations", MIGRATION, "migration.sql"), "utf8").replace(/--.*$/gm, "");
  assert.ok(!/\bDROP\b|\bRENAME\b|DELETE\s+FROM|UPDATE\s+"/i.test(sql));
  assert.ok(/ALTER TABLE "Redirect" ADD COLUMN "expiresAt"/.test(sql) && /CREATE TABLE "RedirectDay"/.test(sql));
});
