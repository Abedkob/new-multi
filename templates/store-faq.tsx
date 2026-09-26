import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FooterLook } from "./store-footer";
import type { StorefrontData } from "./types";

/** Same looks as the Footer (templates/store-footer.tsx); prism reuses "kinetic" here too. */
export type FaqLook = FooterLook;

type FaqStyle = {
  surface: string;
  heading: string;
  border: string;
  accent: string;
};

const FAQ_STYLES: Record<FaqLook, FaqStyle> = {
  minimal: {
    surface: "bg-background text-foreground",
    heading: "text-3xl font-light tracking-tight",
    border: "border-border",
    accent: "text-primary",
  },
  classic: {
    surface: "bg-secondary/40 text-foreground",
    heading: "font-serif text-3xl font-bold",
    border: "border-border",
    accent: "text-primary",
  },
  tonkic: {
    surface: "bg-background text-foreground",
    heading: "text-3xl font-bold tracking-tight",
    border: "border-border",
    accent: "text-primary",
  },
  fashion: {
    surface: "bg-secondary/40 text-foreground",
    heading: "font-serif text-3xl tracking-tight",
    border: "border-border",
    accent: "text-primary",
  },
  luxury: {
    surface: "bg-background text-foreground",
    heading: "font-serif text-4xl",
    border: "border-border",
    accent: "text-accent",
  },
  atelier: {
    surface: "bg-secondary/40 text-foreground",
    heading: "font-serif text-3xl italic tracking-tight",
    border: "border-border",
    accent: "text-accent",
  },
  atlas: {
    surface: "bg-background text-foreground",
    heading: "text-2xl font-bold uppercase tracking-tight",
    border: "border-foreground",
    accent: "text-primary",
  },
  pearl: {
    surface: "bg-secondary/40 text-foreground",
    heading: "font-serif text-3xl",
    border: "border-border",
    accent: "text-primary",
  },
  drop: {
    surface: "bg-background text-foreground",
    heading: "text-3xl font-black uppercase tracking-tight",
    border: "border-border",
    accent: "text-primary",
  },
  kinetic: {
    surface: "bg-secondary/40 text-foreground",
    heading: "text-3xl font-black tracking-[-0.04em]",
    border: "border-border",
    accent: "text-primary",
  },
  mirage: {
    surface: "bg-background text-foreground",
    heading: "text-3xl font-semibold tracking-[-0.04em]",
    border: "border-border",
    accent: "text-primary",
  },
  muse: {
    surface: "bg-secondary/40 text-foreground",
    heading: "font-muse text-4xl",
    border: "border-border",
    accent: "text-accent",
  },
};

/**
 * One FAQ contract for every template, same idea as StoreFooter: a shared accordion (native
 * <details>/<summary>, so no client component or extra dependency is needed), with `look`
 * changing only typography, surface and accent color. templates/render.tsx already hides this
 * section entirely when there's no content, so this component can assume `data.faqs` is non-empty.
 */
export function StoreFAQ({ data, look }: { data: StorefrontData; look: FaqLook }) {
  const style = FAQ_STYLES[look];
  return (
    <section className={style.surface}>
      <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
        <h2 className={cn(style.heading, "mb-10 text-center")}>{data.content["faqSection.heading"]}</h2>
        <div>
          {data.faqs.map((faq, i) => (
            <details key={i} data-reveal className={cn("group border-b py-2 last:border-b-0", style.border)}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-medium marker:content-none [&::-webkit-details-marker]:hidden">
                <span>{faq.question}</span>
                <Plus
                  aria-hidden
                  className={cn("h-5 w-5 shrink-0 transition-transform duration-200 group-open:rotate-45", style.accent)}
                />
              </summary>
              <p className="pb-5 pr-10 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {faq.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
