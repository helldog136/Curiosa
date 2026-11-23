-- (0.47.0) Every AI access belongs to a person. Purely additive: a defaulted column, no row rewritten, ownerId stays nullable (the rule is enforced by the code; a later release may tighten it).
ALTER TABLE "ApiToken" ADD COLUMN "coarseCeiling" BOOLEAN NOT NULL DEFAULT false;
