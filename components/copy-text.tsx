"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A value shown in monospace with a Copy button — DNS record values, sitemap URLs, IDs.
 *
 * `flex-1` on the code, and `overflow-hidden` on the wrapper, because `min-w-0 truncate` alone
 * was not enough and the symptom was the whole admin scrolling sideways on a phone. A store URL
 * has no break opportunity in it, so the element still contributed 307px of min-content inside a
 * 343px column — enough, with the Copy button beside it, to push the document to 412px wide at a
 * 375px viewport. Every screen scrolled horizontally because of one panel on the dashboard.
 *
 * `w-0 flex-1` is the pair that works. `flex-1` alone sets a zero flex BASIS, which the browser
 * still ignored when sizing the container intrinsically — measured at 307px of contribution with
 * `min-w-0 flex-1 truncate` all applied. An explicit `width: 0` leaves nothing to contribute, and
 * `flex-1` then grows it into whatever space the row has. `min-w-0` stays — it is what lets
 * `truncate` clip rather than overflow.
 *
 * Not something `verify:admin-ui` can catch: it reads class names, and every class here was
 * already a reasonable one. §11's "no horizontal page scroll" needs a browser at 375px.
 */
export function CopyText({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={cn("inline-flex max-w-full items-center gap-2 overflow-hidden", className)}>
      <code className="w-0 min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs select-all">
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
