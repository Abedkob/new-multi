"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ProductActionState } from "./actions";
import { CategoryPicker, type CategoryOption } from "./category-picker";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ProductFormInput } from "@/lib/validation";

type VariantRow = {
  /** Local key for React only. */
  key: string;
  /** The saved variant's id, when editing an existing one. */
  id?: string;
  attrs: { key: string; value: string }[];
  stock: string;
  price: string;
  imageUrl: string;
};

type ImageRow = {
  /** Local key for React only. */
  key: string;
  /** The saved image's id, when editing an existing one. */
  id?: string;
  url: string;
  altText: string;
};

export type ProductFormDefaults = {
  name: string;
  description: string;
  price: string;
  imageUrl: string;
  images: Omit<ImageRow, "key">[];
  isBestSeller: boolean;
  categoryId: string;
  variants: Omit<VariantRow, "key">[];
};

let counter = 0;
const rowKey = () => `v${++counter}`;

const EMPTY: ProductFormDefaults = {
  name: "",
  description: "",
  price: "",
  imageUrl: "",
  images: [],
  isBestSeller: false,
  categoryId: "",
  // Every product has at least one variant. A product with no real variation keeps this
  // single default variant (no attributes) and only uses its stock.
  variants: [{ attrs: [], stock: "0", price: "", imageUrl: "" }],
};

