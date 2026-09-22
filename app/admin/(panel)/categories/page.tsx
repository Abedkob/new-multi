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
import { flattenCategories } from "@/lib/categories";
import { listCategories } from "@/lib/data/categories";
import { requireOwner } from "@/lib/session";
import { DeleteCategoryButton } from "./delete-category-button";

export default async function CategoriesPage() {
  const { tenantId } = await requireOwner();
  const tree = flattenCategories(await listCategories(tenantId));

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Categories</h1>
          <p className="text-muted-foreground">
            Organise products in a tree of any depth. Shoppers can browse each category (and
            everything inside it).
          </p>
        </div>
        <Link href="/admin/categories/new" className={buttonVariants()}>
          New category
        </Link>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Category</TableHead>
            <TableHead>URL</TableHead>
            <TableHead className="text-right">Products</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tree.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                No categories yet.
              </TableCell>
            </TableRow>
          )}
          {tree.map((c) => (
            <TableRow key={c.id} data-depth={c.depth}>
              <TableCell className="font-medium">
                <span style={{ paddingLeft: `${c.depth * 1.5}rem` }}>
                  {c.depth > 0 && (
                    <span aria-hidden className="mr-1 text-muted-foreground">
                      &#9492;
                    </span>
                  )}
                  {c.name}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">/{c.slug}</TableCell>
              <TableCell className="text-right">{c._count.products}</TableCell>
              <TableCell>
                <div className="flex items-start justify-end gap-2">
                  <Link
                    href={`/admin/categories/${c.id}/edit`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Edit
                  </Link>
                  <DeleteCategoryButton id={c.id} name={c.name} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
