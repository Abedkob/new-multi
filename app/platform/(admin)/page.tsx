import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getPlatformStats } from "@/lib/data/tenants";
import { cn } from "@/lib/utils";

export default async function PlatformHome() {
  const { stores, products } = await getPlatformStats();
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Platform overview</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Stores</CardDescription>
            <CardTitle className="text-3xl">{stores}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Products (all stores)</CardDescription>
            <CardTitle className="text-3xl">{products}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      <div className="flex gap-3">
        <Link href="/platform/stores/new" className={cn(buttonVariants())}>
          Create a store
        </Link>
        <Link
          href="/platform/stores"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          View all stores
        </Link>
      </div>
    </div>
  );
}
