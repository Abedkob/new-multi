"use client";

import { useEffect, useRef, useState } from "react";
import { importImageUrlAction, uploadImageAction } from "@/app/admin/content/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const isRemoteLink = (v: string) => /^https?:\/\//i.test(v.trim());

/**
 * Every owner image field: paste a link or upload a file. A pasted http(s) link is copied into our
 * own storage (importImageUrlAction) as soon as it's pasted or the field loses focus, and the
 * field switches to the stored copy; if that fails, the original link stays and is used as-is.
 *
 * `name` goes on the real input, so this also works inside plain FormData forms.
 */
export function ImageField({
  value,
  onChange,
  id,
  name,
  placeholder = "https://... or upload",
  invalid,
  uploadLabel = "Upload image",
  className,
  uploadAction = uploadImageAction,
  importAction = importImageUrlAction,
  ...aria
}: {
  value: string;
  onChange: (url: string) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  invalid?: boolean;
  uploadLabel?: string;
  className?: string;
  /** Defaults to the store owner's actions (tenant from the session). The platform admin passes
   * versions bound to a store instead. */
  uploadAction?: (formData: FormData) => Promise<{ url?: string; error?: string }>;
  importAction?: (link: string) => Promise<{ url?: string; error?: string }>;
  "aria-label"?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "import" | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean }>();

  // What the field holds right now, for dropping results that arrive after the owner moved on
  // (pasted another link, uploaded a file, cleared it).
  const current = useRef(value);
  useEffect(() => {
    current.current = value;
  }, [value]);
  // Links already imported (never redo), and ones that failed: blurring doesn't retry those, but
  // pasting the link again does.
  const tried = useRef(new Set<string>());
  const failed = useRef(new Set<string>());

  const importLink = async (link: string, retry = false) => {
    const url = link.trim();
    if (!isRemoteLink(url) || current.current.trim() !== url) return;
    if (tried.current.has(url) || (failed.current.has(url) && !retry)) return;
    failed.current.delete(url);
    tried.current.add(url);
    setBusy("import");
    setNote({ text: "Copying image to your storage...", error: false });
    try {
      const res = await importAction(url);
      if (current.current.trim() !== url) return;
      if (res.url) {
        tried.current.add(res.url);
        setNote(res.url === url ? undefined : { text: "Image copied to your storage.", error: false });
        if (res.url !== url) onChange(res.url);
      } else {
        tried.current.delete(url);
        failed.current.add(url);
        setNote({ text: `${res.error ?? "Couldn't copy this image."} The link will be used as-is.`, error: true });
      }
    } catch {
      tried.current.delete(url);
      failed.current.add(url);
      if (current.current.trim() === url) {
        setNote({ text: "Couldn't copy this image. The link will be used as-is.", error: true });
      }
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    setBusy("upload");
    setNote(undefined);
    const before = current.current;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await uploadAction(formData);
      if (current.current !== before) return;
      if (res.url) {
        tried.current.add(res.url);
        onChange(res.url);
      } else {
        setNote({ text: res.error ?? "Upload failed.", error: true });
      }
    } catch {
      setNote({ text: "Upload failed. Please try again.", error: true });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cn("grid gap-1.5", className)}>
      <Input
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid}
        aria-label={aria["aria-label"]}
        onChange={(e) => {
          current.current = e.target.value;
          setNote(undefined);
          onChange(e.target.value);
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text").trim();
          // After the paste's onChange has landed; importLink skips it unless the pasted link is
          // now the whole field (i.e. it wasn't pasted into the middle of other text).
          if (isRemoteLink(text)) window.setTimeout(() => void importLink(text, true), 0);
        }}
        onBlur={(e) => void importLink(e.target.value)}
      />
      <div className="flex items-center gap-2">
        {value && (
          // eslint-disable-next-line @next/next/no-img-element -- tiny admin-only preview, not worth next/image's ceremony here.
          <img src={value} alt="" className="size-9 shrink-0 rounded border object-cover" />
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => fileInput.current?.click()}
        >
          {busy === "upload" ? "Uploading..." : uploadLabel}
        </Button>
        {note && (
          <span
            role={note.error ? "alert" : "status"}
            className={cn("text-xs", note.error ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}
          >
            {note.text}
          </span>
        )}
      </div>
    </div>
  );
}
