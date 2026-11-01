-- CreateTable
CREATE TABLE "VisitDaily" (
    "day" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "visitors" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("day", "kind", "key")
);

-- CreateTable
CREATE TABLE "VisitSeen" (
    "day" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,

    PRIMARY KEY ("day", "hash", "kind", "key")
);

