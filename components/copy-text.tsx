"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A value shown in monospace with a Copy button — DNS record values, sitemap URLs, IDs. */
export function CopyText({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={cn("inline-flex max-w-full items-center gap-2", className)}>
      <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs select-all">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 text-xs"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard blocked (insecure origin / permissions): the value is still select-all.
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  );
}
