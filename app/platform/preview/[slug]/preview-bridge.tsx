"use client";

import { useEffect } from "react";
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
      const data = e.data as { type?: string; colors?: Record<string, unknown> } | null;
      if (data?.type !== "preview-colors" || !data.colors) return;

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
