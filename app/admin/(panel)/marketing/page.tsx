import { redirect } from "next/navigation";

/**
 * The section index: Results, which is what an owner opening Marketing wants to see.
 *
 * `redirect`, not `permanentRedirect`: a 308 cached in an owner's browser would outlive any
 * later decision about which tab this section opens on.
 */
export default function MarketingIndexPage() {
  redirect("/admin/marketing/results");
}
