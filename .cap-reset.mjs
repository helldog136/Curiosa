import fs from "node:fs";
const { prisma } = await import("@/core/db");
await prisma.setting.deleteMany({ where: { key: { in: ["theme.fontBody", "theme.fontHeading", "theme.fontFiles"] } } });
fs.rmSync(`${process.env.DATA_DIR}/fonts`, { recursive: true, force: true });
process.exit(0);
