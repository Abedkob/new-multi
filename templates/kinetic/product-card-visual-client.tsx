"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Picture } from "../shared";

/**
 * The card's product photo(s). Desktop reveals a second photo on hover (pure CSS, no JS needed
 * there); touch devices have no hover, so a small toggle button — shown only via Tailwind's
 * `pointer-coarse:` variant, meaning it literally isn't in the DOM's visible path for a
 * hover-capable pointer — lets a shopper tap to swap photos instead.
 */
export function ProductCardVisual({
  primaryUrl,
  secondaryUrl,
  alt,
  large,
}: {
  primaryUrl: string;
  secondaryUrl?: string;
  alt: string;
  large?: boolean;
}) {
  const [showAlt, setShowAlt] = useState(false);
  const sizes = large ? "(max-width: 1024px) 100vw, 50vw" : undefined;

  return (
    <>
      {primaryUrl && (
        <Picture
          src={primaryUrl}
          alt=""
          className="absolute inset-0"
          imgClassName="scale-125 object-cover opacity-60 blur-2xl saturate-150"
          sizes={sizes}
          quality={20}
        />
      )}
      <Picture
        src={primaryUrl}
        alt={alt}
        className="absolute inset-0"
        imgClassName={cn(
          "object-contain p-5 transition duration-700 sm:p-8",
          showAlt ? "opacity-0" : "group-hover:scale-[1.035] group-hover:opacity-0",
        )}
        sizes={sizes}
      />
      {secondaryUrl && (
        <>
          <Picture
            src={secondaryUrl}
            alt=""
            className="absolute inset-0 transition-opacity duration-700"
            imgClassName={cn("object-contain p-5 sm:p-8", showAlt ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
            sizes={sizes}
          />
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setShowAlt((current) => !current);
            }}
            aria-label={showAlt ? "Show primary product photo" : "Show alternate product photo"}
            aria-pressed={showAlt}
            className="absolute bottom-4 left-4 z-10 hidden size-9 place-items-center rounded-full bg-background/90 text-foreground backdrop-blur-md pointer-coarse:grid"
          >
            <RefreshCw className="size-4" aria-hidden />
          </button>
        </>
      )}
    </>
  );
}
