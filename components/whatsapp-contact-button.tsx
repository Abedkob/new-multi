import { SocialPlatformIcon } from "@/components/social-platform-icon";
import type { SocialLink } from "@/templates/types";

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
      className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-full bg-[#128c7e] text-white shadow-lg ring-1 ring-black/10 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#128c7e]/30 motion-reduce:transition-none"
    >
      <SocialPlatformIcon platform="whatsapp" className="size-7" />
    </a>
  );
}
