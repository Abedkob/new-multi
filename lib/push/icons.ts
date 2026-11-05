/**
 * The installable apps' icon set, declared once (D76).
 *
 * Three things read this list, and they must agree or the apps fail to install:
 *
 *   * scripts/build-icons.ts renders exactly these files from assets/icon-{app}.svg;
 *   * lib/push/manifest.ts puts the manifest ones in the manifest;
 *   * scripts/verify-icons.ts checks every file exists, is a real PNG, and is the size it
 *     claims — Android refuses to install a manifest whose icons 404, and it does not say why.
 *
 * Declaring the set in one place is the point. A manifest listing an icon the generator never
 * produced, or a generator producing a file no manifest names, are both silent until an owner
 * tries to install the app on their phone — which is the one moment nobody is watching a test.
 *
 * The files are COMMITTED rather than built at deploy time, so a manifest can never point at
 * something the build forgot, and regenerated rather than hand-exported, so a branding change
 * is one command instead of an afternoon in an image editor.
 */

export const ICON_APPS = ["admin", "platform"] as const;
export type IconApp = (typeof ICON_APPS)[number];

export type IconVariant = {
  /** Public path, which is also the path the manifest and the <link> use verbatim. */
  src: string;
  /** Square, in CSS pixels, and what the PNG's own header must say. */
  size: number;
  /**
   * How much of the canvas the mark occupies, as a fraction. The background always fills.
   *
   * `maskable` is tighter than `any` because Android masks the icon to whatever shape the
   * launcher likes — up to a circle inscribed in the square — and anything outside the inner
   * 80% can be cut off. A plain icon is never cropped, so it can afford to be bigger, and an
   * Apple touch icon sits between the two: iOS does not crop it, but it does round the corners
   * hard enough that a mark pressed into them looks like a mistake.
   */
  markScale: number;
  /** In the webmanifest (Android/Chrome), or linked from page metadata (iOS). */
  target: "manifest" | "apple-touch";
  purpose?: "any" | "maskable";
};

/**
 * iOS ignores manifest icons entirely and uses `apple-touch-icon`, which is why that one is in
 * this list at all: without it an iPhone Home Screen shows a screenshot of the page instead of
 * an icon, and P7-19's claim — two apps, two Home Screen icons — is false on exactly the device
 * the pilot owner is most likely to use.
 */
export function iconSet(app: IconApp): IconVariant[] {
  return [
    { src: `/icons/${app}-192.png`, size: 192, markScale: 0.76, target: "manifest", purpose: "any" },
    { src: `/icons/${app}-512.png`, size: 512, markScale: 0.76, target: "manifest", purpose: "any" },
    {
      src: `/icons/${app}-maskable-512.png`,
      size: 512,
      markScale: 0.6,
      target: "manifest",
      purpose: "maskable",
    },
    {
      src: `/icons/${app}-apple-touch-180.png`,
      size: 180,
      markScale: 0.72,
      target: "apple-touch",
    },
  ];
}

export const appleTouchIcon = (app: IconApp): string =>
  iconSet(app).find((icon) => icon.target === "apple-touch")!.src;
