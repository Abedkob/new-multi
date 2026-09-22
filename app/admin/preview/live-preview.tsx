"use client";

import { useEffect, useMemo, useState } from "react";
import { ThemeScope } from "@/components/theme-scope";
import type { CategoryNode } from "@/lib/categories";
import {
  CONTENT_KEY_NAMES,
  IMAGE_CONTENT_KEYS,
  resolveContent,
} from "@/lib/content";
import { parseSectionVisibility, type SectionVisibility } from "@/lib/sections";
import { buildStorefrontData } from "@/lib/storefront-data";
import type { ThemeColors } from "@/lib/theme";
import { isImageUrl, isInstagramHandle } from "@/lib/validation";
import { getTemplate } from "@/templates";
import { HomeSections, StorefrontShell } from "@/templates/render";
import type { StoreInfo, StoreProduct } from "@/templates/types";

type Draft = {
  values: Record<string, string>;
  visibility: SectionVisibility;
  view: "home" | "product";
};

/**
 * The owner's storefront rendered on the client so unsaved edits show up instantly. The
 * content editor (parent window) posts the draft text/visibility/page; this renders it with
 * the real template, saved theme and real products. Invalid URLs/handles in a draft are
 * ignored, exactly as they would be rejected on save.
 */
export function LivePreview({
  store,
  templateId,
  colors,
  storedValues,
  visibility,
  newArrivals,
  bestSellers,
  categories,
  categoryProductImages,
}: {
  store: StoreInfo;
  templateId: string;
  colors: ThemeColors;
  storedValues: Record<string, string>;
  visibility: SectionVisibility;
  newArrivals: StoreProduct[];
  bestSellers: StoreProduct[];
  categories: CategoryNode[];
  categoryProductImages: { categoryId: string | null; imageUrl: string }[];
}) {
  const [draft, setDraft] = useState<Draft>({ values: storedValues, visibility, view: "home" });

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const m = e.data as {
        type?: string;
        values?: Record<string, unknown>;
        visibility?: unknown;
        view?: string;
        section?: string;
      } | null;

      if (m?.type === "preview-state" && m.values) {
        const values: Record<string, string> = {};
        for (const key of CONTENT_KEY_NAMES) {
          const v = m.values[key];
          if (typeof v === "string") values[key] = v;
        }
        setDraft({
          values,
          visibility: parseSectionVisibility(m.visibility),
          view: m.view === "product" ? "product" : "home",
        });
      }

      if (m?.type === "preview-scroll" && typeof m.section === "string") {
        const section = m.section;
        // Wait for the state update above to render before scrolling.
        window.setTimeout(() => {
          document
            .querySelector(`[data-section="${CSS.escape(section)}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
      }
    }

    function blockNavigation(e: MouseEvent) {
      if ((e.target as Element | null)?.closest("a")) e.preventDefault();
    }

    const blockSubmit = (e: Event) => e.preventDefault();
    window.addEventListener("message", onMessage);
    document.addEventListener("click", blockNavigation, true);
    document.addEventListener("submit", blockSubmit, true);
    window.parent.postMessage({ type: "preview-ready" }, window.location.origin);
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("click", blockNavigation, true);
      document.removeEventListener("submit", blockSubmit, true);
    };
  }, []);

  const data = useMemo(() => {
    // Same rules as saving: trimmed, empty means "use the default", bad values dropped.
    const rows = Object.entries(draft.values)
      .map(([key, value]) => ({ key, value: value.trim() }))
      .filter(({ key, value }) => {
        if (value === "") return false;
        if (IMAGE_CONTENT_KEYS.includes(key)) return isImageUrl(value);
        if (key === "instagram.handle") return isInstagramHandle(value);
        return true;
      });
    return buildStorefrontData({
      store,
      content: resolveContent(rows),
      sectionVisibility: draft.visibility,
      newArrivals,
      bestSellers,
      categories,
      categoryProductImages,
    });
  }, [draft, store, newArrivals, bestSellers, categories, categoryProductImages]);

  const template = getTemplate(templateId);
  const product = newArrivals[0];
  const related = product ? newArrivals.filter((p) => p.id !== product.id).slice(0, 4) : [];

  return (
    <ThemeScope colors={colors} className="min-h-screen">
      <StorefrontShell template={template} data={data}>
        {draft.view === "product" && product ? (
          <template.ProductPage data={data} product={product} related={related} />
        ) : (
          <HomeSections template={template} data={data} />
        )}
      </StorefrontShell>
    </ThemeScope>
  );
}
