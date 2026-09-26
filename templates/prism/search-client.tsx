"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Search, X, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Picture, cardPrice, productHref, searchHref } from "../shared";
import type { StorefrontData, StoreProduct } from "../types";
import styles from "./prism.module.css";

export function PrismSearch({ data }: { data: StorefrontData }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ term: string; products: StoreProduct[]; failed?: boolean } | null>(null);
  const term = query.trim();
  const pending = !!term && result?.term !== term;
  const close = () => { dialog.current?.close(); setOpen(false); trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    input.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (!open || !term) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/store/${encodeURIComponent(data.store.slug)}/search?q=${encodeURIComponent(term)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
        if (!response.ok) throw new Error("Search failed");
        const products: StoreProduct[] = await response.json();
        if (!controller.signal.aborted) setResult({ term, products });
      } catch {
        if (!controller.signal.aborted) setResult({ term, products: [], failed: true });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, term, data.store.slug]);

  return <>
    <button ref={trigger} type="button" onClick={() => setOpen(true)} aria-label={data.content["search.button"]} aria-haspopup="dialog" className="grid size-11 place-items-center rounded-full bg-secondary"><Search className="size-5" aria-hidden /></button>
    <dialog ref={dialog} className={cn(styles.scope, styles.dialog)} aria-labelledby={titleId} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }} onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => { setOpen(false); trigger.current?.focus(); }}>
      <div className="mx-auto max-w-7xl">
        <div className="flex items-center justify-between gap-6"><h2 id={titleId} className={styles.title}>{data.content["search.heading"]}</h2><button type="button" onClick={close} aria-label="Close search" className="grid size-12 shrink-0 place-items-center rounded-full border border-border"><X aria-hidden /></button></div>
        <form action={searchHref(data.store)} role="search" className="mt-12 flex items-center gap-3 border-b border-border pb-4" onSubmit={close}>
          <input ref={input} name="q" type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} autoComplete="off" aria-label={data.content["search.placeholder"]} placeholder={data.content["search.placeholder"]} className="min-h-14 min-w-0 flex-1 bg-transparent text-xl outline-none sm:text-4xl" />
          <button type="submit" className={styles.button}><span className="hidden sm:inline">{data.content["search.button"]}</span><ArrowUpRight aria-label={data.content["search.button"]} className="size-5" /></button>
        </form>
        {!term && <nav aria-label={data.content["featuredCategories.heading"]} className="mt-10 flex flex-wrap gap-3">{data.categoryTiles.map((category) => <Link key={category.id} href={category.href} onClick={close} className="rounded-full bg-secondary px-6 py-4">{category.label}</Link>)}</nav>}
        <div role="status" aria-live="polite" className="mt-6 text-sm text-muted-foreground">
          {pending ? "Searching…" : term && result?.term === term && (result.failed ? "Suggestions couldn’t load. Submit your search to see all results." : result.products.length === 0 ? data.content["search.empty"].replaceAll("{q}", term) : `${result.products.length} matching products`)}
        </div>
        {term && !pending && result && !result.failed && <ul className={styles.searchResults}>{result.products.map((product) => <li key={product.id}><Link href={productHref(data.store, product)} onClick={close} className="block"><Picture src={product.imageUrl} alt="" className="aspect-[3/4] bg-secondary" imgClassName="object-contain p-4" /><h3 className="mt-4 text-lg">{product.name}</h3><p className="mt-2 text-sm">{cardPrice(product, data.content)}</p><p className="mt-2 text-sm text-muted-foreground">{data.content[product.inStock ? "product.inStock" : "product.outOfStock"]}</p></Link></li>)}</ul>}
        {term && <Link href={`${searchHref(data.store)}?q=${encodeURIComponent(term)}`} onClick={close} className="inline-flex min-h-12 items-center gap-3 border-b border-current text-sm">View all results<ArrowUpRight className="size-4" aria-hidden /></Link>}
      </div>
    </dialog>
  </>;
}
