# The admin panel's UI baseline

One rule per pattern, for every screen under `app/admin` and `app/platform`. The point is not
taste — it is that a merchant who learns one screen can read the next one, and that a new screen
is quick to build because the decision is already made.

**Scope.** Both tools: `/admin` (store owner and staff) and `/platform` (the platform operator).
They share every primitive in this document and differ in exactly one thing, their palette — see
§10. The storefront is a different product with 13 templates and is explicitly out of scope.

**What this replaced.** The audit that produced it, over all 84 files under `app/admin`:

| Finding | Count |
|---|---|
| A boxed panel had four spellings | `rounded-lg border` ×33, `rounded-md border` ×14, `rounded-xl border` ×12, plus `Card` ×28 |
| Files using `Card` **and** a hand-rolled panel on the same screen | 9 |
| Bordered panels declaring **no** surface colour, on a `bg-muted/40` page | 23 of 33 — transparent panels beside opaque ones |
| `Field` imports | 2 files of 84 in `/admin` — while `/platform` used it in 15. See §5 for why |
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

**An optional `icon`** puts a mark in a muted chip beside the title. It earns its place only on a
long multi-section form, where the icons are what let someone find "photos" again after
scrolling; the product form is the one screen that has it. A panel that is one of two on a page
does not need one, and a page where only some panels have icons looks broken. It exists so that a
long form does not grow a fifth private section header, which is what the product form had.

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

**Why the admin had `Field` in 2 files while the platform console had it in 15.** `Field` wrapped
`<Input>` and nothing else. The console's forms are all plain text inputs, so it fitted; every
admin form has a `<select>`, a `Textarea`, a `Switch` or an affixed number somewhere, and a form
drops out of `Field` at the first one — after which the remaining fields get hand-rolled too, for
consistency *inside that file*. The category form is the proof: it used `Field` for the name and
hand-rolled the parent `<select>` directly underneath.

Worse, the hand-rolled versions were **better**: they wired `aria-describedby` to the hint and the
error, which `Field` did not. Adopting it was an accessibility downgrade.

So `components/field.tsx` is now one member per kind of control, all over one `FieldShell`:

| | |
|---|---|
| `Field` | a text input |
| `AffixField` | a number with a `$` or `%` affix |
| `TextareaField` | a textarea |
| `SelectField` | a `<select>`, styled exactly as `Input` (it had three different spellings) |
| `SwitchField` | a switch with its label and explanation beside it, not above it |
| `FormError` | the form's own failure |
| `FormActions` | the row a form ends with (four files carried it verbatim, one had drifted) |

The shell decides four things once: the label is bound to the control by id; the hint and the error
are bound by `aria-describedby`; a hint and an error never show together; and `aria-invalid`
follows the errors rather than a separate flag that can disagree with them.

```tsx
<form action={action} className="grid gap-4">
  <Field label={t("common.name")} name="name" errors={resolve(state.fieldErrors?.name)} hint={…} />
  <FormActions status={state.ok ? t("saved") : undefined} error={…}>
    <SubmitButton>{t("common.save")}</SubmitButton>
  </FormActions>
</form>
```

- `errors` are **already-resolved strings**. The caller holds the dictionary, because this module
  has no hooks and must stay renderable from a Server Component.
- `SubmitButton` disables itself through `useFormStatus`, so **a form with an `action` always uses
  it**. A form that drives a `useTransition` instead (the discount and coupon forms) keeps its own
  `Button disabled={pending}` — `useFormStatus` reports nothing there, so `SubmitButton` would
  never show its pending label. Say which, in a comment, when it is the second kind.
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

## 8. The journey: how the sidebar is grouped

Thirteen destinations in one flat column is not a menu, it is a list — and the order had drifted
into none at all. Delivery sat fourth, between the till and the catalogue; Social links sat
ninth. Both are `settings:write`, and there was no Settings anywhere, so the two screens that set
the store's own word to shoppers were top-level siblings of Orders. Categories sat below
Discounts, splitting the catalogue in half around pricing. Home and Analytics — the same
capability, `analytics:read` — were at positions 1 and 11.

`components/admin/admin-nav.tsx` now groups them by **what the person is doing**, which is the
only ordering that survives someone adding a fourteenth screen:

| Group | What it holds | Why |
|---|---|---|
| **Daily** | Home, Orders, Till | What the panel is opened to do. The dashboard is a report screen too, but it is also where the day starts |
| **Catalogue** | Products, Categories, Discounts | Categories is the other half of Products, so pricing follows both instead of splitting them |
| **Storefront** | Store content, Delivery, Social links | Everything a shopper reads as the store's own word |
| **Insight** | Analytics, Marketing | The screens that only report |
| **Your account** | Notifications, Staff, Change password | Drawn in the footer with the e-mail, the language switch and Log out — the things about the *person*, which used to be at positions 12, 13 and the footer |

- **A group with nothing in it is not drawn.** That is what makes a staff member's sidebar read
  as a short job description rather than as a stripped-down owner's: they see Daily and
  Catalogue, each labelled, not four links with no shape.
