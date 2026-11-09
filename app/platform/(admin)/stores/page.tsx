import Link from "next/link";
import { Store } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listTenants } from "@/lib/data/tenants";
import { requirePlatformAdmin } from "@/lib/session";
import { getStoreUrl } from "@/lib/store-url";
import { cn } from "@/lib/utils";

export default async function StoresPage() {
  await requirePlatformAdmin();
  const tenants = await listTenants();
  const newStore = (
    <Link href="/platform/stores/new" className={cn(buttonVariants())}>
      New store
    </Link>
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Stores"
        description="Every store on this deployment. Open one to set its domain, analytics, privacy, theme and till."
        actions={newStore}
      />
      <SectionCard bodyClassName="p-0">
        {tenants.length === 0 ? (
          <EmptyState icon={Store} title="No stores yet" action={newStore}>
            A store is created here, with its owner&apos;s account — there is no self-signup.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="ps-4">Store</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-end">Products</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="pe-4 text-end">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="ps-4 font-medium">
                    <Link
                      href={`/platform/stores/${t.slug}`}
                      className="underline underline-offset-4"
                    >
                      {t.name}
                    </Link>
                    {t.isPaused && (
                      <Badge variant="destructive" className="ms-2 text-[10px]">
                        Paused
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        href={getStoreUrl(t)}
                        className="underline underline-offset-4"
                        target="_blank"
                      >
                        {t.domain ?? `/store/${t.slug}`}
                      </Link>
                      {t.domain && (
                        <Badge variant="secondary" className="text-[10px]">
                          Custom domain
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {t.owner.name}
                    <span className="block text-xs text-muted-foreground">
                      {t.owner.email}
                    </span>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{t._count.products}</TableCell>
                  <TableCell>{t.createdAt.toLocaleDateString("en-US")}</TableCell>
                  <TableCell className="pe-4 text-end">
                    <Link
                      href={`/platform/stores/${t.slug}`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      Manage
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
