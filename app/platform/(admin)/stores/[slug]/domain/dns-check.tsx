"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/submit-button";
import { FormError } from "@/components/field";
import type { HostDnsReport } from "@/lib/domain-check";
import { cn } from "@/lib/utils";
import { checkDnsAction, type DnsCheckState } from "../actions";

type Line = { tone: "ok" | "warn" | "bad" | "info"; text: string };

function diagnose(r: HostDnsReport, expectedIp: string | null): Line[] {
  const lines: Line[] = [];
  if (r.error) lines.push({ tone: "warn", text: `DNS lookup problem (${r.error}) — try again in a minute.` });

  if (r.cname) lines.push({ tone: "info", text: `CNAME → ${r.cname}` });
  if (r.a.length === 0) {
    lines.push({ tone: "bad", text: "No A record — this name doesn't point anywhere yet." });
  } else {
    for (const ip of r.a) {
      if (!expectedIp) lines.push({ tone: "info", text: `A → ${ip}` });
      else if (ip === expectedIp) lines.push({ tone: "ok", text: `A → ${ip} (this server)` });
      else lines.push({ tone: "bad", text: `A → ${ip} — not this server (${expectedIp}). Delete or change it.` });
    }
  }
  for (const ip of r.aaaa) {
    lines.push({
      tone: "bad",
      text: `AAAA → ${ip} — delete this IPv6 record unless it is this server's own IPv6 address; otherwise IPv6 visitors and the HTTPS certificate check go somewhere else.`,
    });
  }
  if (r.caa.length > 0 && !r.caa.some((i) => i.includes("letsencrypt.org"))) {
    lines.push({
      tone: "bad",
      text: `CAA allows only ${r.caa.join(", ")} — add a CAA record for letsencrypt.org or the HTTPS certificate can't be issued.`,
    });
  }
  return lines;
}

const TONE: Record<Line["tone"], string> = {
  ok: "text-green-700 dark:text-green-500",
  warn: "text-amber-700 dark:text-amber-500",
  bad: "text-destructive",
  info: "text-muted-foreground",
};
const ICON: Record<Line["tone"], string> = { ok: "✓", warn: "!", bad: "✕", info: "·" };

/** Read-only: asks public DNS what the domain and its www/apex twin point at right now. */
export function DnsCheck({ initialDomain }: { initialDomain: string }) {
  const [state, action] = useActionState<DnsCheckState, FormData>(checkDnsAction, {});

  return (
    <div className="grid gap-4">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <Input
          name="domain"
          defaultValue={initialDomain}
          placeholder="acme.com"
          aria-label="Domain to check"
          className="max-w-xs"
        />
        <SubmitButton pendingText="Checking...">Check DNS</SubmitButton>
      </form>
      <FormError message={state.error} />
      {state.reports && (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="dns-report">
          {state.reports.map((r) => {
            const lines = diagnose(r, state.expectedIp ?? null);
            const good =
              !r.error &&
              r.a.length > 0 &&
              r.aaaa.length === 0 &&
              (!state.expectedIp || r.a.every((ip) => ip === state.expectedIp));
            return (
              <div key={r.hostname} className="grid content-start gap-1.5 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-sm">{r.hostname}</span>
                  <span className={cn("text-xs font-medium", good ? TONE.ok : TONE.bad)}>
                    {good ? "Ready" : "Needs fixing"}
                  </span>
                </div>
                <ul className="grid gap-1 text-xs">
                  {lines.map((l, i) => (
                    <li key={i} className={cn("flex gap-1.5", TONE[l.tone])}>
                      <span aria-hidden className="w-3 shrink-0 text-center">
                        {ICON[l.tone]}
                      </span>
                      <span>{l.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {state.reports && !state.expectedIp && (
        <p className="text-xs text-muted-foreground">
          SERVER_PUBLIC_IP isn&apos;t set, so this can only show where the records point, not
          whether that&apos;s this server.
        </p>
      )}
    </div>
  );
}