- **The capability still decides the link**, exactly as before (D72). A group is presentation; it
  grants nothing, and `verify:staff` still asserts the sidebar offers exactly what the role may
  open.
- **The phone gets one Menu button, not a strip.** All thirteen destinations used to be a
  horizontally scrolling row, which put most of the product off-screen with nothing saying so —
  and no amount of reordering fixes a strip whose end you cannot see. The disclosure shows the
  whole structure at once. The pending-order count stays in the header with the menu shut,
  because that is the one thing the strip said at a glance.
- **"Open" is derived from the path, not closed by an effect.** The menu stores the path it was
  opened at and compares during render, so a navigation closes it with no second render — and
  the back button, which changes the path without going through a link, closes it too.

## 9. Colour

The palette was `oklch(L 0 0)` on **every** token, chroma exactly zero, `--chart-1` to
`--chart-5` included. The admin was achromatic by construction, and `--primary` was near-black,
so the active nav item and a primary button were the same black. The only chroma on a screen was
the amber pending badge and the destructive tint — which is why six quiet `bg-destructive/10`
Delete buttons read as the loudest thing on the products list. They were never a solid red; in a
greyscale UI the only colour wins whatever its strength.

- **One accent, hue 265 (indigo).** `--primary`, `--ring` and the two `--sidebar-*` equivalents,
  in `:root` and `.dark`. It carries the active nav item, primary buttons and focus rings.
- **White text in both modes**, which is the opposite of what dark mode used to do (a near-white
  primary with dark text). Light is `oklch(0.52 0.17 265)` and dark `oklch(0.55 0.17 265)` —
  **measured**, not estimated: white-on-accent is 5.47:1 light and 4.82:1 dark. The dark value
  started at `0.58` and gave 4.20:1, under the 4.5 line, which arithmetic on paper had said was
  fine.
- **The neutrals carry a whisper of the same hue** (chroma 0.003–0.005) so the accent reads as
  part of the palette rather than bolted onto grey.
- **`--destructive` is unchanged**, and so is the `destructive` button variant. It was already
  the quiet treatment: a 10% tint with coloured text. Once an accent exists it stops being the
  only colour, and the ranking fixes itself.
- **This cannot reach a storefront.** `ThemeScope` (`components/theme-scope.tsx`) sets
  `--primary`, `--ring`, `--background`, `--border` and the rest **inline** on a wrapper div, and
  `app/store/[slug]/layout.tsx` wraps every store route in it — so a store's own colours shadow
  `:root` inside that subtree, and both previews with it.
- **It does not reach the platform console either**, which is monochrome on purpose (§10). So
  `:root` is now the merchant panel's palette and the login page's, and nothing else.

## 10. The platform console: same shapes, no colour

The console is a different tool for a different person. It configures stores it does not own, and
every store it configures has colours of its own — the theme editor puts one on screen in an
iframe. An indigo accent there would be a fourth brand competing with whichever store is being
previewed, so the console keeps the shapes and drops the hue.

- **`.console-neutral`** (`app/globals.css`) redefines `--primary`, `--secondary`, `--muted`,
  `--accent`, `--border`, `--input` and `--ring` with chroma 0, in both schemes. It is applied
  once, on the wrapper in `app/platform/(admin)/layout.tsx`, so a new console screen cannot be
  added without it.
- **A subtree class, not a second `:root`.** The same mechanism `ThemeScope` uses, for the same
  reason: a subtree override is the only way to keep one palette out of another's way in a single
  document. The token *names* are unchanged, which is the whole point — the shared components are
  the same components here, with no console branch.
- **`--primary` inverts between the schemes**: `oklch(0.205 0 0)` on white, `oklch(0.985 0 0)` on
  black. A monochrome accent has nowhere else to go — it has to be the far end of the lightness
  axis to read as emphasis. Measured in the browser: every console token resolves to chroma **0**
  in both schemes, while `:root`'s `--primary` keeps its indigo, so the scope leaks in neither
  direction.
- **`--destructive` keeps its red, deliberately.** On a screen with no other colour, red means
  "this is irreversible" and nothing else can. It is the Danger zone's border and a failed DNS
  lookup; it is a *token*, so it stays red by choice rather than by accident.
- **Emphasis is weight and surface.** The active nav item is `bg-muted font-medium`, a completed
  checklist item is a filled near-black tick, and the "needs setup" dot in `StoreNav` is
  `bg-foreground` where it used to be amber. The DNS check lost its green and amber and lost
  nothing with them: its glyphs already said the same thing twice.
- **The theme editor is outside the scope, on purpose.** It lives at
  `app/platform/stores/[slug]/theme`, outside the `(admin)` group, because its entire subject is
  a store's colours. A rule banning hue there would ban the feature. It is still held to every
  other rule.

