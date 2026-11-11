/**
 * A realistically large catalogue, bulk-loaded.
 *
 * Extracted from `measure-counter.ts`, which had it inline, once a second measurement script
 * needed the same thing. Both of them answer "what does this cost at a real shop's size", and a
 * second hand-rolled copy of the seed would have made their numbers quietly incomparable — the
 * till's figures and the stockroom's are both read against "2,000 products x 3 variants", and that
 * has to mean the same rows in both.
 *
 * Bulk-inserted with `generate_series` rather than through `createProduct`: two thousand
 * transactions would make the setup longer than the measurement, and nothing here is testing the
 * product writer.
 */

import { prisma } from "../../lib/prisma";

/**
 * The words product names are built from, so a search term matches a real subset rather than
 * everything or nothing.
 */
export const CATALOGUE_WORDS = [
  "mug",
  "plate",
  "bowl",
  "shirt",
  "scarf",
  "lamp",
  "vase",
  "chair",
  "towel",
  "candle",
] as const;

export type SeededCatalogue = {
  products: number;
  variants: number;
  /** A handful of variant ids, for an operation that needs specific rows. */
  sample: string[];
  seconds: number;
};

/**
 * `products` products, each with `variantsEach` variants, all holding `stock`.
 *
 * `run` is the caller's run id and prefixes every synthetic id, so two measurements in the same
 * database cannot collide and a `tenant.delete` takes the whole fixture with it.
 */
export async function seedCatalogue(
  tenantId: string,
  run: string,
  options: { products?: number; variantsEach?: number; stock?: number; sample?: number } = {},
): Promise<SeededCatalogue> {
  const products = options.products ?? 2000;
  const variantsEach = options.variantsEach ?? 3;
  const stock = options.stock ?? 500;
  const started = performance.now();

  await prisma.$executeRaw`
    INSERT INTO "Product" ("id","tenantId","name","description","basePriceCents","imageUrl","slug","isBestSeller","createdAt","updatedAt")
    SELECT 'mp-' || ${run} || '-' || g, ${tenantId},
           (ARRAY['Mug','Plate','Bowl','Shirt','Scarf','Lamp','Vase','Chair','Towel','Candle'])[1 + (g % 10)]
             || ' ' || g,
           '', 500 + (g % 50) * 100, '',
           'mp-' || ${run} || '-' || g, false, now(), now()
    FROM generate_series(1, ${products}) AS g`;

  await prisma.$executeRaw`
    INSERT INTO "ProductVariant" ("id","productId","attributes","stock","sortOrder","createdAt")
    SELECT 'mv-' || ${run} || '-' || g || '-' || v,
           'mp-' || ${run} || '-' || g,
           jsonb_build_object('Size', (ARRAY['S','M','L'])[v]),
           ${stock}, v, now()
    FROM generate_series(1, ${products}) AS g,
         generate_series(1, ${variantsEach}) AS v`;

  const sample = await prisma.productVariant.findMany({
    where: { product: { tenantId } },
    select: { id: true },
    take: options.sample ?? 4,
  });

  return {
    products,
    variants: products * variantsEach,
    sample: sample.map((row) => row.id),
    seconds: (performance.now() - started) / 1000,
  };
}

/**
 * `ANALYZE` the tables a measurement is about to read. **Always call this before timing anything.**
 *
 * A freshly bulk-loaded table has no statistics, so the planner estimates one row everywhere and
 * picks plans it would never choose in production. Without it, `measure-counter`'s first run timed
 * the takings aggregate on a nested loop that discarded 271,068 rows — a measurement of the
 * planner's ignorance, not of the query. With it, the same query hash-joins in 12ms.
 */
export function analyzeTables(tables: readonly string[]): Promise<number> {
  const list = tables.map((t) => `"${t.replace(/"/g, '')}"`).join(", ");
  return prisma.$executeRawUnsafe(`ANALYZE ${list}`);
}

export function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

/**
 * Times `fn` `iterations` times and prints one aligned row.
 *
 * Returns the p95, which is the figure every budget in this project is written against — a p50
 * hides the tail a merchant actually notices.
 */
export async function time(
  label: string,
  iterations: number,
  fn: (i: number) => Promise<unknown>,
): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const started = performance.now();
    await fn(i);
    samples.push(performance.now() - started);
  }
  const p50 = `${percentile(samples, 50).toFixed(0)}ms`;
  const p95 = `${percentile(samples, 95).toFixed(0)}ms`;
  const max = `${Math.max(...samples).toFixed(0)}ms`;
  console.log(
    `  ${label.padEnd(30)} p50 ${p50.padStart(7)}   p95 ${p95.padStart(7)}   max ${max.padStart(7)}   (${iterations} runs)`,
  );
  return percentile(samples, 95);
}

/** `EXPLAIN ANALYZE`, printed. The reason an index decision is made from a plan and not a feeling. */
export async function explain(title: string, sql: Promise<{ "QUERY PLAN": string }[]>) {
  console.log(`\nEXPLAIN ANALYZE — ${title}:`);
  for (const row of await sql) console.log(`  ${row["QUERY PLAN"]}`);
}
