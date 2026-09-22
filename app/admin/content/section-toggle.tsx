"use client";

import { useState, useTransition } from "react";
import { setSectionVisibilityAction } from "./actions";
import { Switch } from "@/components/ui/switch";
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
  return (
    <div className="flex items-center gap-2 text-xs">
      <Switch
        size="sm"
        checked={checked}
        aria-label={`Show ${title} on your storefront`}
        data-testid={`toggle-${section}`}
        onCheckedChange={onCheckedChange}
      />
      <span className="text-muted-foreground">{checked ? "Shown" : "Hidden"}</span>
    </div>
  );
}
