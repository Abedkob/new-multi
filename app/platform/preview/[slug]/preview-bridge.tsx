"use client";

import { useEffect } from "react";
import { fontVars, googleFontsHref, parseThemeFonts } from "@/lib/fonts";
import {
  THEME_FIELDS,
  hexColorSchema,
  themeStyle,
  type ThemeColors,
} from "@/lib/theme";

/**
 * Lives inside the preview iframe. The theme editor (parent window) sends unsaved colors
 * with postMessage and this applies them as CSS variables straight away, without a reload.
 * It also makes the preview inert: links do nothing, so the editor never navigates away.
 */
export function PreviewBridge() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-theme-scope]");

    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || !root) return;
      const data = e.data as { type?: string; colors?: Record<string, unknown>; fonts?: unknown } | null;
      if (data?.type !== "preview-colors" || !data.colors) return;

      // Fonts: only known ids (parseThemeFonts), loaded from Google Fonts on demand.
      const fonts = parseThemeFonts(data.fonts);
      for (const name of ["--font-sans", "--font-heading", "--font-serif"]) root.style.removeProperty(name);
      for (const [name, value] of Object.entries(fontVars(fonts))) root.style.setProperty(name, value);
      root.style.fontFamily = fonts.bodyFont ? "var(--font-sans)" : "";
      root.toggleAttribute("data-heading-font", !!fonts.headingFont);
      const href = googleFontsHref([fonts.headingFont, fonts.bodyFont]);
      if (href && !document.querySelector(`link[data-preview-font][href="${href}"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.previewFont = "";
        document.head.appendChild(link);
      }

      const colors = {} as ThemeColors;
      for (const { key } of THEME_FIELDS) {
        const parsed = hexColorSchema.safeParse(data.colors[key]);
        if (!parsed.success) return; // ignore incomplete/invalid updates
        colors[key] = parsed.data;
      }
      for (const [name, value] of Object.entries(themeStyle(colors))) {
        root.style.setProperty(name, String(value));
      }
    }

    function blockNavigation(e: MouseEvent) {
      if ((e.target as Element | null)?.closest("a")) e.preventDefault();
    }

    const blockSubmit = (e: Event) => e.preventDefault();
    window.addEventListener("message", onMessage);
    document.addEventListener("click", blockNavigation, true);
    document.addEventListener("submit", blockSubmit, true);
    // Tell the editor we're listening so it can send the current (unsaved) colors.
    window.parent.postMessage({ type: "preview-ready" }, window.location.origin);
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("click", blockNavigation, true);
      document.removeEventListener("submit", blockSubmit, true);
    };
  }, []);

  return null;
}
