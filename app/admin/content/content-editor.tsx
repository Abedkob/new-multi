"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { saveContentAction, uploadImageAction } from "./actions";
import { SectionToggle } from "./section-toggle";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ContentKind } from "@/lib/content";
import type { OptionalSection, SectionVisibility } from "@/lib/sections";
import { cn } from "@/lib/utils";

export type ContentField = {
  key: string;
  label: string;
  kind: ContentKind;
  value: string;
  placeholder: string;
};

export type ContentSectionView = {
  id: string;
  title: string;
  description: string;
  optional?: OptionalSection;
  fields: ContentField[];
};

const DEVICES = [
  { id: "desktop", label: "Desktop", width: "100%" },
  { id: "tablet", label: "Tablet", width: "820px" },
  { id: "mobile", label: "Mobile", width: "390px" },
] as const;

const same = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).every((k) => a[k] === b[k]);

export function ContentEditor({
  storeName,
  storeSlug,
  sections,
  initialVisibility,
}: {
  storeName: string;
  storeSlug: string;
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
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const uploadImage = async (key: string, file: File) => {
    setUploadingKey(key);
    setErrors((e) => ({ ...e, [key]: undefined }));
    const formData = new FormData();
    formData.append("file", file);
    const res = await uploadImageAction(formData);
    setUploadingKey(null);
    if (res.url) {
      setValues((v) => ({ ...v, [key]: res.url! }));
    } else {
      setErrors((e) => ({ ...e, [key]: [res.error ?? "Upload failed."] }));
    }
  };

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
        setMessage({ text: "Saved. Your storefront is updated.", error: false });
      } else {
        setErrors(res.fieldErrors ?? {});
        setMessage({ text: res.error ?? "Could not save.", error: true });
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
          &larr; Dashboard
        </Link>
        <h1 className="font-semibold">{storeName}</h1>
        <span className="text-sm text-muted-foreground">Content</span>
        <nav className="flex gap-3 text-sm">
          <Link href="/admin/products" className="text-muted-foreground hover:text-foreground">
            Products
          </Link>
          <Link href="/admin/categories" className="text-muted-foreground hover:text-foreground">
            Categories
          </Link>
          <Link href="/admin/orders" className="text-muted-foreground hover:text-foreground">
            Orders
          </Link>
        </nav>
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
            href={`/store/${storeSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline underline-offset-4"
          >
            View live storefront
          </a>
          <Button onClick={save} disabled={!dirty || pending}>
            {pending ? "Saving..." : "Save content"}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[26rem] shrink-0 overflow-y-auto border-r bg-background">
          <p className="border-b p-4 text-xs text-muted-foreground">
            Edit any section, even while it is switched off. Changes appear in the preview
            straight away; press Save to publish them. Leave a field empty to use its default
            (shown as the placeholder).
          </p>
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
                    className="flex flex-1 items-center gap-2 text-left text-sm font-medium"
                  >
                    <span
                      aria-hidden
                      className={cn("text-xs text-muted-foreground transition", open && "rotate-90")}
                    >
                      &#9654;
                    </span>
                    <span>
                      {i + 1}. {s.title}
                    </span>
                    {sectionHasError && (
                      <span className="size-2 rounded-full bg-destructive" title="Needs attention" />
                    )}
                  </button>
                  {s.optional && (
                    <SectionToggle
                      section={s.optional}
                      title={s.title}
                      checked={visibility[s.optional]}
                      onCheckedChange={(next) =>
                        setVisibility((v) => ({ ...v, [s.optional!]: next }))
                      }
                    />
                  )}
                </div>

                {/* Kept in the DOM when closed so nothing is lost; just not displayed. */}
                <div className={cn("grid gap-3.5 px-4 pb-5", !open && "hidden")}>
                  <p className="text-xs text-muted-foreground">{s.description}</p>
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
                          {f.label}
                        </Label>
                        {f.kind === "textarea" ? (
                          <Textarea rows={3} {...common} />
                        ) : (
                          <Input {...common} />
                        )}
                        {f.kind === "image" && (
                          <div className="flex items-center gap-2">
                            {values[f.key] && (
                              // eslint-disable-next-line @next/next/no-img-element -- tiny admin-only preview, not worth next/image's ceremony here.
                              <img
                                src={values[f.key]}
                                alt=""
                                className="size-9 shrink-0 rounded border object-cover"
                              />
                            )}
                            <input
                              ref={(el) => {
                                fileInputs.current[f.key] = el;
                              }}
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (file) void uploadImage(f.key, file);
                              }}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={uploadingKey === f.key}
                              onClick={() => fileInputs.current[f.key]?.click()}
                            >
                              {uploadingKey === f.key ? "Uploading..." : "Upload image"}
                            </Button>
                          </div>
                        )}
                        {fieldErrors?.map((e) => (
                          <p key={e} className="text-xs text-destructive">
                            {e}
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
            <span className="text-sm font-medium">Live preview</span>
            <Segmented
              className="w-56"
              value={view}
              onChange={(v) => setView(v as "home" | "product")}
              options={[
                { id: "home", label: "Homepage" },
                { id: "product", label: "Product page" },
              ]}
            />
            <Segmented
              className="w-56"
              value={device}
              onChange={(v) => setDevice(v as (typeof DEVICES)[number]["id"])}
              options={DEVICES.map((d) => ({ id: d.id, label: d.label }))}
            />
            <span className="text-xs text-muted-foreground">
              Template and colors are set by your platform admin.
            </span>
          </div>
          <div className="flex min-h-0 flex-1 justify-center overflow-auto p-4">
            <div
              className="h-full overflow-hidden rounded-xl border bg-background shadow-sm transition-[width] duration-300"
              style={{ width, maxWidth: "100%" }}
            >
              <iframe
                ref={iframeRef}
                src="/admin/preview"
                title={`Live preview of ${storeName}`}
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
