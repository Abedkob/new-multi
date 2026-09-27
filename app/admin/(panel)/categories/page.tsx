import Link from "next/link";
import { CornerDownRight, FolderTree, Plus } from "lucide-react";
import { AdminPageSizeControl } from "@/components/admin-page-size-control";
import { AdminPagination } from "@/components/admin-pagination";
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
import { listCategoriesPage } from "@/lib/data/categories";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { DeleteCategoryButton } from "./delete-category-button";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function CategoriesPage({ searchParams }: PageProps<"/admin/categories">) {
  const { tenantId } = await requireOwner();
  const t = await getT();
  const query = await searchParams;
  const requestedPage = Number.parseInt(first(query.page) ?? "1", 10) || 1;
  const requestedPageSize = Number.parseInt(first(query.perPage) ?? "25", 10) || 25;
  const { items: tree, total, page, pages, pageSize } = await listCategoriesPage(
    tenantId,
    requestedPage,
    requestedPageSize,
  );

  const addButton = (
    <Link href="/admin/categories/new" className={buttonVariants()}>
      <Plus className="size-4" aria-hidden /> {t("categories.page.newCategory")}
    </Link>
  );

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t("categories.page.title")}
        description={t("categories.page.description")}
        actions={addButton}
      />
      <AdminPageSizeControl page={page} pageSize={pageSize} total={total} noun={t("categories.page.noun")} />
      <Card className="gap-0 overflow-hidden py-0">
        {tree.length === 0 ? (
          <EmptyState icon={FolderTree} title={t("categories.empty.title")} action={addButton}>
            {t("categories.empty.body")}
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="ps-4">{t("categories.table.category")}</TableHead>
                <TableHead>{t("categories.table.webAddress")}</TableHead>
                <TableHead className="text-end">{t("categories.table.products")}</TableHead>
                <TableHead className="pe-4 text-end">
                  <span className="sr-only">{t("common.actionsSr")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tree.map((c) => (
                <TableRow key={c.id} data-depth={c.depth}>
                  <TableCell className="ps-4 font-medium">
                    <span className="flex items-center gap-3" style={{ paddingInlineStart: `${c.depth * 1.5}rem` }}>
                      {c.depth > 0 && (
                        <CornerDownRight className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden />
                      )}
                      <Thumb src={c.imageUrl} className="size-8" />
                      <span className="min-w-0">
                        <span className="block truncate" data-testid="category-name">{c.name}</span>
                        {c.depth > 0 && (
                          <span className="block truncate text-xs font-normal text-muted-foreground" title={c.path}>
                            {c.path}
                          </span>
                        )}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">/category/{c.slug}</TableCell>
                  <TableCell className="text-end tabular-nums">{c._count.products}</TableCell>
                  <TableCell className="pe-4">
                    <div className="flex items-start justify-end gap-2">
                      <Link
                        href={`/admin/categories/${c.id}/edit`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        {t("common.edit")}
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
      <AdminPagination
        basePath="/admin/categories"
        page={page}
        pages={pages}
        total={total}
        noun={t("categories.page.noun")}
        params={pageSize === 25 ? {} : { perPage: String(pageSize) }}
      />
    </div>
  );
}
