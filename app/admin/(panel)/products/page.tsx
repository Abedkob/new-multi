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
import { listProducts } from "@/lib/data/products";
import { formatPrice } from "@/lib/format";
import { requireOwner } from "@/lib/session";
import { effectivePrice } from "@/lib/variants";
import { deleteProductAction } from "./actions";
import { DeleteButton } from "./delete-button";

export default async function ProductsPage() {
  const { tenantId } = await requireOwner();
  const products = await listProducts(tenantId);

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Products</h1>
        <Link href="/admin/products/new" className={buttonVariants()}>
          New product
        </Link>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Variants</TableHead>
            <TableHead className="text-right">Stock</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                No products yet.
              </TableCell>
            </TableRow>
          )}
          {products.map((p) => {
            const prices = p.variants.map((v) => effectivePrice(p.basePriceCents, v.priceCentsOverride));
            const min = Math.min(...(prices.length ? prices : [p.basePriceCents]));
            const max = Math.max(...(prices.length ? prices : [p.basePriceCents]));
            const totalStock = p.variants.reduce((sum, v) => sum + v.stock, 0);
            return (
              <TableRow key={p.id}>
                <TableCell className="font-medium">
                  {p.name}
                  {p.isBestSeller && (
                    <Badge variant="secondary" className="ml-2">
                      Best seller
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{p.category?.name ?? "-"}</TableCell>
                <TableCell className="text-right">
                  {formatPrice(min)}
                  {max !== min && <span className="text-muted-foreground"> - {formatPrice(max)}</span>}
                </TableCell>
                <TableCell className="text-right">{p.variants.length}</TableCell>
                <TableCell className="text-right">
                  {totalStock}
                  {totalStock === 0 && (
                    <Badge variant="outline" className="ml-2">
                      Out of stock
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Link
                      href={`/admin/products/${p.id}/edit`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Edit
                    </Link>
                    <form action={deleteProductAction.bind(null, p.id)}>
                      <DeleteButton name={p.name} />
                    </form>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