**What the console looked like before.** Ten files importing `components/ui/card`; eight bordered
boxes with no surface, on a page that had no shell colour either, so a panel showed as a bare
border; five `h1`s where a section layout already owned one; a top bar whose five links were all
the same grey with no current-section state, and a create action sitting among them as a sixth
link; and four hardcoded palette colours that `.console-neutral` would have sailed straight past.

## 11. Arabic, RTL, and the phone

- Logical properties only: `ms-*`/`me-*`, `ps-*`/`pe-*`, `start-*`/`end-*`. Never `ml-*`, `pr-*`,
  `left-*`. A directional icon gets `rtl:rotate-180` (`PageHeader`'s back arrow is the example).
  **The one exemption is `AffixField`**, where a `$` or `%` stays on the LTR side in both
  languages: numeric formatting is a stated non-goal, so figures render in Latin digits with a
  leading `$` either way and flipping only the affix would read as a bug. Two forms used to carry
  those classes themselves; now neither does, and the exemption is written down once, in the
  component, next to the classes it excuses.
- Every string comes from `lib/i18n/dictionaries/{en,ar}.ts`. Both files, in the same commit.
- A number is `tabular-nums` wherever it can change — a total that shifts width as it updates
  reads as a glitch.
- Every screen is usable at phone width with no horizontal page scroll. A two-column screen is
  one column below `md`, and the column a person acts in comes first.

## 12. What enforces this

`pnpm verify:admin-ui` — static, no server, no database. It walks **both** `app/admin` and
`app/platform`, with a separate pending list for each, so a console backlog can never be parked
in the panel's list and quietly weaken the stronger promise. Six rules, each one a thing that
actually happened here rather than a preference:

1. `components/ui/card` is not imported under either tool.
2. Every panel names its surface — a solid `rounded-* border` with no `bg-*` fails. **A dashed
   border is exempt**, and the distinction is real: dashed means provisional (an empty-table note,
   a "not measuring yet" placeholder) and it is drawn *inside* a panel, on the surface that panel
   already established. Giving it `bg-card` would stack a second card inside the first.
3. **A panel is `rounded-lg`** — a bordered or surfaced `rounded-xl`/`2xl`/`3xl` fails.
   `rounded-md` is not listed, because that is the nested box and is meant to be tighter. **One
   box opts out**: the content editor's preview frame is drawing a phone around a storefront
   iframe, so its radius is a picture of a device rather than a surface treatment. It carries
   `admin-ui-allow-radius:` in the comment immediately above — per occurrence, with a reason,
   never file-wide, the same idiom `AffixField` uses for its direction classes.
4. One `h1` per page — a page under a section layout that already renders `PageHeader` may not add
   another.
5. No physical-direction classes (`ml-`, `pr-`, `left-`).
6. **The console is monochrome** — a hardcoded palette class (`text-amber-700`, `bg-emerald-500`)
   under `app/platform/(admin)` fails. Scoped to that group, not the whole of `/platform`, because
   the theme editor sits outside it (§10). `--destructive` is not covered: it is a token, and red
   is the console's one deliberate hue.

**`PENDING` is the honest part.** The not-yet-converted screens are listed by name in the script.
The check asserts that list does not **grow**, and that every entry still earns its place — an
entry that is already clean *fails*, so the list cannot rot into a permanent exemption. It shrinks
as screens are converted, and the fix for a new violation is never to add a line to it.

**Every screen in both tools is on the baseline**, so both pending lists are empty and a
violation is now a regression rather than a backlog item. The fix for one is the screen, never a
line in either list.

**That claim was once broader than the checker.** When `PENDING` was first emptied, the product
form still had three `rounded-xl border bg-card p-6` panels, its own icon'd section header, its
own labelled-field markup, its own sticky save row and a `rounded-3xl` preview card — and all
four rules passed on it, because none of them asked what shape a panel is or whether a field came
from `components/field.tsx`. Rule 3 above is the half of that gap a machine can hold; the other
half — "this file re-implements a primitive" — is not something a regex should be trusted to
judge, so it stays a review question. The lesson is the general one: a green check means the
rules passed, not that the screen is on the baseline.

**The same was true of the scope.** For as long as the checker walked only `app/admin`, it
reported "every admin screen on the baseline" while ten console files imported
`components/ui/card` — true as written, and misleading. Rules 1-5 found eight unsurfaced panels,
an `ml-auto` and a `rounded-xl` the moment the walk was widened, none of which were new.

One fold is tracked here rather than by the checker, since it needs a server-run suite to
confirm: `analytics/live-visitors.tsx` is a fifth copy of `StatTile` with one extra state (the
live source being unreachable), and folding it in means giving `StatTile` that state and
re-running `verify:report-states`.

Two things found while converting and deliberately **not** fixed here, because neither is a UI
decision: `staffAccountSchema` (`lib/validation.ts`) returns plain English strings where every
other schema returns dictionary keys, so those two field errors do not translate; and
`SubmitButton`'s default `pendingText` is the hardcoded English `"Saving…"`.

It cannot check whether a screen is *good*. That is still a person looking at it.
