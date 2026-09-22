import Link from "next/link";
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

export default async function StoresPage() {
  await requirePlatformAdmin();
  const tenants = await listTenants();
  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stores</h1>
        <Link href="/platform/stores/new" className={buttonVariants()}>
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
            <TableHead className="text-right">Design</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenants.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                No stores yet.
              </TableCell>
            </TableRow>
          )}
          {tenants.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.name}</TableCell>
              <TableCell>
                <Link
                  href={`/store/${t.slug}`}
                  className="underline underline-offset-4"
                  target="_blank"
                >
                  /store/{t.slug}
                </Link>
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
                  href={`/platform/stores/${t.slug}/theme`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Template &amp; theme
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
