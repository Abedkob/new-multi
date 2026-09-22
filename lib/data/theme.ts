import { prisma } from "@/lib/prisma";
import type { ThemeOverrides } from "@/lib/theme";

// tenantId always comes from the session, so these can only touch the caller's tenant.

export function saveThemeOverrides(tenantId: string, overrides: ThemeOverrides) {
  return prisma.tenant.update({
    where: { id: tenantId },
    data: { themeOverrides: { ...overrides } },
    select: { id: true },
  });
}

/** Template and colors change together (one Save in the theme editor). */
export function saveTemplateAndTheme(
  tenantId: string,
  templateId: string,
  overrides: ThemeOverrides,
) {
  return prisma.tenant.update({
    where: { id: tenantId },
    data: { templateId, themeOverrides: { ...overrides } },
    select: { id: true },
  });
}

export function setTenantTemplate(tenantId: string, templateId: string) {
  return prisma.tenant.update({
    where: { id: tenantId },
    data: { templateId },
    select: { id: true },
  });
}
