import { redirect } from "next/navigation";
import type { AdminRole } from "@/lib/roles";
import { REFUSED_PATH, requireTenantMember, type TenantMember } from "@/lib/session";

/**
 * What each role inside a store may do (D72, D73). One table, and the default is deny.
 *
 * Every page and every server action under `app/admin` names exactly one capability from this
 * table, and `pnpm verify:permissions` fails statically on one that names none. That inverts the
 * old rule: before this table, a new admin screen was reachable by whoever `requireOwner`
 * admitted, and the only way to know what a role could do was to read fifty files. Now a screen
 * built after this phase is refused to staff until somebody writes down what it is for.
 *
 * The capabilities are deliberately coarse — one per thing a person does, not one per route — so
 * that the table reads as a description of two jobs rather than as a list of URLs.
 *
 * Changing a row here changes who can do that thing everywhere, with no other edit. That is the
 * point, and it is also why each row below carries its reason: the next person to widen one
 * should have to disagree with a sentence, not just delete a word.
 */
export const ADMIN_CAPABILITIES = {
  // ---------------------------------------------------------------- orders: this is the job
  /** See the orders list and one order's detail, customer contact details included. */
  "orders:read": ["STORE_OWNER", "STAFF"],
  /** Move an order forward: Pending → Confirmed → Delivered. */
  "orders:advance": ["STORE_OWNER", "STAFF"],
  /**
   * Cancel an order. Owner only: cancelling restores stock, is final, and is a commercial
   * decision about a customer rather than a step in fulfilling one.
   */
  "orders:cancel": ["STORE_OWNER"],

  // ------------------------------------------- the till: a sale rung up at the counter, in person
  /** See the counter-sale history, one sale's receipt, and the day's takings. */
  "counter:read": ["STORE_OWNER", "STAFF"],
  /**
   * Ring up a counter sale: take the cash or card, deduct the stock, record it. This is the job,
   * like advancing an order — and it includes reducing a line's price, which is capped for staff
   * and uncapped for the owner (lib/counter-sales.ts).
   */
  "counter:sell": ["STORE_OWNER", "STAFF"],
  /**
   * Void a recorded sale. Owner only, for the same reason as `orders:cancel`: it puts stock back,
   * it is final, and it rewrites a figure for money already settled with a customer. A staff
   * member who could void their own sale would make the till total stop being evidence of what
   * was taken, which is the whole point of recording who sold it.
   */
  "counter:void": ["STORE_OWNER"],

  // ---------------------------------------------------- catalogue: read it, and count the shelf
  /** See the product list and a product's detail. */
  "products:read": ["STORE_OWNER", "STAFF"],
  /** Change how many of a variant are in stock, and nothing else about the product. */
  "products:stock": ["STORE_OWNER", "STAFF"],
  /** Create, rename, reprice, re-image or delete a product. */
  "products:write": ["STORE_OWNER"],
  /** See the category tree (needed to make sense of the product list). */
  "categories:read": ["STORE_OWNER", "STAFF"],
  "categories:write": ["STORE_OWNER"],

  // ------------------------------------------------------------- the owner's own store decisions
  /** Discounts and coupons: what the store charges. */
  "discounts:write": ["STORE_OWNER"],
  /**
   * Every report screen, and the dashboard, which is a report screen. Revenue and traffic are
   * the owner's business — D60 already refuses staff an analytics *alert*; this refuses them the
   * screen it would have pointed at.
   */
  "analytics:read": ["STORE_OWNER"],
  "marketing:read": ["STORE_OWNER"],
  "marketing:write": ["STORE_OWNER"],
  /** The store's own Google and Meta ids: credentials for somebody else's account. */
  "integrations:write": ["STORE_OWNER"],
  "content:write": ["STORE_OWNER"],
  "storefront:preview": ["STORE_OWNER"],
  /** Social links, delivery fee and note — anything a shopper sees as the store's word. */
  "settings:write": ["STORE_OWNER"],
  /** Add or remove staff. Only the owner, and never a staff member (D73). */
  "staff:manage": ["STORE_OWNER"],

  // ----------------------------------------------------------------------- their own account
  /**
   * Their own devices and notification preferences. Both roles, because it only ever concerns
   * the person asking — which types a staff member may actually receive is a separate rule,
   * enforced in the writer (`NOTIFIABLE_TYPES`, D60), not here.
   */
  "notifications:self": ["STORE_OWNER", "STAFF"],
} as const satisfies Record<string, readonly AdminRole[]>;

export type Capability = keyof typeof ADMIN_CAPABILITIES;

export const CAPABILITIES = Object.keys(ADMIN_CAPABILITIES) as Capability[];

/**
 * Whether a role may do this. Deny-by-default in the only way that matters: an unknown
 * capability is refused rather than allowed, so a typo closes a door instead of opening one.
 */
export function can(role: AdminRole | undefined, capability: Capability): boolean {
  if (!role) return false;
  const allowed = ADMIN_CAPABILITIES[capability] as readonly AdminRole[] | undefined;
  return !!allowed?.includes(role);
}

/**
 * The guard every admin page and action goes through.
 *
 * Returns the same shape `requireOwner` does, plus the role, so a page that serves both can
 * render differently without a second lookup. A refusal is `/admin/no-access` rather than
 * `/login` or a 404 — see that page for why both of those are wrong.
 */
export async function requireCapability(
  capability: Capability,
  opts?: { allowMustChange?: boolean },
): Promise<TenantMember> {
  const member = await requireTenantMember(opts);
  if (!can(member.role, capability)) redirect(REFUSED_PATH);
  return member;
}
