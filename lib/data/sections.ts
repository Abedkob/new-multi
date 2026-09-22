import { prisma } from "@/lib/prisma";
import {
  parseSectionVisibility,
  type OptionalSection,
  type SectionVisibility,
} from "@/lib/sections";

/**
 * Flips one optional section on/off. Only the visibility JSON changes; content rows
 * are never touched, so turning a section back on restores exactly what was there.
 * tenantId comes from the session.
 */
export async function setSectionVisible(
  tenantId: string,
  section: OptionalSection,
  visible: boolean,
): Promise<SectionVisibility> {
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { sectionVisibility: true },
    });
    const next = {
      ...parseSectionVisibility(tenant.sectionVisibility),
      [section]: visible,
    };
    await tx.tenant.update({
      where: { id: tenantId },
      data: { sectionVisibility: next },
    });
    return next;
  });
}
