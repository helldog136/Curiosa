-- CreateTable
CREATE TABLE "AuthLock" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "strikes" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" DATETIME,
    "lockedUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TrustedIp" (
    "userId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "lastSeen" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "hash"),
    CONSTRAINT "TrustedIp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
