import type { SocialPlatform } from "@/lib/social-links";
import { cn } from "@/lib/utils";

/** Recognizable monochrome brand marks that inherit the surrounding theme color. */
export function SocialPlatformIcon({
  platform,
  className,
}: {
  platform: SocialPlatform;
  className?: string;
}) {
  const common = {
    "aria-hidden": true,
    "data-platform-icon": platform,
    className: cn("size-4 shrink-0", className),
  } as const;

  if (platform === "instagram") {
    return (
      <svg {...common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (platform === "facebook") {
    return (
      <svg {...common} viewBox="0 0 24 24" fill="currentColor">
        <path d="M14.5 8.25V6.4c0-.9.6-1.12 1.02-1.12h2.96V1.02A38 38 0 0 0 14.3.8c-4.13 0-5.3 3.08-5.3 5.5v1.95H6.2v4.8H9V23.2h5.5V13.05h3.68l.55-4.8H14.5Z" />
      </svg>
    );
  }

  if (platform === "tiktok") {
    return (
      <svg {...common} viewBox="0 0 24 24" fill="currentColor">
        <path d="M14.4 1.2h3.35a5.6 5.6 0 0 0 4.05 4.3v3.4a9.2 9.2 0 0 1-4.05-1.2v7.45A7.65 7.65 0 1 1 11.1 7.6v3.5a4.25 4.25 0 1 0 3.3 4.15V1.2Z" />
      </svg>
    );
  }

  return (
    <svg {...common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.75" />
    </svg>
  );
}
