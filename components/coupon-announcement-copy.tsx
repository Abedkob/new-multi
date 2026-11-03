"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CouponAnnouncementCopy({ code, slug }: { code: string; slug: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" dir="ltr" aria-label={`Copy coupon code ${code}`} className="absolute end-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 rounded-full border border-current/25 bg-background/90 px-2 py-1 text-[11px] font-semibold text-foreground shadow-sm" onClick={async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    sessionStorage.setItem(`coupon:${slug}`, code);
  }}>
    {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
    <span>{copied ? "Code copied" : code}</span>
    <span role="status" className="sr-only">{copied ? "Coupon code copied" : ""}</span>
  </button>;
}
