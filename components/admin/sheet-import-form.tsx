"use client";

import { useRef, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";

import { SectionCard } from "@/components/admin/section-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { MAX_IMPORT_FILE_BYTES } from "@/lib/catalogue-sheet/upload";
import { resolveMessage, useT } from "@/lib/i18n/context";
import { encodeMessage } from "@/lib/i18n/types";
import { cn } from "@/lib/utils";

/**
 * Upload → preview → apply, for both sheets.
 *
 * One component, two modes, because the *shape* of the job is identical and only the verdicts
 * differ: choose a file, read what it would do, decide, see what it did. The two screens that use
 * it name different capabilities, which is why they are two screens — a single page can only name
 * one, and gating it at `products:write` would put the stock sheet out of a staff member's reach
 * entirely.
 *
 * **The preview is mandatory**, and that is the mitigation for matching by name. There is no path
 * from a file to a write without the counts and the created names on screen first, because a
 * rename is invisible in a spreadsheet and obvious in "3 will be created".
 *
 * Nothing is stored between the two steps. The parsed rows live in this component's state, and the
 * spreadsheet's bytes are discarded as soon as the preview returns — they could not be stored
 * anyway: `lib/storage.ts` is magic-byte gated to four raster formats, which is correct and not
 * worth widening for this.
 */

type Message = { row: number; message: string };

/** The dictionary-typed `t` the hook returns, so every key below is checked at compile time. */
type Translate = ReturnType<typeof useT>;

export type CatalogueMode = {
  mode: "catalogue";
  /** Absent on the stock screen: its one download is the count sheet itself. */
  templateHref?: string;
  exportHref: string;
  preview: (formData: FormData) => Promise<CataloguePreview>;
  apply: (payload: CataloguePayloadShape) => Promise<CatalogueApply>;
};

export type StockMode = {
  mode: "stock";
  templateHref?: string;
  exportHref: string;
  preview: (formData: FormData) => Promise<StockPreview>;
  apply: (payload: StockPayloadShape) => Promise<StockApply>;
};

type CataloguePayloadShape = { products: unknown[]; variants: unknown[] };
type StockPayloadShape = { rows: unknown[]; importId: string; reference: string };

type CataloguePreview =
  | { error: string }
  | {
      rows: CataloguePayloadShape;
      truncated: boolean;
      plan: {
        products: { row: number; name: string; verdict: string; reason?: string }[];
        newCategories: string[];
        issues: Message[];
        ignoredStock: { row: number; productName: string; stock: number }[];
        keptVariants: { productName: string; label: string }[];
        counts: Record<string, number>;
      };
    };

type CatalogueApply =
  | { error: string }
  | {
      outcome: {
        created: number;
        updated: number;
        unchanged: number;
        skipped: Message[];
        categoriesCreated: string[];
        stoppedAfterRow?: number;
        stopReason?: string;
      };
    };

type StockPreview =
  | { error: string }
  | {
      rows: unknown[];
      truncated: boolean;
      plan: {
        lines: { row: number; label: string; counted: number; onHand: number }[];
        issues: Message[];
        chunks: number;
      };
    };

type StockApply =
  | { error: string }
  | {
      outcome: {
        counted: number;
        moved: number;
        batchIds: string[];
        skipped: Message[];
        stoppedAfterRow?: number;
        stopReason?: string;
      };
    };

const KB = 1024;

export function SheetImportForm(props: CatalogueMode | StockMode) {
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<CataloguePreview | StockPreview | null>(null);
  const [applied, setApplied] = useState<CatalogueApply | StockApply | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // One id per previewed file, so a double-tapped Apply on the stock sheet is answered by the
  // (tenantId, submissionId) unique index instead of counting the shelf twice.
  const [importId, setImportId] = useState<string>(() => crypto.randomUUID());

  const say = (message: string) => resolveMessage(t, message);

  const reset = () => {
    setPreview(null);
    setApplied(null);
    setError(null);
  };

  const onPreview = (formData: FormData) => {
    reset();
    const file = formData.get("file");
    setFileName(file instanceof File ? file.name : null);
    start(async () => {
      const result =
        props.mode === "catalogue" ? await props.preview(formData) : await props.preview(formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setImportId(crypto.randomUUID());
      setPreview(result);
    });
  };

  const onApply = () => {
    if (!preview || "error" in preview) return;
    setError(null);
    start(async () => {
      if (props.mode === "catalogue") {
        const result = await props.apply((preview as Extract<CataloguePreview, { rows: unknown }>).rows);
        if ("error" in result) setError(result.error);
        else setApplied(result);
      } else {
        const result = await props.apply({
          rows: (preview as Extract<StockPreview, { rows: unknown }>).rows as unknown[],
          importId,
          reference: `${t("import.reference")}${fileName ? ` — ${fileName}` : ""}`.slice(0, 160),
        });
        if ("error" in result) setError(result.error);
        else setApplied(result);
      }
      // The catalogue has changed under the list behind this screen.
      formRef.current?.reset();
    });
  };

  const done = applied && !("error" in applied) ? applied.outcome : null;
  const plan = preview && !("error" in preview) ? preview.plan : null;

  return (
    <div className="grid gap-4">
      <SectionCard
        title={t("import.upload.title")}
        description={t("import.upload.description")}
        icon={FileSpreadsheet}
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {props.templateHref ? (
              <a href={props.templateHref} className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
                <Download className="size-4" aria-hidden />
                {t("import.downloadTemplate")}
              </a>
            ) : null}
            <a href={props.exportHref} className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
              <Download className="size-4" aria-hidden />
              {props.mode === "catalogue" ? t("import.exportCatalogue") : t("import.exportCount")}
            </a>
          </div>
          <p className="text-muted-foreground text-sm">
            {/* The strongest advice this screen can give, so it is given before the file input. */}
            {t("import.startFromExport")}
          </p>

          <form
            ref={formRef}
            action={onPreview}
            className="grid gap-3 rounded-md border border-dashed p-4"
          >
            <label className="grid gap-2 text-sm font-medium" htmlFor="sheet-import-file">
              {t("import.chooseFile")}
              <input
                id="sheet-import-file"
                name="file"
                type="file"
                accept=".xlsx,.xlsm,.csv,.tsv"
                required
                onChange={reset}
                className="text-muted-foreground file:bg-secondary file:text-secondary-foreground block w-full cursor-pointer rounded-md border text-sm file:cursor-pointer file:border-0 file:px-3 file:py-2 file:text-sm file:font-medium"
              />
            </label>
            <p className="text-muted-foreground text-xs">
              {say(encodeMessage("import.fileHint", Math.round(MAX_IMPORT_FILE_BYTES / KB / KB)))}
            </p>
            <div>
              <Button type="submit" disabled={pending} className="gap-2">
                <Upload className="size-4" aria-hidden />
                {pending ? t("import.checking") : t("import.check")}
              </Button>
            </div>
          </form>

          {error ? (
            <p className="text-destructive flex items-start gap-2 text-sm" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{say(error)}</span>
            </p>
          ) : null}
        </div>
      </SectionCard>

      {plan && preview && !("error" in preview) && !done ? (
        <SectionCard
          title={t("import.preview.title")}
          description={t("import.preview.description")}
          actions={
            <Button onClick={onApply} disabled={pending}>
              {pending ? t("import.applying") : t("import.apply")}
            </Button>
          }
        >
          <div className="grid gap-4">
            {preview.truncated ? (
              <Note tone="warn">{t("import.truncated")}</Note>
            ) : null}

            {props.mode === "catalogue" && "counts" in plan ? (
              <CataloguePlanBody plan={plan} t={t} say={say} />
            ) : null}
            {props.mode === "stock" && "lines" in plan ? (
              <StockPlanBody plan={plan} t={t} say={say} />
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {done ? (
        <SectionCard title={t("import.done.title")} icon={CheckCircle2}>
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {"created" in done ? (
                <>
                  <Figure label={t("import.created")} value={done.created} />
                  <Figure label={t("import.updated")} value={done.updated} />
                  <Figure label={t("import.unchanged")} value={done.unchanged} />
                </>
              ) : (
                <>
                  <Figure label={t("import.counted")} value={done.counted} />
                  <Figure label={t("import.movedShelves")} value={done.moved} />
                </>
              )}
            </div>
            {"categoriesCreated" in done && done.categoriesCreated.length > 0 ? (
              <Listing title={t("import.categoriesCreated")} items={done.categoriesCreated} />
            ) : null}
            {done.stoppedAfterRow !== undefined ? (
              <Note tone="warn">
                {say(encodeMessage("import.stoppedAt", done.stoppedAfterRow))}{" "}
                {done.stopReason ? say(done.stopReason) : null}
              </Note>
            ) : null}
            {done.skipped.length > 0 ? <Rows title={t("import.skipped")} rows={done.skipped} say={say} /> : null}
            <p className="text-muted-foreground text-sm">{t("import.reimportSafe")}</p>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}

function CataloguePlanBody({
  plan,
  t,
  say,
}: {
  plan: Extract<CataloguePreview, { rows: unknown }>["plan"];
  t: Translate;
  say: (message: string) => string;
}) {
  const created = plan.products.filter((p) => p.verdict === "create");
  // The skipped figure is the length of the list below it, not `counts.skip`.
  //
  // They are not the same number, and the browser walk caught it reading "0 to skip" directly
  // above a list headed "Rows that will be skipped" with one row in it. `counts.skip` counts
  // PLANNED products the resolver refused; a malformed price is dropped by the parser before a
  // planned row exists, so it never reaches that tally. Two defensible definitions, one screen,
  // and contradictory numbers — the same fault as a field that gives two verdicts at once. Derived
  // from the same array the list renders, so the two cannot drift again.
  const willSkip = plan.issues.length;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <Figure label={t("import.willCreate")} value={plan.counts.create ?? 0} />
        <Figure label={t("import.willUpdate")} value={plan.counts.update ?? 0} />
        <Figure label={t("import.willLeave")} value={plan.counts.unchanged ?? 0} />
        <Figure label={t("import.willSkip")} value={willSkip} />
      </div>

      {/* The created names, listed rather than counted. A rename is invisible in a spreadsheet and
          obvious here, and this list is the only place a merchant can catch one before it happens. */}
      {created.length > 0 ? (
        <Listing title={t("import.newProducts")} items={created.map((p) => p.name)} />
      ) : null}
      {plan.newCategories.length > 0 ? (
        <Listing title={t("import.newCategories")} items={plan.newCategories} />
      ) : null}
      {plan.keptVariants.length > 0 ? (
        <Listing
          title={t("import.keptOptions")}
          note={t("import.keptOptionsNote")}
          items={plan.keptVariants.map((v) => `${v.productName} — ${v.label}`)}
        />
      ) : null}
      {plan.ignoredStock.length > 0 ? (
        <Listing
          title={t("import.ignoredStock")}
          note={t("import.ignoredStockNote")}
          items={plan.ignoredStock.map((i) => `${t("import.row")} ${i.row}: ${i.productName} (${i.stock})`)}
        />
      ) : null}
      {plan.issues.length > 0 ? <Rows title={t("import.problems")} rows={plan.issues} say={say} /> : null}
    </div>
  );
}

function StockPlanBody({
  plan,
  t,
  say,
}: {
  plan: Extract<StockPreview, { rows: unknown }>["plan"];
  t: Translate;
  say: (message: string) => string;
}) {
  const differing = plan.lines.filter((line) => line.counted !== line.onHand);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <Figure label={t("import.linesCounted")} value={plan.lines.length} />
        <Figure label={t("import.linesDiffering")} value={differing.length} />
        <Figure label={t("import.documents")} value={plan.chunks} />
        {/* Same rule as the catalogue sheet: the figure is the length of the list below it. */}
        <Figure label={t("import.willSkip")} value={plan.issues.length} />
      </div>
      {differing.length > 0 ? (
        <div className="grid gap-1">
          <p className="text-sm font-medium">{t("import.whatChanges")}</p>
          <ul className="text-muted-foreground grid gap-1 text-sm">
            {differing.slice(0, 50).map((line) => (
              <li key={`${line.row}-${line.label}`}>
                {line.label}: {line.onHand} → {line.counted}
              </li>
            ))}
          </ul>
          {differing.length > 50 ? (
            <p className="text-muted-foreground text-xs">
              {say(encodeMessage("import.andMore", differing.length - 50))}
            </p>
          ) : null}
        </div>
      ) : null}
      {plan.issues.length > 0 ? <Rows title={t("import.problems")} rows={plan.issues} say={say} /> : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <span className="grid">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </span>
  );
}

function Listing({ title, items, note }: { title: string; items: string[]; note?: string }) {
  return (
    <div className="grid gap-1">
      <p className="text-sm font-medium">{title}</p>
      {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
      <ul className="text-muted-foreground grid gap-1 text-sm">
        {items.slice(0, 50).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {items.length > 50 ? (
        <p className="text-muted-foreground text-xs">+{items.length - 50}</p>
      ) : null}
    </div>
  );
}

function Rows({
  title,
  rows,
  say,
}: {
  title: string;
  rows: Message[];
  say: (message: string) => string;
}) {
  return (
    <div className="grid gap-1">
      <p className="text-sm font-medium">{title}</p>
      <ul className="grid gap-1 text-sm">
        {rows.slice(0, 50).map((row, index) => (
          <li key={`${row.row}-${index}`} className="text-muted-foreground">
            {/* The row number is the whole value of a complaint: a merchant fixes a line, not a
                category of mistake. A problem about the file as a whole carries row 0 and is shown
                without one. */}
            {row.row > 0 ? <span className="text-foreground font-medium tabular-nums">{row.row}. </span> : null}
            {say(row.message)}
          </li>
        ))}
      </ul>
      {rows.length > 50 ? <p className="text-muted-foreground text-xs">+{rows.length - 50}</p> : null}
    </div>
  );
}

function Note({ tone, children }: { tone: "warn"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-md border border-dashed p-3 text-sm",
        tone === "warn" && "text-foreground",
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
