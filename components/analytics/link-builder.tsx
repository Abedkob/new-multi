"use client";

/**
 * The tracked-link builder (§5.5, D37).
 *
 * Self-contained by design, because Phase 5 moves it. Its Marketing section will mount this
 * exact component in a tab, so nothing in here may reach for the page it happens to be on:
 *
 *   - no `usePathname`, `useRouter` or `useSearchParams`;
 *   - no server action and no data loading — destinations arrive as props;
 *   - no layout assumptions beyond "I am given a width".
 *
 * It also writes nothing. There is no campaign table in version 1 (§5.5): a tracked link is a
 * URL the owner pastes into a post, and the report groups by what comes back in the URL. That
 * means a link built here can never disagree with a report, because there is no second record
 * of it to drift.
 *
 * The one piece of real thinking here is that the UTM values this produces must be the values
 * the server's ladder will classify (lib/analytics/attribution.ts): a channel of "instagram"
 * has to arrive as `utm_source=instagram`, or a merchant's own link lands in a different row
 * from their organic Instagram traffic and the report splits in two.
 */

import { useMemo, useState } from "react";

export type LinkDestination = {
  /** Shown in the picker. */
  label: string;
  /** Path relative to the store's base, e.g. "" for home or "/products/blue-shirt". */
  path: string;
};

/**
 * Channels a merchant actually posts to, and the `utm_source` each one must produce.
 *
 * `medium` matches what the server infers for that channel's organic traffic, so a tagged link
 * and an untagged visit from the same place end up in one row rather than two.
 */
const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp", source: "whatsapp", medium: "social" },
  { id: "instagram", label: "Instagram", source: "instagram", medium: "social" },
  { id: "facebook", label: "Facebook", source: "facebook", medium: "social" },
  { id: "tiktok", label: "TikTok", source: "tiktok", medium: "social" },
  { id: "email", label: "Email or newsletter", source: "newsletter", medium: "email" },
  { id: "custom", label: "Something else", source: "", medium: "referral" },
] as const;

type ChannelId = (typeof CHANNELS)[number]["id"];

/** utm values are compared as plain strings by the report, so they are normalized here once. */
const slugifyUtm = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export function LinkBuilder({
  /** The store's public origin plus its base path, with no trailing slash. */
  storeUrl,
  destinations,
}: {
  storeUrl: string;
  destinations: LinkDestination[];
}) {
  const [channel, setChannel] = useState<ChannelId>("instagram");
  const [customSource, setCustomSource] = useState("");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [destination, setDestination] = useState(destinations[0]?.path ?? "");
  const [copied, setCopied] = useState(false);

  const picked = CHANNELS.find((c) => c.id === channel) ?? CHANNELS[0];
  const source = slugifyUtm(picked.id === "custom" ? customSource : picked.source);
  const utmCampaign = slugifyUtm(campaign);
  const utmContent = slugifyUtm(content);

  const url = useMemo(() => {
    if (!source) return "";
    const params = new URLSearchParams();
    params.set("utm_source", source);
    params.set("utm_medium", picked.medium);
    if (utmCampaign) params.set("utm_campaign", utmCampaign);
    if (utmContent) params.set("utm_content", utmContent);
    return `${storeUrl}${destination}?${params.toString()}`;
  }, [storeUrl, destination, source, picked.medium, utmCampaign, utmContent]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard access can be refused; the field is selectable, so nothing is lost.
    }
  };

  return (
    <div className="grid gap-5" data-testid="link-builder">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Where are you posting it?</span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as ChannelId)}
            data-testid="link-builder-channel"
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {CHANNELS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        {picked.id === "custom" ? (
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Name the place</span>
            <input
              value={customSource}
              onChange={(e) => setCustomSource(e.target.value)}
              placeholder="a blog, a partner, a print ad"
              data-testid="link-builder-source"
              className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </label>
        ) : null}

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Campaign name</span>
          <input
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            placeholder="eid-sale"
            data-testid="link-builder-campaign"
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
          />
          <span className="text-xs text-muted-foreground">
            Yours to choose. Use the same name on every link for one campaign and the report adds
            them up together.
          </span>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Where should it land?</span>
          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            data-testid="link-builder-destination"
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {destinations.map((d) => (
              <option key={d.path} value={d.path}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Label (optional)</span>
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="story-1, bio-link"
            data-testid="link-builder-content"
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
          />
          <span className="text-xs text-muted-foreground">
            To tell two links in the same campaign apart.
          </span>
        </label>
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-medium">Your link</span>
        {url ? (
          <>
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              data-testid="link-builder-url"
              className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={copy}
                data-testid="link-builder-copy"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <span className="text-xs text-muted-foreground">
                In your report this appears as{" "}
                <strong>
                  {source} / {picked.medium}
                  {utmCampaign ? ` / ${utmCampaign}` : ""}
                </strong>
                .
              </span>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="link-builder-incomplete">
            Name the place you are posting it and the link will appear here.
          </p>
        )}
      </div>
    </div>
  );
}
