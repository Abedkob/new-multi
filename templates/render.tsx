import { MotionConfig } from "motion/react";
import { cn } from "@/lib/utils";
import type { SectionId } from "@/lib/sections";
import type { StorefrontData, Template } from "./types";

/**
 * The one place that decides which sections appear and in what order, so every template
 * is structurally identical and only differs visually.
 *   1 announcement  2 navbar  [ page content ]  ... 11 footer
 * Home = 3 hero, 4 featured categories, 5 new arrivals, 6 best sellers,
 *        7 promo banner, 8 brand story, 9 reviews, 10 instagram.
 *
 * Optional sections render only when the owner's toggle is on AND they have content.
 * Instagram is not toggleable but also needs something to show (a handle or photos).
 * Turning a toggle off hides the section; it never deletes its content.
 */
export function isSectionShown(id: SectionId, data: StorefrontData) {
  const c = data.content;
  switch (id) {
    case "hero":
      // The Hero switch (heroText) hides only the headline/subtext/button: an image-only hero
      // stays. The section disappears only when the text is off and there's no image either.
      return data.visibility.heroText || c["hero.image"] !== "" || c["hero.imageMobile"] !== "";
    case "announcement":
      return data.visibility.announcementBar && c["announcement.text"].trim() !== "";
    case "promoBanner":
      return data.visibility.promoBanner && c["promoBanner.heading"].trim() !== "";
    case "brandStory":
      return (
        data.visibility.brandStory &&
        (c["brandStory.heading"].trim() !== "" || c["brandStory.body"].trim() !== "")
      );
    case "reviews":
      return data.visibility.reviews && data.reviews.length > 0;
    case "featuredCategories":
      return data.categoryTiles.length > 0;
    case "instagram":
      // Always on, but a strip with no handle and no photos would just be empty boxes.
      return data.instagram.handle !== "" || data.instagram.tiles.length > 0;
    default:
      return true;
  }
}

const KEBAB: Partial<Record<SectionId, string>> = {
  featuredCategories: "featured-categories",
  newArrivals: "new-arrivals",
  bestSellers: "best-sellers",
  promoBanner: "promo-banner",
  brandStory: "brand-story",
};

function Section({
  id,
  data,
  template,
}: {
  id: SectionId;
  data: StorefrontData;
  template: Template;
}) {
  if (!isSectionShown(id, data)) return null;
  const Component = {
    announcement: template.Announcement,
    navbar: template.Navbar,
    hero: template.Hero,
    featuredCategories: template.FeaturedCategories,
    newArrivals: template.NewArrivals,
    bestSellers: template.BestSellers,
    promoBanner: template.PromoBanner,
    brandStory: template.BrandStory,
    reviews: template.Reviews,
    instagram: template.Instagram,
    footer: template.Footer,
  }[id];
  return (
    <div
      data-section={id}
      id={KEBAB[id] ?? id}
      className={cn(
        // Anchor jumps (#new-arrivals) land below the sticky navbar, not under it.
        "scroll-mt-28",
        // The navbar stays pinned to the top while scrolling, in every template. Sticky goes
        // on this wrapper, not the template's <header>: a sticky element only sticks inside
        // its parent, and this wrapper is exactly as tall as the header.
        id === "navbar" && "sticky top-0 z-40",
      )}
    >
      <Component data={data} />
    </div>
  );
}

/** Announcement + navbar on top, footer at the bottom, around any page's content. */
export function StorefrontShell({
  template,
  data,
  children,
}: {
  template: Template;
  data: StorefrontData;
  children: React.ReactNode;
}) {
  return (
    // reducedMotion="user" makes every motion.* component below skip straight to its end
    // state for shoppers with prefers-reduced-motion, with no per-animation opt-in needed.
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col">
        <Section id="announcement" data={data} template={template} />
        <Section id="navbar" data={data} template={template} />
        <main className="flex-1">{children}</main>
        <Section id="footer" data={data} template={template} />
      </div>
    </MotionConfig>
  );
}

/** Sections 3 to 10, in fixed order. */
export function HomeSections({
  template,
  data,
}: {
  template: Template;
  data: StorefrontData;
}) {
  return (
    <>
      {(
        [
          "hero",
          "featuredCategories",
          "newArrivals",
          "bestSellers",
          "promoBanner",
          "brandStory",
          "reviews",
          "instagram",
        ] as const
      ).map((id) => (
        <Section key={id} id={id} data={data} template={template} />
      ))}
    </>
  );
}
