-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "passwordHash" TEXT NOT NULL,
    "locale" TEXT,
    "advanced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL,

    PRIMARY KEY ("key", "locale")
);

-- CreateTable
CREATE TABLE "ModuleInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nickname" TEXT,
    "basePath" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
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

-- CreateTable
CREATE TABLE "InstanceTranslation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "InstanceTranslation_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ModuleInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" DATETIME,
    "expiresAt" DATETIME,
    "cover" TEXT,
    "icon" TEXT,
    "url" TEXT,
    "code" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL DEFAULT 0,
    "fields" TEXT NOT NULL DEFAULT '{}',
    "sourceLocale" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Entry_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ModuleInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Entry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EntryTranslation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntryTranslation_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Redirect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "entryId" TEXT,
    "permanent" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "repoUrl" TEXT,
    "ref" TEXT,
    "commit" TEXT,
    "version" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ModuleRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'read',
    "grants" TEXT NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleInstance_key_key" ON "ModuleInstance"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleInstance_basePath_key" ON "ModuleInstance"("basePath");

-- CreateIndex
CREATE INDEX "ModuleInstance_moduleId_idx" ON "ModuleInstance"("moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "InstanceTranslation_instanceId_locale_key" ON "InstanceTranslation"("instanceId", "locale");

-- CreateIndex
CREATE INDEX "Entry_instanceId_status_publishedAt_idx" ON "Entry"("instanceId", "status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EntryTranslation_entryId_locale_key" ON "EntryTranslation"("entryId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "EntryTranslation_instanceId_locale_slug_key" ON "EntryTranslation"("instanceId", "locale", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Redirect_path_key" ON "Redirect"("path");

-- CreateIndex
CREATE INDEX "ModuleRecord_instanceId_collection_createdAt_idx" ON "ModuleRecord"("instanceId", "collection", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_hash_key" ON "ApiToken"("hash");
