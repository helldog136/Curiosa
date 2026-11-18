-- Removes the legacy "switched off" state (ended with 0.1.20): the columns Module.enabled and ModuleInstance.enabled.
--
-- WHAT HAPPENS TO A ROW THAT IS STILL SWITCHED OFF (enabled = 0 on the instance, or on its module), decided before the columns go:
--   it is never switched on (that would publish something the owner had put away) and never deleted. It is set aside, data kept, exactly as the removed
--   `retireLegacyOff` did (src/core/modules/retiredPlan.ts, payload v1): one `RetiredInstance` line per instance, reason "legacy", holding the instance, its
--   translations, entries, entry translations, settings (`instance.<id>.*`) and stored records. The owner finds them in the page of kept data, and reinstalling the module
--   brings them back with the same identifiers. A switched-off MODULE is uninstalled (its row, and the settings of its instances, go; its files are removed by the
--   next module sweep). A site that never had such a row (every site that went through 0.2.0, which is the update floor) runs only the two table rewrites at the end.
-- Dates are stored as milliseconds; in the payload they are ISO texts, as `JSON.stringify` writes them. Booleans are true / false.

CREATE TABLE "_off_instance" ("id" TEXT NOT NULL PRIMARY KEY, "off_module" INTEGER NOT NULL);
INSERT INTO "_off_instance" ("id", "off_module")
  SELECT i."id", CASE WHEN m."enabled" = 0 THEN 1 ELSE 0 END
  FROM "ModuleInstance" i LEFT JOIN "Module" m ON m."id" = i."moduleId"
  WHERE i."enabled" = 0 OR m."enabled" = 0;

INSERT OR REPLACE INTO "RetiredInstance" ("id", "moduleId", "key", "label", "moduleName", "repoUrl", "ref", "subdir", "reason", "retiredAt", "entryCount", "recordCount", "payload")
SELECT
  i."id", i."moduleId", i."key",
  COALESCE(NULLIF(trim(i."nickname"), ''), (SELECT t."name" FROM "InstanceTranslation" t WHERE t."instanceId" = i."id" AND trim(t."name") <> '' ORDER BY t."locale" LIMIT 1), i."key"),
  i."moduleId", m."repoUrl", m."ref", m."subdir", 'legacy',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  (SELECT count(*) FROM "Entry" e WHERE e."instanceId" = i."id"),
  (SELECT count(*) FROM "ModuleRecord" r WHERE r."instanceId" = i."id"),
  json_object(
    'v', 1,
    'instance', json_object(
      'id', i."id", 'moduleId', i."moduleId", 'key', i."key", 'nickname', i."nickname", 'basePath', i."basePath",
      'showInNav', CASE WHEN i."showInNav" THEN json('true') ELSE json('false') END, 'navOrder', i."navOrder",
      'display', i."display", 'clickAction', i."clickAction", 'features', i."features", 'fieldSchema', i."fieldSchema",
      'fallbackToDefault', CASE WHEN i."fallbackToDefault" THEN json('true') ELSE json('false') END,
      'allowGoLinks', CASE WHEN i."allowGoLinks" THEN json('true') ELSE json('false') END,
      'exposed', CASE WHEN i."exposed" THEN json('true') ELSE json('false') END,
      'createdAt', CASE typeof(i."createdAt") WHEN 'integer' THEN strftime('%Y-%m-%dT%H:%M:%fZ', i."createdAt" / 1000.0, 'unixepoch') ELSE i."createdAt" END,
      'updatedAt', CASE typeof(i."updatedAt") WHEN 'integer' THEN strftime('%Y-%m-%dT%H:%M:%fZ', i."updatedAt" / 1000.0, 'unixepoch') ELSE i."updatedAt" END
    ),
    'translations', (SELECT json_group_array(json_object('id', t."id", 'instanceId', t."instanceId", 'locale', t."locale", 'name', t."name", 'description', t."description"))
      FROM (SELECT * FROM "InstanceTranslation" WHERE "instanceId" = i."id" ORDER BY "locale") t),
    'entries', (SELECT json_group_array(json_object(
        'id', e."id", 'instanceId', e."instanceId", 'status', e."status",
        'publishedAt', CASE typeof(e."publishedAt") WHEN 'integer' THEN strftime('%Y-%m-%dT%H:%M:%fZ', e."publishedAt" / 1000.0, 'unixepoch') ELSE e."publishedAt" END,
        'expiresAt', CASE typeof(e."expiresAt") WHEN 'integer' THEN strftime('%Y-%m-%dT%H:%M:%fZ', e."expiresAt" / 1000.0, 'unixepoch') ELSE e."expiresAt" END,
        'cover', e."cover", 'icon', e."icon", 'url', e."url", 'code', e."code",
        'featured', CASE WHEN e."featured" THEN json('true') ELSE json('false') END,
        'tags', e."tags", 'position', e."position", 'fields', e."fields", 'sourceLocale', e."sourceLocale", 'authorId', e."authorId",
        'createdAt', CASE typeof(e."createdAt") WHEN 'integer' THEN strftime('%Y-%m-%dT%H:%M:%fZ', e."createdAt" / 1000.0, 'unixepoch') ELSE e."createdAt" END,
        'updatedAt', CASE typeof(e."updatedAt") WHEN 'integer' THEN strftime('%Y-%m-%dT%H:%M:%fZ', e."updatedAt" / 1000.0, 'unixepoch') ELSE e."updatedAt" END))
      FROM (SELECT * FROM "Entry" WHERE "instanceId" = i."id" ORDER BY "createdAt", "id") e),
    'entryTranslations', (SELECT json_group_array(json_object(
        'id', x."id", 'entryId', x."entryId", 'instanceId', x."instanceId", 'locale', x."locale", 'slug', x."slug", 'title', x."title", 'summary', x."summary", 'body', x."body",
        'updatedAt', CASE typeof(x."updatedAt") WHEN 'integer' THEN strftime('%Y-%m-%dT%H:%M:%fZ', x."updatedAt" / 1000.0, 'unixepoch') ELSE x."updatedAt" END))
      FROM (SELECT * FROM "EntryTranslation" WHERE "entryId" IN (SELECT "id" FROM "Entry" WHERE "instanceId" = i."id") ORDER BY "entryId", "locale") x),
    'settings', (SELECT json_group_array(json_object('key', s."key", 'locale', s."locale", 'value', s."value"))
      FROM (SELECT * FROM "Setting" WHERE substr("key", 1, length('instance.' || i."id" || '.')) = 'instance.' || i."id" || '.' ORDER BY "key", "locale") s),
    'records', (SELECT json_group_array(json_object(
        'id', r."id", 'instanceId', r."instanceId", 'collection', r."collection", 'data', r."data", 'key', r."key",
        'createdAt', CASE typeof(r."createdAt") WHEN 'integer' THEN strftime('%Y-%m-%dT%H:%M:%fZ', r."createdAt" / 1000.0, 'unixepoch') ELSE r."createdAt" END))
      FROM (SELECT * FROM "ModuleRecord" WHERE "instanceId" = i."id" ORDER BY "createdAt", "id") r)
  )
