"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { saveContentAction } from "./actions";
import { SectionToggle } from "./section-toggle";
import { ImageField } from "@/components/image-field";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resolveMessage, useT } from "@/lib/i18n/context";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";
import { encodeMessage } from "@/lib/i18n/types";
import type { ContentKind } from "@/lib/content";
import type { OptionalSection, SectionVisibility } from "@/lib/sections";
import { cn } from "@/lib/utils";

export type ContentField = {
  key: string;
  label: DictionaryKey;
  labelSuffix?: number;
  kind: ContentKind;
  value: string;
  placeholder: string;
};

export type ContentSectionView = {
  id: string;
  title: DictionaryKey;
  description: DictionaryKey;
  optional?: OptionalSection;
  fields: ContentField[];
};

const DEVICES = [
  { id: "desktop", label: "content.editor.device.desktop" satisfies DictionaryKey, width: "100%" },
  { id: "tablet", label: "content.editor.device.tablet" satisfies DictionaryKey, width: "820px" },
  { id: "mobile", label: "content.editor.device.mobile" satisfies DictionaryKey, width: "390px" },
] as const;

const same = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).every((k) => a[k] === b[k]);

export function ContentEditor({
  storeName,
  storeUrl,
  sections,
  initialVisibility,
}: {
  storeName: string;
  /** This store's live URL (custom domain if it has one, else the platform path) — computed
   * server-side since only the server can resolve which one applies. */
  storeUrl: string;
  sections: ContentSectionView[];
  initialVisibility: SectionVisibility;
}) {
  const initialValues = Object.fromEntries(
    sections.flatMap((s) => s.fields.map((f) => [f.key, f.value])),
  );
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [saved, setSaved] = useState<Record<string, string>>(initialValues);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [savedVisibility, setSavedVisibility] = useState(initialVisibility);
  const [openId, setOpenId] = useState<string | null>(sections[2]?.id ?? null);
  const [view, setView] = useState<"home" | "product">("home");
  const [device, setDevice] = useState<(typeof DEVICES)[number]["id"]>("desktop");
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const [pending, startTransition] = useTransition();
  const t = useT();

  const dirty =
    !same(values, saved) ||
    !same(saved, values) ||
    JSON.stringify(visibility) !== JSON.stringify(savedVisibility);

  // ---- live preview plumbing --------------------------------------------------------------
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ values, visibility, view });
  useEffect(() => {
    latest.current = { values, visibility, view };
  });

  const post = useCallback((message: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);
  const sendState = useCallback(() => {
    post({ type: "preview-state", ...latest.current });
  }, [post]);

  // Every keystroke, switch and page change is streamed to the preview (no reload)...
  useEffect(sendState, [values, visibility, view, sendState]);
  // ...and the preview asks for the current draft whenever it (re)loads.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === "preview-ready") sendState();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sendState]);

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Show the section being edited: right page, scrolled into view. */
  const showInPreview = (sectionId: string) => {
    setView(sectionId === "productPage" ? "product" : "home");
    // "Pages" are linked from the footer; the shop/category/search labels have no home-page
    // spot, so they also point at the footer/navbar.
    const target = sectionId === "pages" ? "footer" : sectionId === "catalog" ? "navbar" : sectionId;
    window.setTimeout(() => post({ type: "preview-scroll", section: target }), 60);
  };

  const openSection = (id: string) => {
    setOpenId(id);
    showInPreview(id);
  };

  const save = () => {
    setMessage(undefined);
    startTransition(async () => {
      const res = await saveContentAction(values, visibility);
      if (res.ok && res.values) {
        setSaved(res.values);
        setValues(res.values);
        setSavedVisibility(visibility);
        setErrors({});
        setMessage({ text: t("content.editor.saved"), error: false });
      } else {
        setErrors(res.fieldErrors ?? {});
        setMessage({ text: res.error ? resolveMessage(t, res.error) : t("content.editor.couldNotSave"), error: true });
        // Open the first section that has a problem.
        const bad = sections.find((s) => s.fields.some((f) => res.fieldErrors?.[f.key]));
        if (bad) setOpenId(bad.id);
      }
    });
  };

  const width = DEVICES.find((d) => d.id === device)!.width;

  return (
    <div className="flex h-screen flex-col bg-muted/40">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background px-4 py-2.5">
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
          <span aria-hidden className="inline-block rtl:-scale-x-100">
            &larr;
          </span>{" "}
          {t("content.editor.dashboardLink")}
        </Link>
        <h1 className="font-semibold">{storeName}</h1>
        <span className="text-sm text-muted-foreground">{t("content.editor.label")}</span>
        <nav className="flex gap-3 text-sm">
          <Link href="/admin/products" className="text-muted-foreground hover:text-foreground">
            {t("nav.products")}
          </Link>
          <Link href="/admin/categories" className="text-muted-foreground hover:text-foreground">
            {t("nav.categories")}
          </Link>
          <Link href="/admin/orders" className="text-muted-foreground hover:text-foreground">
            {t("nav.orders")}
          </Link>
        </nav>
        <div className="ms-auto flex items-center gap-3">
          {dirty && !pending && (
            <span className="text-sm text-amber-600 dark:text-amber-400">{t("content.editor.unsavedChanges")}</span>
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
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline underline-offset-4"
          >
            {t("content.editor.viewLiveStorefront")}
          </a>
          <Button onClick={save} disabled={!dirty || pending}>
            {pending ? t("content.editor.saving") : t("content.editor.saveContent")}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[26rem] shrink-0 overflow-y-auto border-e bg-background">
          <p className="border-b p-4 text-xs text-muted-foreground">{t("content.editor.sidebarIntro")}</p>
          {sections.map((s, i) => {
            const open = openId === s.id;
            const sectionHasError = s.fields.some((f) => errors[f.key]?.length);
            return (
              <section
                key={s.id}
                data-section-editor={s.id}
                className="border-b"
                onFocusCapture={() => showInPreview(s.id)}
              >
                <div className="flex items-center gap-2 px-4 py-2.5">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => (open ? setOpenId(null) : openSection(s.id))}
                    className="flex flex-1 items-center gap-2 text-start text-sm font-medium"
                  >
                    <span
                      aria-hidden
                      className={cn("text-xs text-muted-foreground transition", open && "rotate-90")}
                    >
                      &#9654;
                    </span>
                    <span>
                      {i + 1}. {t(s.title)}
                    </span>
                    {sectionHasError && (
                      <span className="size-2 rounded-full bg-destructive" title={t("content.editor.needsAttention")} />
                    )}
                  </button>
                  {s.optional && (
                    <SectionToggle
                      section={s.optional}
                      title={t(s.title)}
                      checked={visibility[s.optional]}
                      onCheckedChange={(next) =>
                        setVisibility((v) => ({ ...v, [s.optional!]: next }))
                      }
                    />
                  )}
                </div>

                {/* Kept in the DOM when closed so nothing is lost; just not displayed. */}
                <div className={cn("grid gap-3.5 px-4 pb-5", !open && "hidden")}>
                  <p className="text-xs text-muted-foreground">{t(s.description)}</p>
                  {s.fields.map((f) => {
                    const id = `content:${f.key}`;
                    const fieldErrors = errors[f.key];
                    const common = {
                      id,
                      name: id,
                      value: values[f.key] ?? "",
                      placeholder: f.placeholder,
                      "aria-invalid": !!fieldErrors?.length,
                      onChange: (
                        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
                      ) => setValues((v) => ({ ...v, [f.key]: e.target.value })),
                    };
                    return (
                      <div key={f.key} className="grid gap-1">
                        <Label htmlFor={id} className="text-xs">
                          {t(f.label)}
                          {f.labelSuffix !== undefined ? ` ${f.labelSuffix}` : ""}
                        </Label>
                        {f.kind === "textarea" ? (
                          <Textarea rows={3} {...common} />
                        ) : f.kind === "image" ? (
                          <ImageField
                            id={id}
                            name={id}
                            value={values[f.key] ?? ""}
                            placeholder={f.placeholder}
                            invalid={!!fieldErrors?.length}
                            onChange={(url) => {
                              setErrors((e) => ({ ...e, [f.key]: undefined }));
                              setValues((v) => ({ ...v, [f.key]: url }));
                            }}
                          />
                        ) : (
                          <Input {...common} />
                        )}
                        {fieldErrors?.map((e) => (
                          <p key={e} className="text-xs text-destructive">
                            {resolveMessage(t, e)}
                          </p>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b bg-background px-4 py-2">
            <span className="text-sm font-medium">{t("content.editor.livePreview")}</span>
            <Segmented
              className="w-56"
              value={view}
              onChange={(v) => setView(v as "home" | "product")}
              options={[
                { id: "home", label: t("content.editor.homepage") },
                { id: "product", label: t("content.editor.productPage") },
              ]}
            />
            <Segmented
              className="w-56"
              value={device}
              onChange={(v) => setDevice(v as (typeof DEVICES)[number]["id"])}
              options={DEVICES.map((d) => ({ id: d.id, label: t(d.label) }))}
            />
            <span className="text-xs text-muted-foreground">{t("content.editor.templateColorsNote")}</span>
          </div>
          <div className="flex min-h-0 flex-1 justify-center overflow-auto p-4">
            <div
              className="h-full overflow-hidden rounded-xl border bg-background shadow-sm transition-[width] duration-300"
              style={{ width, maxWidth: "100%" }}
            >
              <iframe
                ref={iframeRef}
                src="/admin/preview"
                title={resolveMessage(t, encodeMessage("content.editor.livePreviewOf", storeName))}
                className="h-full w-full border-0"
                onLoad={sendState}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
