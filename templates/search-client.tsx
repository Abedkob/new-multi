"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchUrl, useSuggestions, type Suggestion } from "./nav-client";

/**
 * The navbar search icon. Instead of jumping to the search page it opens a search panel, and
 * every template gets its own kind of panel (its `look`), so no two stores share one:
 *   muse    - a rounded card springs down from the top; serif field; photo-card suggestions
 *   kinetic - full-screen takeover, a circle wiping open from the icon; giant type
 *   drop    - a hard-edged bar snaps down; heavy uppercase field; neon block underline
 *   atlas   - a monospace command palette unrolling like a blind; numbered results
 *   tonkic  - a spring-popped modal; gradient-ringed pill field; result grid
 *   pearl   - a drawer from the right; tracked uppercase; tall product images
 * All share the behaviour: the field is focused at once, suggestions arrive as the shopper
 * types, Enter opens the search page, and Escape / × / the backdrop close it (focus returns to
 * the icon). Rendered into the store's theme scope (like StoreMenu) so it keeps theme colours.
 */
export type SearchLook = "muse" | "kinetic" | "drop" | "atlas" | "tonkic" | "pearl";

type PanelProps = {
  q: string;
  setQ: (q: string) => void;
  /** Already filtered to "only while there's a term". */
  suggestions: Suggestion[];
  placeholder: string;
  buttonLabel: string;
  basePath: string;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
  /** Called when a suggestion is followed. */
  onPick: () => void;
  /** Viewport center of the icon, for looks that open from it. */
  origin: { x: number; y: number };
};

const ease = [0.16, 1, 0.3, 1] as const;

export function SearchToggle({
  look,
  slug,
  basePath,
  placeholder,
  buttonLabel,
  className,
  children,
}: {
  look: SearchLook;
  /** For the suggestions fetch (/api/store/[slug]/search), always reached by the real slug. */
  slug: string;
  /** "" once the store has its own domain, else "/store/[slug]" — see templates/types.ts. */
  basePath: string;
  placeholder: string;
  buttonLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<Element | null>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [q, setQ] = useState("");
  const suggestions = useSuggestions(slug, q);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const Panel = PANELS[look];
  const props: PanelProps = {
    q,
    setQ,
    suggestions: q.trim() ? suggestions : [],
    placeholder,
    buttonLabel,
    basePath,
    origin,
    onClose: close,
    onPick: () => setOpen(false),
    onSubmit: (e) => {
      e.preventDefault();
      setOpen(false);
      router.push(searchUrl(basePath, q));
    },
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={buttonLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="search-toggle"
        onClick={() => {
          const el = button.current;
          const r = el?.getBoundingClientRect();
          if (r) setOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
          setHost(el?.closest("[data-theme-scope]") ?? document.body);
          setOpen(true);
        }}
        className={className}
      >
        {children}
      </button>
      {host && createPortal(<AnimatePresence>{open && <Panel key="search" {...props} />}</AnimatePresence>, host)}
    </>
  );
}

/* ------------------------------------------------------------------ shared bits */

const dialog = (label: string) =>
  ({ role: "dialog", "aria-modal": true, "aria-label": label, "data-testid": "search-panel" }) as const;

function Field({ p, className }: { p: PanelProps; className?: string }) {
  return (
    <input
      autoFocus
      type="search"
      name="q"
      value={p.q}
      onChange={(e) => p.setQ(e.target.value)}
      placeholder={p.placeholder}
      aria-label={p.placeholder}
      maxLength={100}
      autoComplete="off"
      data-testid="search-panel-input"
      className={cn("min-w-0 w-full bg-transparent outline-none [&::-webkit-search-cancel-button]:hidden", className)}
    />
  );
}

const Submit = ({ label }: { label: string }) => (
  <button type="submit" className="sr-only">
    {label}
  </button>
);

function Close({ onClose, className }: { onClose: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClose} aria-label="×" className={cn("grid shrink-0 place-items-center transition-transform duration-300", className)}>
      <X className="size-5" />
    </button>
  );
}

function Thumb({ s, className }: { s: Suggestion; className?: string }) {
  return s.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- small remote thumbnail from the suggestions API.
    <img src={s.imageUrl} alt="" className={cn("object-cover", className)} />
  ) : (
    <span className={cn("grid place-items-center bg-secondary text-sm text-muted-foreground", className)}>
      {s.name.charAt(0).toUpperCase()}
    </span>
  );
}