FROM "ModuleInstance" i LEFT JOIN "Module" m ON m."id" = i."moduleId"
WHERE i."id" IN (SELECT "id" FROM "_off_instance");

-- They leave the live tables (children first: this does not rely on cascading deletes). Their short address goes with them, as when an instance is retired.
DELETE FROM "Redirect" WHERE "managedBy" IN (SELECT "id" FROM "_off_instance");
DELETE FROM "Setting" WHERE EXISTS (SELECT 1 FROM "_off_instance" o WHERE substr("Setting"."key", 1, length('instance.' || o."id" || '.')) = 'instance.' || o."id" || '.');
DELETE FROM "ModuleRecord" WHERE "instanceId" IN (SELECT "id" FROM "_off_instance");
DELETE FROM "EntryTranslation" WHERE "instanceId" IN (SELECT "id" FROM "_off_instance");
DELETE FROM "Entry" WHERE "instanceId" IN (SELECT "id" FROM "_off_instance");
DELETE FROM "InstanceTranslation" WHERE "instanceId" IN (SELECT "id" FROM "_off_instance");
DELETE FROM "ModuleInstance" WHERE "id" IN (SELECT "id" FROM "_off_instance");

-- A switched-off module is uninstalled (its instances are all set aside above).
DELETE FROM "Module" WHERE "enabled" = 0;
DROP TABLE "_off_instance";


-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Module" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "repoUrl" TEXT,
    "ref" TEXT,
    "commit" TEXT,
    "subdir" TEXT,
    "tree" TEXT,
    "version" TEXT NOT NULL,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Module" ("commit", "id", "installedAt", "ref", "repoUrl", "source", "subdir", "tree", "updatedAt", "version") SELECT "commit", "id", "installedAt", "ref", "repoUrl", "source", "subdir", "tree", "updatedAt", "version" FROM "Module";
DROP TABLE "Module";
ALTER TABLE "new_Module" RENAME TO "Module";
CREATE TABLE "new_ModuleInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nickname" TEXT,
    "basePath" TEXT,
    "showInNav" BOOLEAN NOT NULL DEFAULT true,
    "navOrder" INTEGER NOT NULL DEFAULT 0,
    "display" TEXT NOT NULL DEFAULT 'cards',
    "clickAction" TEXT NOT NULL DEFAULT 'detail',
    "features" TEXT NOT NULL DEFAULT '[]',
    "fieldSchema" TEXT NOT NULL DEFAULT '[]',
    "fallbackToDefault" BOOLEAN NOT NULL DEFAULT true,
    "allowGoLinks" BOOLEAN NOT NULL DEFAULT false,
    "exposed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ModuleInstance" ("allowGoLinks", "basePath", "clickAction", "createdAt", "display", "exposed", "fallbackToDefault", "features", "fieldSchema", "id", "key", "moduleId", "navOrder", "nickname", "showInNav", "updatedAt") SELECT "allowGoLinks", "basePath", "clickAction", "createdAt", "display", "exposed", "fallbackToDefault", "features", "fieldSchema", "id", "key", "moduleId", "navOrder", "nickname", "showInNav", "updatedAt" FROM "ModuleInstance";
DROP TABLE "ModuleInstance";
ALTER TABLE "new_ModuleInstance" RENAME TO "ModuleInstance";
CREATE UNIQUE INDEX "ModuleInstance_key_key" ON "ModuleInstance"("key");
CREATE UNIQUE INDEX "ModuleInstance_basePath_key" ON "ModuleInstance"("basePath");
CREATE INDEX "ModuleInstance_moduleId_idx" ON "ModuleInstance"("moduleId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

