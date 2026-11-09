# The admin panel's UI baseline

One rule per pattern, for every screen under `app/admin`. The point is not taste — it is that a
merchant who learns one screen can read the next one, and that a new screen is quick to build
because the decision is already made.

**Scope.** `/admin` (store owner and staff). `/platform` is not covered yet and still uses
`components/ui/card`; nothing here is admin-specific in implementation, so the console can adopt
it later. The storefront is a different product with 13 templates and is explicitly out of scope.

**What this replaced.** The audit that produced it, over all 84 files under `app/admin`:

| Finding | Count |
|---|---|
| A boxed panel had four spellings | `rounded-lg border` ×33, `rounded-md border` ×14, `rounded-xl border` ×12, plus `Card` ×28 |
| Files using `Card` **and** a hand-rolled panel on the same screen | 9 |
| Bordered panels declaring **no** surface colour, on a `bg-muted/40` page | 23 of 33 — transparent panels beside opaque ones |
| `Field` imports | 2 files of 84, with forms on a dozen screens |
| Private copies of "a figure with a label" | 4 (`Stat`, `Figure`, `Pair`, plus `StatTile` itself) |
| `text-sm` / `text-xs` | 162 / 116 — against 14 uses of every larger size combined |

The primitives mostly existed. They were not the path of least resistance, which is the actual
problem this document fixes.

---

## 1. The page shell

`app/admin/(panel)/layout.tsx` owns it: `max-w-6xl`, `px-4 py-6`, `md:px-8 md:py-10`, on
`bg-muted/40`. **A page never declares its own container, width or page padding.**

A page's root element is `<div className="grid gap-4">` — or `gap-6` for a screen whose blocks are
unrelated to each other. Vertical rhythm is a `gap` on the parent, never a `mb-*`/`mt-*` on a
child, so moving a block never leaves a hole or a double gap behind.

## 2. Headers: a page, and a section

Two altitudes, and the difference is whether the thing has sub-pages.

**A page** calls `PageHeader` itself:

```tsx
<PageHeader
  title={t("orders.page.title")}
  description={t("orders.page.description")}        // one plain sentence, or omit it
  back={{ href: "/admin/orders", label: t("orders.back") }}  // only on a detail/child page
  actions={<Link href="/admin/products/new" className={buttonVariants()}>…</Link>}
/>
```

**A section** (Analytics, Marketing) puts `PageHeader` in its `layout.tsx` and follows it with
`SectionTabs`; its pages then start at `SectionHeading`, not at a second `h1`. One `h1` per
document.

`SectionTabs` renders real `<Link>`s to real routes, so a tab is bookmarkable, opens in a new
window and survives a reload. **Never replace it with a state-driven tab panel.**

## 3. Panels: one treatment

**`SectionCard` (`components/admin/section-card.tsx`) is the only panel in `/admin`.**

```tsx
<SectionCard title={t("delivery.fee.title")} description={t("delivery.fee.description")}>
  …
</SectionCard>
```

It is `rounded-lg border bg-card p-4`. Three things that were wrong before it:

- **It names its surface.** The page is `bg-muted/40`; a panel with no `bg-*` is transparent and
  shows the grey through it. 23 of 33 bordered panels did exactly that, so the panel you were
  looking at was opaque or not depending on which screen you were on — and one was `bg-muted/40`,
  the same colour as the page, visible only by its border.
- **One radius.** `--radius` is `0.625rem` and `rounded-lg` is exactly it; `rounded-md` is 0.8× and
  `rounded-xl` is 1.4×. Three radii on one screen read as three different kinds of object.
- **The title is part of the panel.** A panel whose heading is a loose `<h2>` above it drifts out
  of alignment the moment someone changes the gap.

**`components/ui/card` is not used under `app/admin`.** It is a different object — `rounded-xl`,
`ring-1 ring-foreground/10` instead of a border, `overflow-hidden`, its own `--card-spacing`, and
`font-heading` on its title, which in admin resolves to the sans stack anyway because the heading
font is scoped to `[data-theme-scope]` and belongs to a *store's* theme. It stays for `/platform`,
`/login` and the one template that uses it. `scripts/verify-admin-ui.ts` fails on an import of it
from `app/admin`.

A nested box inside a panel — a row, a line item, a preview — is `rounded-md border bg-background`
and is deliberately one step tighter than its parent.

## 4. The type scale

Four sizes. Admin was 162 `text-sm` and 116 `text-xs` against 14 uses of everything larger
combined, which is why it read as a wall of small grey text.

| Role | Class | Where |
|---|---|---|
| Page title | `text-2xl font-semibold tracking-tight` | `PageHeader` only |
| Section title | `text-lg font-medium` | `SectionHeading`, `SectionCard`'s `title` |
| Body | `text-sm` | the default; do not write it on body text, it is inherited |
| Meta | `text-xs text-muted-foreground` | labels, hints, timestamps, counts |

A **description** under a title — `PageHeader`'s, `SectionCard`'s — is a sentence, so it is body
(`text-sm text-muted-foreground`), not meta. `text-xs` is for things that are not sentences.

A **figure** is not type — it is `StatTile`, below.

`text-muted-foreground` is for text that is genuinely secondary. It is not a way to make a screen
look calmer; three greys stacked on each other means nothing on the screen has weight.

## 5. Forms

