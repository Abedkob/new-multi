import Link from "next/link";
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
  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stores</h1>
        <Link href="/platform/stores/new" className={cn(buttonVariants())}>
          New store
        </Link>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Store</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead className="text-right">Products</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Manage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenants.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                No stores yet —{" "}
                <Link href="/platform/stores/new" className="underline underline-offset-4">
                  create the first one
                </Link>
                .
              </TableCell>
            </TableRow>
          )}
          {tenants.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">
                <Link
                  href={`/platform/stores/${t.slug}`}
                  className="underline underline-offset-4"
                >
                  {t.name}
                </Link>
                {t.isPaused && (
                  <Badge variant="destructive" className="ml-2 text-[10px]">
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
              <TableCell className="text-right">{t._count.products}</TableCell>
              <TableCell>{t.createdAt.toLocaleDateString("en-US")}</TableCell>
              <TableCell className="text-right">
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
    </div>
  );
}
