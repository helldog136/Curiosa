-- (0.49.0) Onboarding by invitation. Purely additive: one nullable column and two new tables; no row rewritten.
-- Rollback: an older core ignores the column and the tables. To remove them by hand: DROP TABLE "Invitation"; DROP TABLE "PasswordReset"; ALTER TABLE "User" DROP COLUMN "suspendedAt";
ALTER TABLE "User" ADD COLUMN "suspendedAt" DATETIME;

CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "roleId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "rightsSnapshot" TEXT NOT NULL DEFAULT '[]',
    "invitedById" TEXT NOT NULL,
    "invitedByEmail" TEXT NOT NULL,
    "invitedByLevel" TEXT NOT NULL,
    "deliveredBy" TEXT NOT NULL DEFAULT 'email',
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "lastSentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "acceptedUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
CREATE INDEX "Invitation_email_status_idx" ON "Invitation"("email", "status");
CREATE INDEX "Invitation_status_expiresAt_idx" ON "Invitation"("status", "expiresAt");

CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PasswordReset_userId_key" ON "PasswordReset"("userId");
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");
