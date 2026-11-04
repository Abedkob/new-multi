import { redirect } from "next/navigation";

/**
 * The section index. Results becomes this page in its own commit; until then the section opens
 * on a tab that does something, rather than on an empty frame explaining what it will be.
 *
 * `redirect`, not `permanentRedirect`: this path is going to mean Results shortly, and a 308
 * cached in an owner's browser would outlive that.
 */
export default function MarketingIndexPage() {
  redirect("/admin/marketing/integrations");
}
