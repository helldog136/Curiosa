import { prisma } from "@/core/db";

/** Les pages publiées du site (collections montées à la racine) : on les coche au lieu de taper leur adresse. */
export async function listMenuPages(defaultLocale: string) {
  const roots = await prisma.moduleInstance.findMany({ where: { basePath: "", enabled: true }, select: { id: true } });
  const entries = await prisma.entry.findMany({
    where: { instanceId: { in: roots.map((r) => r.id) }, status: "published" },
    include: { translations: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return entries.flatMap((e) => {
    const base = e.translations.find((t) => t.locale === defaultLocale) ?? e.translations[0];
    return base ? [{ id: e.id, href: `/${base.slug}`, title: base.title }] : [];
  });
}
