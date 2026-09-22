import { prisma } from "@/lib/prisma";
import { resolveContent } from "@/lib/content";

export function listContentRows(tenantId: string) {
  return prisma.tenantContent.findMany({ where: { tenantId } });
}

export async function getContentMap(tenantId: string) {
  return resolveContent(await listContentRows(tenantId));
}

/** Non-empty values are upserted; empty values delete the row so the default applies. */
export async function saveContent(
  tenantId: string,
  entries: { key: string; value: string }[],
) {
  const toSet = entries.filter((e) => e.value !== "");
  const toClear = entries.filter((e) => e.value === "").map((e) => e.key);
  await prisma.$transaction([
    ...toSet.map((e) =>
      prisma.tenantContent.upsert({
        where: { tenantId_key: { tenantId, key: e.key } },
        create: { tenantId, key: e.key, value: e.value },
        update: { value: e.value },
      }),
    ),
    prisma.tenantContent.deleteMany({
      where: { tenantId, key: { in: toClear } },
    }),
  ]);
}