`Field` (`components/field.tsx`) for every labelled input, and `FormError` for the form's own
failure. No hand-rolled `<label>` + `<Input>` pair: label-to-input spacing, where the hint sits,
where the error sits and `aria-invalid` are decided once.

```tsx
<form action={action} className="grid gap-4">
  <Field label={t("product.name")} name="name" errors={state?.errors?.name} hint={…} />
  <FormError message={state?.message} />
  <SubmitButton>{t("common.save")}</SubmitButton>
</form>
```

- A hint and an error never show together — `Field` already suppresses the hint when there is an
  error, so the field never gives advice and a complaint at once.
- `SubmitButton` disables itself through `useFormStatus`. Every submitting control uses it, so a
  double submit is prevented in one place.
- A money input holds **the text the person typed**, never a re-formatted number. A controlled
  field that reformats on each keystroke cannot be typed into: `2` becomes `2.00`, the `.` of
  `2.50` lands after it, and the value silently settles on `2.01`. That shipped once, in the till.
- A rule the server or the database enforces is also checked on screen, and the submit is disabled
  until the form is one the server will accept. A refusal that arrives after the person has acted
  is worse than a field that says no while they are still looking at it.

## 6. Lists

In order, every list screen: `PageHeader` → filters → the table → pagination.

- `components/ui/table` for tabular data. Cards-instead-of-rows only where a row genuinely does
  not fit a phone, and then the same data in the same order.
- **`EmptyState` is not optional.** Every list has one, with the one action that fills it. A bare
  "No results." is the state a merchant sees on their first day.
- `AdminPagination` + `AdminPageSizeControl`, server-side, with `normalizeAdminPageSize`. Never a
  client-side slice of a full fetch.
- `ConfirmDialog` for anything destructive, naming what will be destroyed and whether it can be
  undone.

## 7. Figures

`StatTile` (`components/admin/stat-tile.tsx`) for every number a merchant reads as a measurement —
takings, counts, rates. It carries three rules worth more than its look: the number is **exact**
(3 sessions reads "3", never "a few"), a percentage with **no denominator is not shown**, and a
trend verdict never travels without the sentence that produced it.

The till's `Figure` was a private copy of this, and is gone.

Two things that look like copies and are **not**, kept apart on purpose:

- **A navigational tile** — the dashboard's, with an icon, a tone and a link — is not a
  measurement; it is a door with a number on it. It stays local to the dashboard, because it has
  exactly one consumer and a component carrying `icon`, `tone`, `href`, `delta`, `trend` and
  `unmeasured` would serve neither caller well. It owes the baseline only the panel and the figure
  size.
- **A detail** — "Sold by: Amina", "Paid by: Cash" — is a fact about one record, not a figure. It
  is `Detail` inside a `DetailList` (`components/admin/detail-list.tsx`), a real `<dl>`, which is
  what the receipt's `Pair` and the order detail's loose `dt`/`dd` pairs both became.

**A figure is `text-2xl`, never `text-3xl`** — a number on a page must not outrank the page's own
title. The dashboard's tiles came down a step for this.

Money from two channels is **never summed into one figure** — online and in-store are separate
tiles. `verify:aggregates`' P4-22b fails if anything adds them.

## 8. Arabic, RTL, and the phone

- Logical properties only: `ms-*`/`me-*`, `ps-*`/`pe-*`, `start-*`/`end-*`. Never `ml-*`, `pr-*`,
  `left-*`. A directional icon gets `rtl:rotate-180` (`PageHeader`'s back arrow is the example).
- Every string comes from `lib/i18n/dictionaries/{en,ar}.ts`. Both files, in the same commit.
- A number is `tabular-nums` wherever it can change — a total that shifts width as it updates
  reads as a glitch.
- Every screen is usable at phone width with no horizontal page scroll. A two-column screen is
  one column below `md`, and the column a person acts in comes first.

## 9. What enforces this

`pnpm verify:admin-ui` — static, no server, no database. Four rules, each one a thing that
actually happened here rather than a preference:

1. `components/ui/card` is not imported under `app/admin`.
2. Every panel names its surface — a solid `rounded-* border` with no `bg-*` fails. **A dashed
   border is exempt**, and the distinction is real: dashed means provisional (an empty-table note,
   a "not measuring yet" placeholder) and it is drawn *inside* a panel, on the surface that panel
   already established. Giving it `bg-card` would stack a second card inside the first.
3. One `h1` per page — a page under a section layout that already renders `PageHeader` may not add
   another.
4. No physical-direction classes (`ml-`, `pr-`, `left-`).

**`PENDING` is the honest part.** The not-yet-converted screens are listed by name in the script.
The check asserts that list does not **grow**, and that every entry still earns its place — an
entry that is already clean *fails*, so the list cannot rot into a permanent exemption. It shrinks
as screens are converted, and the fix for a new violation is never to add a line to it.

**Still to convert** (16 files, in the script's `PENDING`): the dashboard, products, categories,
discounts and coupons, the order detail, delivery, social links, marketing integrations,
change-password, and the staff manager. One fold is tracked here rather than by the checker, since
it needs a server-run suite to confirm: `analytics/live-visitors.tsx` is a fifth copy of `StatTile`
with one extra state (the live source being unreachable), and folding it in means giving `StatTile`
that state and re-running `verify:report-states`.

It cannot check whether a screen is *good*. That is still a person looking at it.