const href = (p: PanelProps, s: Suggestion) => `${p.basePath}/products/${s.slug}`;

function Backdrop({ onClose, className }: { onClose: () => void; className: string }) {
  return (
    <motion.div
      aria-hidden
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className={cn("fixed inset-0 z-[60]", className)}
    />
  );
}

/* ------------------------------------------------------------------ the six looks */

/** Muse: a floating rounded card that springs down; serif field; suggestions as photo cards. */
function MusePanel(p: PanelProps) {
  return (
    <>
      <Backdrop onClose={p.onClose} className="bg-foreground/25 backdrop-blur-md" />
      <motion.div
        {...dialog(p.buttonLabel)}
        initial={{ opacity: 0, y: -40, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -24, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="fixed inset-x-3 top-3 z-[61] mx-auto max-w-2xl rounded-[1.75rem] bg-background p-3 text-foreground shadow-2xl sm:top-6"
      >
        <form role="search" onSubmit={p.onSubmit} className="flex items-center gap-3 rounded-full bg-secondary/60 py-1.5 pl-5 pr-1.5">
          <Search aria-hidden className="size-5 shrink-0 opacity-60" />
          <Field p={p} className="h-12 font-muse text-2xl placeholder:text-foreground/40 sm:text-3xl" />
          <Submit label={p.buttonLabel} />
          <Close onClose={p.onClose} className="size-11 rounded-full bg-primary text-primary-foreground hover:rotate-90" />
        </form>
        {p.suggestions.length > 0 && (
          <ul className="mt-3 flex gap-3 overflow-x-auto px-1 pb-2" data-testid="search-panel-suggestions">
            {p.suggestions.map((s, i) => (
              <motion.li
                key={s.id}
                initial={{ opacity: 0, scale: 0.85, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 24 }}
                className="w-32 shrink-0 sm:w-36"
              >
                <Link href={href(p, s)} onClick={p.onPick} className="group block">
                  <span className="block overflow-hidden rounded-2xl bg-secondary">
                    <Thumb s={s} className="aspect-square w-full transition-transform duration-700 group-hover:scale-110" />
                  </span>
                  <span className="mt-2 line-clamp-2 block px-1 font-muse text-base leading-tight">{s.name}</span>
                </Link>
              </motion.li>
            ))}
          </ul>
        )}
      </motion.div>
    </>
  );
}

/** Kinetic: a full-screen takeover in the primary colour, wiping open as a circle from the icon. */
function KineticPanel(p: PanelProps) {
  const at = `${p.origin.x}px ${p.origin.y}px`;
  return (
    <motion.div
      {...dialog(p.buttonLabel)}
      initial={{ clipPath: `circle(0px at ${at})` }}
      animate={{ clipPath: `circle(150vmax at ${at})` }}
      exit={{ clipPath: `circle(0px at ${at})` }}
      transition={{ duration: 0.7, ease: [0.7, 0, 0.2, 1] }}
      className="fixed inset-0 z-[61] overflow-y-auto bg-primary text-primary-foreground"
    >
      <div className="mx-auto flex min-h-full max-w-6xl flex-col px-5 py-6 sm:px-10 sm:py-10">
        <div className="flex justify-end">
          <Close onClose={p.onClose} className="size-12 rounded-full border border-primary-foreground/30 hover:rotate-90 hover:bg-primary-foreground hover:text-primary" />
        </div>
        <form role="search" onSubmit={p.onSubmit} className="mt-[8vh]">
          <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3, duration: 0.7, ease }}>
            <Field
              p={p}
              className="h-auto py-2 text-[clamp(2.5rem,8vw,6.5rem)] font-black leading-none tracking-[-0.05em] placeholder:text-primary-foreground/30"
            />
          </motion.div>
          <motion.span
            aria-hidden
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.45, duration: 0.9, ease }}
            className="mt-4 block h-1 origin-left bg-accent"
          />
          <Submit label={p.buttonLabel} />
        </form>
        {p.suggestions.length > 0 && (
          <ol className="mt-10 grid gap-1" data-testid="search-panel-suggestions">
            {p.suggestions.map((s, i) => (
              <motion.li key={s.id} initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.06, duration: 0.6, ease }}>
                <Link
                  href={href(p, s)}
                  onClick={p.onPick}
                  className="group flex items-center gap-5 border-b border-primary-foreground/15 py-4"
                >
                  <span className="w-8 text-sm tabular-nums opacity-50">{String(i + 1).padStart(2, "0")}</span>
                  <Thumb s={s} className="size-14 rounded-2xl" />
                  <span className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight transition-transform duration-500 group-hover:translate-x-3 sm:text-4xl">
                    {s.name}
                  </span>
                  <ArrowUpRight aria-hidden className="size-6 opacity-0 transition-all duration-500 group-hover:rotate-45 group-hover:opacity-100" />
                </Link>
              </motion.li>
            ))}
          </ol>
        )}
      </div>
    </motion.div>
  );
}

