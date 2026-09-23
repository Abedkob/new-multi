import Link from "next/link";
import { CornerDownRight, FolderTree, Plus } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { Thumb } from "@/components/admin/thumb";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

  const addButton = (
    <Link href="/admin/categories/new" className={buttonVariants()}>
      <Plus className="size-4" aria-hidden /> New category
    </Link>
  );

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Categories"
        description="Group your products so shoppers can browse, e.g. Men → Shoes. A category shows its own products plus everything inside it."
        actions={addButton}
      />
      <Card className="gap-0 overflow-hidden py-0">
        {tree.length === 0 ? (
          <EmptyState icon={FolderTree} title="No categories yet." action={addButton}>
            Categories appear in your store&apos;s menu. Create one, then pick it when adding a
            product.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="pl-4">Category</TableHead>
                <TableHead>Web address</TableHead>
                <TableHead className="text-right">Products</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tree.map((c) => (
                <TableRow key={c.id} data-depth={c.depth}>
                  <TableCell className="pl-4 font-medium">
                    <span className="flex items-center gap-3" style={{ paddingLeft: `${c.depth * 1.5}rem` }}>
                      {c.depth > 0 && <CornerDownRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                      <Thumb src={c.imageUrl} className="size-8" />
                      {c.name}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">/category/{c.slug}</TableCell>
                  <TableCell className="text-right tabular-nums">{c._count.products}</TableCell>
                  <TableCell className="pr-4">
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
        )}
      </Card>
    </div>
  );
}
