"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Boxes, Images, Info, type LucideIcon } from "lucide-react";
import type { ProductActionState } from "./actions";
import { CategoryPicker, type CategoryOption } from "./category-picker";
import { ImageField } from "@/components/image-field";
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
        <section className="grid gap-5 rounded-xl border bg-card p-6 shadow-xs">
        <SectionTitle icon={Info} title="Basic details" text="What shoppers see first: the name, photo, price and a short description." />
        <div className="grid gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
          {err("name")}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="description">Description <Optional /></Label>
          <Textarea id="description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          {err("description")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="price">Price (USD)</Label>
            <Input
              id="price"
              inputMode="decimal"
              placeholder="19.99"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-invalid={!!errors.price}
            />
            <p className="text-xs text-muted-foreground">Sizes or colours can have their own price further down.</p>
            {err("price")}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="category">Category <Optional /></Label>
            <CategoryPicker id="category" options={categories} value={categoryId} onChange={setCategoryId} />
            {err("categoryId")}
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="imageUrl">Main photo</Label>
          <ImageField
            id="imageUrl"
            value={imageUrl}
            onChange={setImageUrl}
            invalid={!!errors.imageUrl}
          />
          <p className="text-xs text-muted-foreground">Upload a photo, or paste a link to one. Square photos look best.</p>
          {err("imageUrl")}
        </div>
        <label className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
          <input
            type="checkbox"
            checked={isBestSeller}
            onChange={(e) => setIsBestSeller(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            <span className="block font-medium">Feature as a best seller</span>
            <span className="block text-muted-foreground">Shows this product in the Best sellers section of your homepage.</span>
          </span>
        </label>
      </section>

      <section className="grid gap-5 rounded-xl border bg-card p-6 shadow-xs">
        <div>
          <SectionTitle
            icon={Images}
            title="More photos"
            optional
            text="Extra photos shoppers can flip through on the product page. The main photo always comes first; use the arrows to change the order."
          />
          {err("images")}
        </div>

        {images.map((img, i) => (
          <div key={img.key} className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
            <div className="grid flex-1 gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label className="text-xs">Image</Label>
                <ImageField
                  aria-label={`Gallery image ${i + 1} URL`}
                  value={img.url}
                  onChange={(url) => patchImage(img.key, { url })}
                  invalid={!!errors[`images.${i}.url`]}
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

      <section className="grid gap-5 rounded-xl border bg-card p-6 shadow-xs">
        <div>
          <SectionTitle
            icon={Boxes}
            title="Sizes, colours & stock"
            text="Selling just one version? Only fill in how many you have. Selling sizes or colours? Click “Add variant” for each one and describe it, e.g. size = M, color = Black. Every version needs the same option names."
          />
          {err("variants")}
        </div>

        {variants.map((v, i) => (
          <div key={v.key} data-variant-row={i} className="grid gap-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {variants.length === 1 ? "Default variant" : `Variant ${i + 1}`}
                {variantSummary(v) && (
                  <span className="ml-2 font-normal text-muted-foreground">· {variantSummary(v)}</span>
                )}
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
              <span className="text-xs text-muted-foreground">
                Options {variants.length === 1 && "(not needed if there's only one version)"}
              </span>
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
                <Label className="text-xs">How many in stock</Label>
                <Input
                  aria-label={`Variant ${i + 1} stock`}
                  inputMode="numeric"
                  value={v.stock}
                  onChange={(e) => patchVariant(v.key, { stock: e.target.value })}
                />
                {err(`variants.${i}.stock`)}
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Own price <Optional /></Label>
                <Input
                  aria-label={`Variant ${i + 1} price override`}
                  inputMode="decimal"
                  placeholder={price ? `Same as main (${price})` : "Same as main price"}
                  value={v.price}
                  onChange={(e) => patchVariant(v.key, { price: e.target.value })}
                />
                {err(`variants.${i}.price`)}
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Own photo <Optional /></Label>
                <ImageField
                  aria-label={`Variant ${i + 1} image override`}
                  uploadLabel="Upload"
                  value={v.imageUrl}
                  onChange={(url) => patchVariant(v.key, { imageUrl: url })}
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

      {/* Stays in view while scrolling a long form, so saving is always one click away. */}
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
        <Link href="/admin/products" className={buttonVariants({ variant: "ghost" })}>
          Cancel
        </Link>
        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
      </div>
      </div>

      <div className="w-full xl:w-80 shrink-0 sticky top-6">
        <h3 className="mb-1 text-sm font-semibold">How it looks in your store</h3>
        <p className="mb-4 text-xs text-muted-foreground">Updates as you type.</p>
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

function SectionTitle({
  icon: Icon,
  title,
  text,
  optional,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  optional?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="grid gap-0.5">
        <h2 className="font-semibold">
          {title} {optional && <Optional />}
        </h2>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function Optional() {
  return <span className="text-xs font-normal text-muted-foreground">(optional)</span>;
}

/** "size: M, color: Black" for a variant's header, once it has filled-in options. */
function variantSummary(v: { attrs: { key: string; value: string }[] }) {
  return v.attrs
    .filter((a) => a.key.trim() && a.value.trim())
    .map((a) => `${a.key.trim()}: ${a.value.trim()}`)
    .join(", ");
}