/** Drop: a hard-edged bar that snaps down; heavy uppercase field; neon block underline. */
function DropPanel(p: PanelProps) {
  return (
    <>
      <Backdrop onClose={p.onClose} className="bg-foreground/70" />
      <motion.div
        {...dialog(p.buttonLabel)}
        initial={{ y: "-100%" }}
        animate={{ y: 0 }}
        exit={{ y: "-100%" }}
        transition={{ duration: 0.22, ease: [0.5, 0, 0, 1] }}
        className="fixed inset-x-0 top-0 z-[61] max-h-[85vh] overflow-y-auto border-b-4 border-foreground bg-background text-foreground"
      >
        <form role="search" onSubmit={p.onSubmit} className="mx-auto flex max-w-[1400px] items-center gap-4 px-5 pb-2 pt-8 sm:px-8 sm:pt-12">
          <div className="relative min-w-0 flex-1">
            <Field p={p} className="h-14 text-3xl font-black uppercase tracking-tight placeholder:text-foreground/25 sm:h-20 sm:text-6xl" />
            <motion.span
              aria-hidden
              initial={{ width: 0 }}
              animate={{ width: "100%" }}
              transition={{ delay: 0.18, duration: 0.35, ease: [0.5, 0, 0, 1] }}
              className="absolute -bottom-1 left-0 h-2 bg-accent"
            />
          </div>
          <Submit label={p.buttonLabel} />
          <Close onClose={p.onClose} className="size-12 bg-primary text-primary-foreground hover:rotate-90" />
        </form>
        <div className="mx-auto max-w-[1400px] px-5 pb-8 pt-6 sm:px-8">
          {p.suggestions.length > 0 && (
            <ul className="border-t border-border" data-testid="search-panel-suggestions">
              {p.suggestions.map((s, i) => (
                <motion.li key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05, duration: 0.15 }}>
                  <Link
                    href={href(p, s)}
                    onClick={p.onPick}
                    className="flex items-center gap-4 border-b border-border px-2 py-3 text-lg font-black uppercase tracking-tight transition-colors hover:bg-accent hover:text-accent-foreground sm:text-2xl"
                  >
                    <Thumb s={s} className="size-12 bg-secondary" />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <ArrowUpRight aria-hidden className="size-5" />
                  </Link>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    </>
  );
}

/** Atlas: a monospace command palette that unrolls like a blind; numbered results. */
function AtlasPanel(p: PanelProps) {
  return (
    <>
      <Backdrop onClose={p.onClose} className="bg-background/75" />
      <motion.div
        {...dialog(p.buttonLabel)}
        initial={{ clipPath: "inset(0 0 100% 0)" }}
        animate={{ clipPath: "inset(0 0 0% 0)" }}
        exit={{ clipPath: "inset(0 0 100% 0)" }}
        transition={{ duration: 0.4, ease: [0.7, 0, 0.2, 1] }}
        className="fixed inset-x-3 top-[10vh] z-[61] mx-auto max-w-xl border border-foreground bg-background text-foreground shadow-[8px_8px_0_0_var(--color-text)]"
      >
        <form role="search" onSubmit={p.onSubmit} className="flex items-center gap-3 border-b border-foreground px-4">
          <span aria-hidden className="font-mono text-sm text-accent">
            &gt;
          </span>
          <Field p={p} className="h-14 font-mono text-sm uppercase caret-accent placeholder:normal-case placeholder:text-muted-foreground" />
          <Submit label={p.buttonLabel} />
          <Close onClose={p.onClose} className="-mr-2 size-10 hover:bg-foreground hover:text-background" />
        </form>
        {p.suggestions.length > 0 && (
          <ol data-testid="search-panel-suggestions">
            {p.suggestions.map((s, i) => (
              <motion.li
                key={s.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.03 * i, duration: 0.2 }}
                className="border-b border-border last:border-b-0"
              >
                <Link
                  href={href(p, s)}
                  onClick={p.onPick}
                  className="grid grid-cols-[2rem_2.5rem_1fr] items-center gap-3 px-4 py-2.5 font-mono text-xs uppercase transition-colors hover:bg-foreground hover:text-background"
                >
                  <span className="tabular-nums opacity-60">{String(i + 1).padStart(2, "0")}</span>
                  <Thumb s={s} className="size-10 border border-border" />
                  <span className="truncate">{s.name}</span>
                </Link>
              </motion.li>
            ))}
          </ol>
        )}
      </motion.div>
    </>
  );
}

/** Tonkic: a centred modal that pops with a spring; gradient-ringed pill field; result grid. */
function TonkicPanel(p: PanelProps) {
  return (
    <>
      <Backdrop onClose={p.onClose} className="bg-foreground/40 backdrop-blur-sm" />
      <motion.div
        {...dialog(p.buttonLabel)}
        initial={{ opacity: 0, scale: 0.8, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: "spring", stiffness: 380, damping: 24 }}
        className="fixed inset-x-3 top-[12vh] z-[61] mx-auto max-w-lg rounded-3xl bg-background p-4 text-foreground shadow-2xl sm:p-5"
      >
        <form role="search" onSubmit={p.onSubmit} className="flex items-center gap-2">
          <div className="min-w-0 flex-1 rounded-full bg-gradient-to-r from-primary via-accent to-primary p-[2px]">
            <div className="flex items-center gap-3 rounded-full bg-background px-4">
              <Search aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              <Field p={p} className="h-12 text-base" />
            </div>
          </div>
          <Submit label={p.buttonLabel} />
          <Close onClose={p.onClose} className="size-12 rounded-full bg-muted hover:rotate-90" />
        </form>
        {p.suggestions.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-3" data-testid="search-panel-suggestions">
            {p.suggestions.map((s, i) => (
              <motion.li
                key={s.id}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05, type: "spring", stiffness: 420, damping: 22 }}
              >
                <Link
                  href={href(p, s)}
                  onClick={p.onPick}
                  className="flex items-center gap-3 rounded-2xl border border-border p-2 transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <Thumb s={s} className="size-12 rounded-xl" />
                  <span className="line-clamp-2 min-w-0 text-sm font-semibold">{s.name}</span>
                </Link>
              </motion.li>
            ))}
          </ul>
        )}
      </motion.div>
    </>
  );
}

