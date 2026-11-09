"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Boxes, Images, Info } from "lucide-react";
import type { ProductActionState } from "./actions";
import { CategoryPicker, type CategoryOption } from "./category-picker";
import { SectionCard } from "@/components/admin/section-card";
import {
  AffixField,
  Field,
  FieldShell,
  FormActions,
  SwitchField,
  TextareaField,
} from "@/components/field";
import { ImageField } from "@/components/image-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveMessage, useT } from "@/lib/i18n/context";
import { encodeMessage } from "@/lib/i18n/types";
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

/**
 * The longest form in the admin, and the last one on the baseline (ADMIN_UI.md).
 *
 * Two things were wrong with how it was organised, beyond the markup. A product's **images were
 * in two panels** — the main photo sat two fields into "Basic details", with the best-seller
 * switch between it and the "More photos" panel below — so adding pictures meant working in two
 * places separated by something unrelated. And the panels, the section headers, the labelled
 * fields and the sticky save row were all private copies, built before the shared ones existed.
 *
 * Now: Details (what it is and what it costs), Photos (all of them), Sizes/colours/stock. The
 * ids `#name`, `#price`, `#category` and `#imageUrl` and the `data-variant-row` attribute are
 * part of `e2e:variants`' contract and are deliberately unchanged.
 */
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
  const t = useT();
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

  /** The field family takes already-resolved strings, so the dictionary stays with the caller. */
  const errs = (path: string) => errors[path]?.map((e) => resolveMessage(t, e));

  /** Errors for a path that has no field of its own — a whole collection's complaint. */
  const listError = (path: string) =>
    errs(path)?.map((e) => (
      <p key={e} className="text-sm text-destructive">
        {e}
      </p>
    ));

  const optional = t("common.optional");

  return (
    <div className="flex flex-col items-start gap-8 xl:flex-row">
      <div className="grid w-full max-w-3xl flex-1 gap-6">
        <SectionCard
          icon={Info}
          title={t("products.form.basicDetailsTitle")}
          description={t("products.form.basicDetailsText")}
          bodyClassName="grid gap-5"
        >
          <Field
            label={t("products.form.nameLabel")}
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            errors={errs("name")}
          />
          <TextareaField
            label={t("products.form.descriptionLabel")}
            name="description"
            optional={optional}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            errors={errs("description")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <AffixField
              label={t("products.form.priceLabel")}
              name="price"
              prefix="$"
              inputMode="decimal"
              placeholder="19.99"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              hint={t("products.form.priceHelp")}
              errors={errs("price")}
            />
            <FieldShell
              name="category"
              label={t("products.form.categoryLabel")}
              optional={optional}
              errors={errs("categoryId")}
            >
              <CategoryPicker
                id="category"
                options={categories}
                value={categoryId}
                onChange={setCategoryId}
              />
            </FieldShell>
          </div>
          <SwitchField
            label={t("products.form.bestSellerLabel")}
            name="isBestSeller"
            hint={t("products.form.bestSellerHelp")}
            checked={isBestSeller}
            onCheckedChange={setIsBestSeller}
          />
        </SectionCard>

        {/* Every image in one place. The main photo used to live in Basic details. */}
        <SectionCard
          icon={Images}
          title={t("products.form.photosTitle")}
          description={t("products.form.photosText")}
          bodyClassName="grid gap-5"
        >
          <FieldShell
            name="imageUrl"
            label={t("products.form.mainPhotoLabel")}
            hint={t("products.form.mainPhotoHelp")}
            errors={errs("imageUrl")}
          >
            <ImageField
              id="imageUrl"
              value={imageUrl}
              onChange={setImageUrl}
              invalid={!!errors.imageUrl}
            />
          </FieldShell>

          <div className="grid gap-3 border-t pt-5">
            <div className="grid gap-1">
              <p className="text-sm font-medium">
                {t("products.form.morePhotosTitle")}{" "}
                <span className="font-normal text-muted-foreground">{optional}</span>
              </p>
              <p className="max-w-prose text-xs text-muted-foreground">
                {t("products.form.morePhotosText")}
              </p>
              {listError("images")}
            </div>

            {images.map((img, i) => (
              <div
                key={img.key}
                className="flex items-start gap-2 rounded-md border bg-background p-3"
              >
                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label className="text-xs">{t("products.form.imageLabel")}</Label>
                    <ImageField
                      aria-label={resolveMessage(
                        t,
                        encodeMessage("products.form.galleryImageUrlAria", i + 1),
                      )}
                      value={img.url}
                      onChange={(url) => patchImage(img.key, { url })}
                      invalid={!!errors[`images.${i}.url`]}
                    />
                    {listError(`images.${i}.url`)}
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">{t("products.form.altTextLabel")}</Label>
                    <Input
                      aria-label={resolveMessage(
                        t,
                        encodeMessage("products.form.galleryImageAltAria", i + 1),
                      )}
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
                    aria-label={resolveMessage(
                      t,
                      encodeMessage("products.form.moveImageUpAria", i + 1),
                    )}
                    disabled={i === 0}
                    onClick={() => moveImage(img.key, -1)}
                  >
                    &uarr;
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={resolveMessage(
                      t,
                      encodeMessage("products.form.moveImageDownAria", i + 1),
                    )}
                    disabled={i === images.length - 1}
                    onClick={() => moveImage(img.key, 1)}
                  >
                    &darr;
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={resolveMessage(
                      t,
                      encodeMessage("products.form.removeImageAria", i + 1),
                    )}
                    onClick={() => setImages((rows) => rows.filter((r) => r.key !== img.key))}
                  >
                    &times;
                  </Button>
                </div>
              </div>
            ))}

            <div>
              <Button type="button" variant="outline" size="sm" onClick={addImage}>
                {t("products.form.addImage")}
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          icon={Boxes}
          title={t("products.form.variantsTitle")}
          description={t("products.form.variantsText")}
          bodyClassName="grid gap-5"
        >
          {listError("variants")}

          {variants.map((v, i) => (
            <div
              key={v.key}
              data-variant-row={i}
              className="grid gap-3 rounded-md border bg-background p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {variants.length === 1
                    ? t("products.form.defaultVariant")
                    : resolveMessage(t, encodeMessage("products.form.variantN", i + 1))}
                  {variantSummary(v) && (
                    <span className="ms-2 font-normal text-muted-foreground">
                      · {variantSummary(v)}
                    </span>
                  )}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={variants.length === 1}
                  onClick={() => setVariants((vs) => vs.filter((x) => x.key !== v.key))}
                >
                  {t("products.form.remove")}
                </Button>
              </div>

              <div className="grid gap-2">
                <span className="text-xs text-muted-foreground">
                  {t("products.form.optionsLabel")}{" "}
                  {variants.length === 1 && t("products.form.optionsNotNeeded")}
                </span>
                {v.attrs.map((a, ai) => (
                  <div key={ai} className="flex items-center gap-2">
                    <Input
                      aria-label={resolveMessage(
                        t,
                        encodeMessage("products.form.attrNameAria", i + 1, ai + 1),
                      )}
                      placeholder={t("products.form.attrNamePlaceholder")}
                      value={a.key}
                      onChange={(e) =>
                        patchVariant(v.key, {
                          attrs: v.attrs.map((x, xi) =>
                            xi === ai ? { ...x, key: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Input
                      aria-label={resolveMessage(
                        t,
                        encodeMessage("products.form.attrValueAria", i + 1, ai + 1),
                      )}
                      placeholder={t("products.form.attrValuePlaceholder")}
                      value={a.value}
                      onChange={(e) =>
                        patchVariant(v.key, {
                          attrs: v.attrs.map((x, xi) =>
                            xi === ai ? { ...x, value: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t("products.form.removeAttribute")}
                      onClick={() =>
                        patchVariant(v.key, { attrs: v.attrs.filter((_, xi) => xi !== ai) })
                      }
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
                    onClick={() =>
                      patchVariant(v.key, { attrs: [...v.attrs, { key: "", value: "" }] })
                    }
                  >
                    {t("products.form.addAttribute")}
                  </Button>
                </div>
                {listError(`variants.${i}.attributes`)}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1">
                  <Label className="text-xs">{t("products.form.stockLabel")}</Label>
                  <Input
                    aria-label={resolveMessage(
                      t,
                      encodeMessage("products.form.stockAria", i + 1),
                    )}
                    inputMode="numeric"
                    className="tabular-nums"
                    value={v.stock}
                    onChange={(e) => patchVariant(v.key, { stock: e.target.value })}
                  />
                  {listError(`variants.${i}.stock`)}
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">
                    {t("products.form.ownPriceLabel")}{" "}
                    <span className="font-normal text-muted-foreground">{optional}</span>
                  </Label>
                  <Input
                    aria-label={resolveMessage(
                      t,
                      encodeMessage("products.form.priceOverrideAria", i + 1),
                    )}
                    inputMode="decimal"
                    className="tabular-nums"
                    placeholder={
                      price
                        ? resolveMessage(t, encodeMessage("products.form.sameAsMain", price))
                        : t("products.form.sameAsMainPrice")
                    }
                    value={v.price}
                    onChange={(e) => patchVariant(v.key, { price: e.target.value })}
                  />
                  {listError(`variants.${i}.price`)}
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">
                    {t("products.form.ownPhotoLabel")}{" "}
                    <span className="font-normal text-muted-foreground">{optional}</span>
                  </Label>
                  <ImageField
                    aria-label={resolveMessage(
                      t,
                      encodeMessage("products.form.imageOverrideAria", i + 1),
                    )}
                    uploadLabel={t("products.form.uploadShort")}
                    value={v.imageUrl}
                    onChange={(url) => patchVariant(v.key, { imageUrl: url })}
                  />
                  {listError(`variants.${i}.imageUrl`)}
                </div>
              </div>
            </div>
          ))}

          <div>
            <Button type="button" variant="outline" onClick={addVariant}>
              {t("products.form.addVariant")}
            </Button>
          </div>
        </SectionCard>

        {/* A transition-driven form, so the submit stays a plain Button (ADMIN_UI.md §5). */}
        <FormActions error={state.error && resolveMessage(t, state.error)}>
          <Button onClick={submit} disabled={pending}>
            {pending ? t("products.form.saving") : submitLabel}
          </Button>
          <Link href="/admin/products" className={buttonVariants({ variant: "ghost" })}>
            {t("common.cancel")}
          </Link>
        </FormActions>
      </div>

      <div className="w-full shrink-0 xl:sticky xl:top-6 xl:w-80">
        <SectionCard
          title={t("products.form.previewHeading")}
          description={t("products.form.previewSubtext")}
        >
          <ProductPreviewCard
            name={name}
            description={description}
            price={price}
            imageUrl={imageUrl}
          />
        </SectionCard>
      </div>
    </div>
  );
}

function ProductPreviewCard({
  name,
  description,
  price,
  imageUrl,
}: {
  name: string;
  description: string;
  price: string;
  imageUrl: string;
}) {
  const t = useT();
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
        {imageUrl ? (
          // Deliberately not next/image: this previews LIVE FORM STATE, so imageUrl is whatever
          // the owner has typed so far. A half-typed URL makes next/image throw and takes the
          // whole admin page down, where an <img> just shows a broken image for a keystroke.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={t("products.form.previewAlt")}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-secondary/50 text-6xl text-muted-foreground/30">
            {name ? name.charAt(0).toUpperCase() : "P"}
          </div>
        )}
      </div>
      <div className="grid gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-1 text-base font-semibold">
            {name || t("products.form.previewNamePlaceholder")}
          </h3>
          <span className="shrink-0 font-bold tabular-nums">${price || "0.00"}</span>
        </div>
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {description || t("products.form.previewDescPlaceholder")}
        </p>
      </div>
    </div>
  );
}

/** "size: M, color: Black" for a variant's header, once it has filled-in options. */
function variantSummary(v: { attrs: { key: string; value: string }[] }) {
  return v.attrs
    .filter((a) => a.key.trim() && a.value.trim())
    .map((a) => `${a.key.trim()}: ${a.value.trim()}`)
    .join(", ");
}
