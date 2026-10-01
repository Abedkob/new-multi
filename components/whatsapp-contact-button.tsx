import { SocialPlatformIcon } from "@/components/social-platform-icon";
import { cn } from "@/lib/utils";
import type { SocialLink } from "@/templates/types";

/**
 * WhatsApp's own green, shared by every WhatsApp control on the storefront. It lives here rather
 * than in templates/ because it's the platform's brand mark, not a store color the theme decides.
 */
export const whatsappBrandClass = "bg-[#128c7e] text-white hover:bg-[#0f7a6e] hover:text-white";

/** Persistent storefront contact shortcut. The parent omits it when WhatsApp is not configured. */
export function WhatsAppContactButton({ link }: { link: SocialLink | undefined }) {
  if (!link) return null;

  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      title="Chat with us on WhatsApp"
      data-testid="whatsapp-contact-button"
      className={cn(
        "fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-full shadow-lg ring-1 ring-black/10 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#128c7e]/30 motion-reduce:transition-none",
        whatsappBrandClass,
      )}
    >
      <SocialPlatformIcon platform="whatsapp" className="size-7" />
    </a>
  );
}