/** Pearl: a department-store drawer from the right; tracked uppercase; tall product images. */
function PearlPanel(p: PanelProps) {
  return (
    <>
      <Backdrop onClose={p.onClose} className="bg-foreground/30" />
      <motion.div
        {...dialog(p.buttonLabel)}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
        className="fixed inset-y-0 right-0 z-[61] flex w-full max-w-md flex-col bg-background text-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <span className="text-[11px] font-medium uppercase tracking-[0.3em]">{p.buttonLabel}</span>
          <Close onClose={p.onClose} className="-mr-2 size-10 hover:rotate-90" />
        </div>
        <form role="search" onSubmit={p.onSubmit} className="px-6 pt-8">
          <div className="relative">
            <Field p={p} className="h-12 text-lg tracking-wide placeholder:text-xs placeholder:uppercase placeholder:tracking-[0.25em] placeholder:text-muted-foreground" />
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-border" />
            <motion.span
              aria-hidden
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.35, duration: 0.8, ease }}
              className="absolute inset-x-0 bottom-0 h-px origin-right bg-foreground"
            />
          </div>
          <Submit label={p.buttonLabel} />
        </form>
        <div className="flex-1 overflow-y-auto px-6 py-8">
          {p.suggestions.length > 0 && (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-6" data-testid="search-panel-suggestions">
              {p.suggestions.map((s, i) => (
                <motion.li key={s.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 * i, duration: 0.5, ease }}>
                  <Link href={href(p, s)} onClick={p.onPick} className="group block">
                    <span className="block overflow-hidden bg-secondary">
                      <Thumb s={s} className="aspect-[3/4] w-full transition-transform duration-700 group-hover:scale-105" />
                    </span>
                    <span className="mt-2 line-clamp-2 block text-[11px] uppercase tracking-[0.15em]">{s.name}</span>
                  </Link>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    </>
  );
}

const PANELS: Record<SearchLook, (p: PanelProps) => ReactNode> = {
  muse: MusePanel,
  kinetic: KineticPanel,
  drop: DropPanel,
  atlas: AtlasPanel,
  tonkic: TonkicPanel,
  pearl: PearlPanel,
};