export function ProductForm({
  action,
  categories,
  defaults = EMPTY,
  submitLabel,
}: {
  action: (input: ProductFormInput) => Promise<ProductActionState>;
  categories: CategoryOption[];
  defaults?: ProductFormDefaults;
  submitLabel: string;
}) {
  const [name, setName] = useState(defaults.name);
  const [description, setDescription] = useState(defaults.description);
  const [price, setPrice] = useState(defaults.price);
  const [imageUrl, setImageUrl] = useState(defaults.imageUrl);
  const [isBestSeller, setIsBestSeller] = useState(defaults.isBestSeller);
  const [categoryId, setCategoryId] = useState(defaults.categoryId);
  const [variants, setVariants] = useState<VariantRow[]>(() =>
    defaults.variants.map((v) => ({ ...v, key: rowKey() })),
  );
  const [images, setImages] = useState<ImageRow[]>(() =>
    defaults.images.map((img) => ({ ...img, key: rowKey() })),
  );
  const [state, setState] = useState<ProductActionState>({});
  const [pending, startTransition] = useTransition();
  const errors = state.fieldErrors ?? {};

  const patchVariant = (key: string, patch: Partial<VariantRow>) =>
    setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  const patchImage = (key: string, patch: Partial<ImageRow>) =>
    setImages((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addImage = () => setImages((rows) => [...rows, { key: rowKey(), url: "", altText: "" }]);

  const moveImage = (key: string, dir: -1 | 1) =>
    setImages((rows) => {
      const i = rows.findIndex((r) => r.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rows.length) return rows;
      const next = [...rows];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const addVariant = () =>
    setVariants((vs) => [
      ...vs,
      {
        key: rowKey(),
        // Start with the same attribute names as the first variant (values blank) so the set
        // stays consistent, which the storefront's option picker relies on.
        attrs: (vs[0]?.attrs ?? [])
          .filter((a) => a.key.trim() !== "")
          .map((a) => ({ key: a.key, value: "" })),
        stock: "0",
        price: "",
        imageUrl: "",
      },
    ]);

  const submit = () => {
    setState({});
    startTransition(async () => {
      const res = await action({
        name,
        description,
        price,
        imageUrl,
        // A row left blank (no url typed yet) isn't saved.
        images: images
          .filter((img) => img.url.trim() !== "")
          .map((img) => ({ id: img.id, url: img.url, altText: img.altText })),
        isBestSeller,
        categoryId,
        variants: variants.map((v) => ({
          id: v.id,
          attributes: v.attrs,
          stock: v.stock,
          price: v.price,
          imageUrl: v.imageUrl,
        })),
      });
      // On success the action redirects, so a returned value is always a problem to show.
      if (res) setState(res);
    });
  };

  const err = (path: string) =>
    errors[path]?.map((e) => (
      <p key={e} className="text-xs text-destructive">
        {e}
      </p>
    ));

  return (
    <div className="flex flex-col xl:flex-row gap-8 items-start">
      <div className="grid w-full max-w-3xl gap-6 flex-1">
        <section className="grid gap-4 rounded-xl border p-5">
        <h2 className="font-semibold">Product</h2>
        <div className="grid gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
          {err("name")}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          {err("description")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="price">Base price (USD)</Label>
            <Input
              id="price"
              inputMode="decimal"
              placeholder="19.99"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-invalid={!!errors.price}
            />
            <p className="text-xs text-muted-foreground">Used by every variant without its own price.</p>
            {err("price")}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="category">Category</Label>
            <CategoryPicker id="category" options={categories} value={categoryId} onChange={setCategoryId} />
            {err("categoryId")}
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="imageUrl">Image URL</Label>
          <Input
            id="imageUrl"
            placeholder="https://..."
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            aria-invalid={!!errors.imageUrl}
          />
          <p className="text-xs text-muted-foreground">Optional. Variants can override it.</p>
          {err("imageUrl")}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isBestSeller}
            onChange={(e) => setIsBestSeller(e.target.checked)}
            className="size-4 accent-primary"
          />
          Best seller
          <span className="text-muted-foreground">&middot; shown in the Best sellers section</span>
        </label>
      </section>

      <section className="grid gap-4 rounded-xl border p-5">
        <div>
          <h2 className="font-semibold">Gallery images</h2>
          <p className="text-sm text-muted-foreground">
            Extra photos shown on the product page, in this order. The image URL above is always
            shown first; these are optional additions.
          </p>
          {err("images")}
        </div>

        {images.map((img, i) => (
          <div key={img.key} className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
            <div className="grid flex-1 gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label className="text-xs">Image URL</Label>
                <Input
                  aria-label={`Gallery image ${i + 1} URL`}
                  placeholder="https://..."
                  value={img.url}
                  onChange={(e) => patchImage(img.key, { url: e.target.value })}
                  aria-invalid={!!errors[`images.${i}.url`]}
                />
                {err(`images.${i}.url`)}
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Alt text (optional)</Label>
                <Input
                  aria-label={`Gallery image ${i + 1} alt text`}
                  value={img.altText}
                  onChange={(e) => patchImage(img.key, { altText: e.target.value })}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Move gallery image ${i + 1} up`}
                disabled={i === 0}
                onClick={() => moveImage(img.key, -1)}
              >
                &uarr;
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Move gallery image ${i + 1} down`}
                disabled={i === images.length - 1}
                onClick={() => moveImage(img.key, 1)}
              >
                &darr;
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove gallery image ${i + 1}`}
                onClick={() => setImages((rows) => rows.filter((r) => r.key !== img.key))}
              >
                &times;
              </Button>
            </div>
          </div>
        ))}

        <div>
          <Button type="button" variant="outline" size="sm" onClick={addImage}>
            Add image
          </Button>
        </div>
      </section>

      <section className="grid gap-4 rounded-xl border p-5">
        <div>
          <h2 className="font-semibold">Variants</h2>
          <p className="text-sm text-muted-foreground">
            Stock, and optionally price and image, are set per variant. Describe each variant with
            any attributes you like (size, color, material...). A product without real variation
            keeps one variant with no attributes. With several variants, all of them must use the
            same attribute names, and no two may be identical.
          </p>
          {err("variants")}
        </div>

        {variants.map((v, i) => (
          <div key={v.key} data-variant-row={i} className="grid gap-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {variants.length === 1 ? "Default variant" : `Variant ${i + 1}`}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={variants.length === 1}
                onClick={() => setVariants((vs) => vs.filter((x) => x.key !== v.key))}
              >
                Remove
              </Button>
            </div>

            <div className="grid gap-2">
              <span className="text-xs text-muted-foreground">Attributes</span>
              {v.attrs.map((a, ai) => (
                <div key={ai} className="flex items-center gap-2">
                  <Input
                    aria-label={`Variant ${i + 1} attribute name ${ai + 1}`}
                    placeholder="name, e.g. size"
                    value={a.key}
                    onChange={(e) =>
                      patchVariant(v.key, {
                        attrs: v.attrs.map((x, xi) => (xi === ai ? { ...x, key: e.target.value } : x)),
                      })
                    }
                  />
                  <Input
                    aria-label={`Variant ${i + 1} attribute value ${ai + 1}`}
                    placeholder="value, e.g. 40"
                    value={a.value}
                    onChange={(e) =>
                      patchVariant(v.key, {
                        attrs: v.attrs.map((x, xi) => (xi === ai ? { ...x, value: e.target.value } : x)),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Remove attribute"
                    onClick={() => patchVariant(v.key, { attrs: v.attrs.filter((_, xi) => xi !== ai) })}
                  >
                    &times;
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => patchVariant(v.key, { attrs: [...v.attrs, { key: "", value: "" }] })}
                >
                  Add attribute
                </Button>
              </div>
              {err(`variants.${i}.attributes`)}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1">
                <Label className="text-xs">Stock</Label>
                <Input
                  aria-label={`Variant ${i + 1} stock`}
                  inputMode="numeric"
                  value={v.stock}
                  onChange={(e) => patchVariant(v.key, { stock: e.target.value })}
                />
                {err(`variants.${i}.stock`)}
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Price override</Label>
                <Input
                  aria-label={`Variant ${i + 1} price override`}
                  inputMode="decimal"
                  placeholder={price || "base price"}
                  value={v.price}
                  onChange={(e) => patchVariant(v.key, { price: e.target.value })}
                />
                {err(`variants.${i}.price`)}
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Image override</Label>
                <Input
                  aria-label={`Variant ${i + 1} image override`}
                  placeholder="https://..."
                  value={v.imageUrl}
                  onChange={(e) => patchVariant(v.key, { imageUrl: e.target.value })}
                />
                {err(`variants.${i}.imageUrl`)}
              </div>
            </div>
          </div>
        ))}

        <div>
          <Button type="button" variant="outline" onClick={addVariant}>
            Add variant
          </Button>
        </div>
      </section>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
        <Link href="/admin/products" className={buttonVariants({ variant: "ghost" })}>
          Cancel
        </Link>
      </div>
      </div>

      <div className="w-full xl:w-80 shrink-0 sticky top-6">
        <h3 className="font-semibold mb-4 text-sm uppercase tracking-wider text-muted-foreground">Live Preview</h3>
        <ProductPreviewCard name={name} description={description} price={price} imageUrl={imageUrl} />
      </div>
    </div>
  );
}

function ProductPreviewCard({ name, description, price, imageUrl }: { name: string; description: string; price: string; imageUrl: string }) {
  return (
    <div className="rounded-3xl overflow-hidden border border-border shadow-sm bg-background">
      <div className="aspect-[4/3] bg-muted relative overflow-hidden flex items-center justify-center">
        {imageUrl ? (
          <img src={imageUrl} alt="preview" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-secondary/50 flex items-center justify-center text-muted-foreground/30 text-6xl">
            {name ? name.charAt(0).toUpperCase() : "P"}
          </div>
        )}
      </div>
      <div className="p-5">
        <div className="flex justify-between items-start gap-3 mb-2">
          <h3 className="text-base font-semibold text-foreground line-clamp-1">{name || "Product Name"}</h3>
          <span className="font-bold text-foreground shrink-0">${price || "0.00"}</span>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {description || "Add a description to see how it looks on the storefront."}
        </p>
      </div>
    </div>
  );
}
