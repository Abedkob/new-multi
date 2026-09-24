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

  if (platform === "whatsapp") {
    return (
      <svg {...common} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.04 2a9.82 9.82 0 0 0-8.49 14.75L2.1 22l5.37-1.41A9.93 9.93 0 1 0 12.04 2Zm0 17.99a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.19.84.85-3.1-.2-.32a8.04 8.04 0 1 1 6.97 3.89Zm4.42-6.04c-.24-.12-1.43-.7-1.65-.79-.22-.08-.38-.12-.55.12-.16.24-.62.79-.76.95-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.95-1.2a7.3 7.3 0 0 1-1.35-1.68c-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.31-.75-1.79-.2-.48-.4-.41-.55-.42h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2 0 1.19.87 2.34.99 2.5.12.16 1.7 2.6 4.12 3.65.58.25 1.03.4 1.38.51.58.18 1.1.16 1.52.1.46-.07 1.43-.59 1.63-1.15.2-.57.2-1.05.14-1.15-.06-.1-.22-.16-.46-.28Z" />
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
