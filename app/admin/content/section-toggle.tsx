"use client";

import { Switch } from "@/components/ui/switch";
import { resolveMessage, useT } from "@/lib/i18n/context";
import { encodeMessage } from "@/lib/i18n/types";
import type { OptionalSection } from "@/lib/sections";

/**
 * Saves immediately (the section's content is kept either way). The parent owns the value
 * so the live preview can follow it; on a failed save the change is rolled back.
 */
export function SectionToggle({
  section,
  title,
  checked,
  onCheckedChange,
}: {
  section: OptionalSection;
  title: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 text-xs">
      <Switch
        size="sm"
        checked={checked}
        aria-label={resolveMessage(t, encodeMessage("content.editor.showOnStorefront", title))}
        data-testid={`toggle-${section}`}
        onCheckedChange={onCheckedChange}
      />
      <span className="text-muted-foreground">{checked ? t("content.editor.shown") : t("content.editor.hidden")}</span>
    </div>
  );
}
