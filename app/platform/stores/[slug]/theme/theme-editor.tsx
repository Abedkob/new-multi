"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveThemeAction } from "./actions";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COLOR_SCHEMES,
  THEME_FIELDS,
  hexColorSchema,
  type ThemeColors,
  type ThemeKey,
  type ThemeOverrides,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

type TemplateOption = {
  id: string;
  label: string;
  description: string;
  defaults: ThemeColors;
};

const DEVICES = [
  { id: "desktop", label: "Desktop", width: "100%" },
  { id: "tablet", label: "Tablet", width: "820px" },
  { id: "mobile", label: "Mobile", width: "390px" },
] as const;

const isHex = (v: string) => hexColorSchema.safeParse(v).success;

/** Only the colors that differ from the template's defaults (what gets stored). */
function differing(colors: ThemeColors, defaults: ThemeColors) {
  return THEME_FIELDS.filter(({ key }) => colors[key] !== defaults[key])
    .map(({ key }) => `${key}=${colors[key]}`)
    .join("&");
}

export function ThemeEditor({
  slug,
  storeName,
  templates,
  initialTemplate,
  initialOverrides,
}: {
  slug: string;
  storeName: string;
  templates: TemplateOption[];
  initialTemplate: string;
  initialOverrides: ThemeOverrides;
}) {
  const byId = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const defaultsFor = useCallback((id: string) => byId.get(id)!.defaults, [byId]);

  const [template, setTemplate] = useState(initialTemplate);
  const [overrides, setOverrides] = useState<ThemeOverrides>(initialOverrides);
  // Raw text for fields being typed into (may be an incomplete hex).
  const [typed, setTyped] = useState<Partial<Record<ThemeKey, string>>>({});
  const [view, setView] = useState<"home" | "product">("home");
  const [device, setDevice] = useState<(typeof DEVICES)[number]["id"]>("desktop");
  const [saved, setSaved] = useState({
    template: initialTemplate,
    snapshot: differing(
      { ...defaultsFor(initialTemplate), ...initialOverrides },
      defaultsFor(initialTemplate),
    ),
  });
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean }>();

  const colors: ThemeColors = { ...defaultsFor(template), ...overrides };
  const invalid = THEME_FIELDS.filter(({ key }) => typed[key] !== undefined && !isHex(typed[key]!));
  const dirty =
    template !== saved.template || differing(colors, defaultsFor(template)) !== saved.snapshot;

  // ---- live preview plumbing -------------------------------------------------------------
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const latestColors = useRef(colors);
  useEffect(() => {
    latestColors.current = colors;
  });

  const sendColors = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "preview-colors", colors: latestColors.current },
      window.location.origin,
    );
  }, []);

  // Colors change instantly (no reload)...
  const colorsKey = THEME_FIELDS.map(({ key }) => colors[key]).join(",");
  useEffect(() => {
    latestColors.current = colors;
    sendColors();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colorsKey covers `colors`
  }, [colorsKey, sendColors]);

  // ...and the preview asks for the current colors whenever it (re)loads.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === "preview-ready") sendColors();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sendColors]);

  // Only the template or page changes reload the preview.
  const previewSrc = `/platform/preview/${encodeURIComponent(slug)}?template=${template}&view=${view}`;

  // ---- handlers --------------------------------------------------------------------------
  const setColor = (key: ThemeKey, value: string) => {
    const valid = isHex(value);
    setTyped((t) => {
      const next = { ...t };
      if (valid) delete next[key];
      else next[key] = value;
      return next;
    });
    if (valid) setOverrides((o) => ({ ...o, [key]: value.toLowerCase() }));
  };

  const resetColors = () => {
    setOverrides({});
    setTyped({});
  };

  const applyScheme = (c: ThemeColors) => {
    setOverrides(c);
    setTyped({});
  };

  const save = () => {
    setMessage(undefined);
    startTransition(async () => {
      const res = await saveThemeAction(slug, { templateId: template, colors });
      if (res.ok) {
        setSaved({ template, snapshot: differing(colors, defaultsFor(template)) });
        setMessage({ text: "Saved. The live storefront is updated.", error: false });
      } else {
        setMessage({ text: res.error ?? "Could not save.", error: true });
      }
    });
  };

  const width = DEVICES.find((d) => d.id === device)!.width;
  const current = byId.get(template)!;

  return (
    <div className="flex h-screen flex-col bg-muted/40">
      {/* top bar */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background px-4 py-2.5">
        <Link
          href="/platform/stores"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Stores
        </Link>
        <h1 className="font-semibold">{storeName}</h1>
        <span className="text-sm text-muted-foreground">Template &amp; theme</span>
        <div className="ml-auto flex items-center gap-3">
          {dirty && !pending && (
            <span className="text-sm text-amber-600 dark:text-amber-400">Unsaved changes</span>
          )}
          {message && (
            <span
              role={message.error ? "alert" : "status"}
              className={cn(
                "text-sm",
                message.error ? "text-destructive" : "text-green-700 dark:text-green-500",
              )}
            >
              {message.text}
            </span>
          )}
          <a
            href={`/store/${slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline underline-offset-4"
          >
            Open live storefront
          </a>
          <Button onClick={save} disabled={!dirty || pending || invalid.length > 0}>
            {pending ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* options */}
        <aside className="w-80 shrink-0 overflow-y-auto border-r bg-background p-4">
          <div className="grid gap-7">
            <section className="grid gap-2">
              <Label htmlFor="templateId" className="text-sm font-semibold">
                Template
              </Label>
              <select
                id="templateId"
                value={template}
                disabled={pending}
                onChange={(e) => {
                  setTemplate(e.target.value);
                  setMessage(undefined);
                }}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {current.description} The store&apos;s content, products and section settings
                never change when you switch.
              </p>
            </section>

            <section className="grid gap-3">
              <h2 className="text-sm font-semibold">Colors</h2>
              {THEME_FIELDS.map(({ key, label, hint }) => {
                const shown = typed[key] ?? colors[key];
                const bad = typed[key] !== undefined && !isHex(typed[key]!);
                return (
                  <div key={key} className="grid gap-1">
                    <Label htmlFor={key} className="text-xs">
                      {label}
                      <span className="font-normal text-muted-foreground"> &middot; {hint}</span>
                    </Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label={`${label} color picker`}
                        value={colors[key]}
                        onChange={(e) => setColor(key, e.target.value)}
                        className="h-8 w-11 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                      />
                      <Input
                        id={key}
                        name={key}
                        value={shown}
                        onChange={(e) => setColor(key, e.target.value)}
                        spellCheck={false}
                        aria-invalid={bad}
                        className="w-28 font-mono"
                      />
                    </div>
                    {bad && (
                      <p className="text-xs text-destructive">
                        Use a 6-digit hex color like #1a2b3c
                      </p>
                    )}
                  </div>
                );
              })}

              <div className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">Try a color scheme</span>
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_SCHEMES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => applyScheme(s.colors)}
                      className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                    >
                      <span className="flex">
                        {[s.colors.primaryColor, s.colors.secondaryColor, s.colors.accentColor].map(
                          (c) => (
                            <span
                              key={c}
                              className="-ml-1 size-3 rounded-full border first:ml-0"
                              style={{ background: c }}
                            />
                          ),
                        )}
                      </span>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button type="button" variant="outline" size="sm" onClick={resetColors}>
                Reset to {current.label} defaults
              </Button>
              <p className="text-xs text-muted-foreground">
                Colors left at the default keep following the template if you switch.
              </p>
            </section>

            <section className="grid gap-3">
              <h2 className="text-sm font-semibold">Preview</h2>
              <Segmented
                label="Page"
                value={view}
                onChange={(v) => setView(v as "home" | "product")}
                options={[
                  { id: "home", label: "Homepage" },
                  { id: "product", label: "Product page" },
                ]}
              />
              <Segmented
                label="Device"
                value={device}
                onChange={(v) => setDevice(v as (typeof DEVICES)[number]["id"])}
                options={DEVICES.map((d) => ({ id: d.id, label: d.label }))}
              />
              <p className="text-xs text-muted-foreground">
                Shows the store&apos;s real content and products. Links are disabled in the preview.
              </p>
            </section>
          </div>
        </aside>

        {/* live preview */}
        <main className="flex min-w-0 flex-1 justify-center overflow-auto p-4">
          <div
            className="h-full overflow-hidden rounded-xl border bg-background shadow-sm transition-[width] duration-300"
            style={{ width, maxWidth: "100%" }}
          >
            <iframe
              ref={iframeRef}
              key={previewSrc}
              src={previewSrc}
              title={`Live preview of ${storeName}`}
              className="h-full w-full border-0"
              onLoad={sendColors}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
