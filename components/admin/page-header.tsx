import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Title, one plain-language sentence about the page, and its main actions on the right. */
export function PageHeader({
  title,
  description,
  back,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * Only for overriding the bottom margin. The `mb-6` default is right for a page whose header
   * sits directly above its content; a section layout that already spaces its children with a
   * grid gap passes `mb-0` instead, or the two margins add up.
   */
  className?: string;
}) {
  return (
    <div className={cn("mb-6 grid gap-2", className)}>
      {back && (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 gap-1.5">
          {/* 28px rather than 24px, and it has to stay the largest thing on the screen: a figure
              is `text-2xl`, so at the old size a tile's number tied with the page's own name.
              `tracking-tight` because a semibold sans at this size sets loose by default.
              Only from `sm` up: at 375px "Welcome back, Demo Owner" set at 28px measures 366px
              against 343px of content width and pushed the whole document to 412px — a
              horizontal page scroll on every screen, which §11 forbids. The phone keeps 24px,
              where it already fitted. */}
          <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-[1.75rem]">
            {title}
          </h1>
          {description && (
            // `max-w-prose`, not `max-w-2xl`: a sentence is set to a line length rather than to a
            // width that happens to be near one, so it stays readable as the type scale moves.
            <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
          )}
          {children}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
