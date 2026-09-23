"use server";

import { z } from "zod";
import { getTenantBySlug } from "@/lib/data/tenants";
import { saveTemplateAndTheme } from "@/lib/data/theme";
import { FONT_IDS, type ThemeFonts } from "@/lib/fonts";
import { requirePlatformAdmin } from "@/lib/session";
import {
  THEME_FIELDS,
  parseThemeOverrides,
  themeFormSchema,
  type ThemeOverrides,
} from "@/lib/theme";
import type { FormState } from "@/lib/validation";
import { TEMPLATE_IDS, TEMPLATE_META } from "@/templates/meta";

const inputSchema = z.object({
  templateId: z.enum(TEMPLATE_IDS),
  colors: themeFormSchema,
  // Only ids from the curated list; absent = keep the template's own font.
  fonts: z
    .object({ headingFont: z.enum(FONT_IDS).optional(), bodyFont: z.enum(FONT_IDS).optional() })
    .default({}),
});

/**
 * Saves the template, colors and fonts together. Platform admin only (re-checked here, not just
 * on the page). Colors equal to the chosen template's defaults are not stored, so they keep
 * following the template if it is switched later.
 */
export async function saveThemeAction(
  slug: string,
  input: { templateId: string; colors: Record<string, string>; fonts?: ThemeFonts },
): Promise<FormState> {
  await requirePlatformAdmin();

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid template or color.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: "Store not found." };

  const { templateId, colors, fonts } = parsed.data;
  const defaults = TEMPLATE_META[templateId].defaults;
  const overrides: ThemeOverrides = {};
  for (const { key } of THEME_FIELDS) {
    if (colors[key] !== defaults[key]) overrides[key] = colors[key];
  }
  await saveTemplateAndTheme(tenant.id, templateId, { ...parseThemeOverrides(overrides), ...fonts });
  return { ok: true };
}
