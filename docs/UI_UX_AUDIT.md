# Bridge88 UI/UX audit

Audit date: 10 Sep 2026. Design system: existing Bridge88 kit (`web/src/bridge88/`), not a muted-gray shadcn theme. Hierarchy stays ink + weight. Live app at `http://localhost:3000`.

Sources: Designers A–E (auth, dashboard/calendar/composer, media/AI, analytics/team/settings, tokens/admin). Live HTTP where noted. Token file `bridge88.css`.

## Design-system baseline (do not replace)

Spacing tokens today: 4 / 8 / 12 / 16 / 24 / 32 / 48. Missing 20 / 40 / 64 used ad hoc as `gap-5`, `mt-10`, `py-16`.
Cards: 24px pad, 24px radius, 1px hairline, no shadow.
Buttons: `min-h-10`, pill, hover 0.80.
Inputs: 48px min-height, 8px radius.
Page title: `b88-page-title`. Body 16px / 330.

## P0 — Broken usability

None found on public auth/marketing. Remaining product P0s from earlier QA (SVG upload 500, retry-publish 500) were already patched.

## P1 — Major visual / UX

| Area | Issue | Files |
|---|---|---|
| Marketing nav | 64px bar, not sticky 56px topbar; mobile brand + 3 CTAs do not wrap | `globals.css` `.marketing-nav` |
| Mobile CTAs | Intrinsic-width buttons on marketing, pricing, onboarding, account vs full-width auth submit | `page.tsx`, `pricing/page.tsx`, onboarding, account |
| Loading displacement | Resolved: root and History segment fallbacks were removed because they replaced useful content during client navigation | `app/loading.tsx`, `history/loading.tsx` |
| Calendar | 7-col grid crushes on mobile; status chips identical lime | `calendar-shell.tsx` |
| Form rows | 48px inputs next to 40px buttons | team, queue, campaigns |
| Composer media | historically `object-cover` / mixed preview radii | `composer-preview.tsx` |
| Dashboard next posts | historically listed old published rows | `w/[slug]/page.tsx` (partially fixed) |
| Mobile More | overflow sheet is not a dialog (focus/escape/scrim token) | `app-navigation.tsx` |
| Team role row | 48px full-width select vs 40px Save; wraps | `team/page.tsx` |
| Channel actions | Reconnect/Disconnect wrap onto two rows in 3-col grid | `channels/page.tsx` |
| Analytics KPIs | `gap-4` not 24px; “Not reported” wraps vs numerals | `analytics/page.tsx` |
| Media tiles | Fat `b88-card`s instead of dense AssetTile; `gap-5` | `media-library.tsx` |
| Assistant columns | `min-h-[620px]` list vs transcript; 8px vs 24px radius | `ai-assistant.tsx` |
| Topbar a11y | Search (mobile) and account avatar lack names | `w/[slug]/layout.tsx` |
| Dashboard failed KPI | `rounded-lg` wrapper clips 24px StatCard | `w/[slug]/page.tsx` |
| Calendar density | 7-col crush; no weekday header row | `calendar-shell.tsx` |

## P2 — Noticeable polish

- Auth story pane hidden below 760px; login has no product identity on phone.
- Pricing: 1→3 columns, no tablet 2-col; CTAs not pinned to card bottoms; desktop gutter `px-6` not 48px.
- Login footer `justify-between` can collide; field-level errors missing vs signup.
- Account read-only fields look editable.
- Buttons `text-[15px]` vs `--button-size:20px` (keep 15–16px readable; do not jump to 20px).
- Status/helper `text-sm` (14px) vs 16px body-small token.
- Table cells 12px inset vs card 24px — headings and columns miss a left edge.
- Composer hover 0.90, mixed selected treatments (pill vs ring vs border).
- Studio `min-h-[620px]` empty column on mobile.
- Arbitrary 18px product-mock padding; hero 72/56; auth 64/40; mobile 20px gutters.
- `.b88-label` margin 7px; input pad 14px.

## P3 — Minor

- Account `mt-14` / `py-14` (56px).
- Onboarding `gap-5` / `space-y-5` (20px).
- Error retry not full-width on mobile.
- Recurrence/AI job statuses raw uppercase.
- Icon sizes 15/16/17/18 mixed in one toolbar.

## What was changed

- Token aliases: `--nav-height`, `--sidebar-width`, `--gutter-desktop/mobile`, `--space-20/2xl/3xl`, `--control-size`, `--mobile-nav-height`. Marketing nav 56px sticky; auth compact header on mobile; pricing 1/2/3 columns with bottom CTAs; loading no longer uses `main#main-content`; table first-column flush; label 8px; read-only inputs use surface-soft.
- Calendar weekday headers, today marker, More dialog (Escape, scrim token), queue 40px slot controls, dashboard failed-KPI no longer clips the card. Mobile app padding now matches the 68px tab bar.
- Composer 24px grid (and Field className no longer wipes `b88-input`), preview as `b88-card`, assistant columns stretch without a 620px trap, denser media tiles with overlay Preview/Download, studio EmptyState plus job errors.
- Team role select shares a 40px row with Save; channel reconnect/disconnect stay one row; analytics `gap-6` and smaller “Not reported”; campaign swatch `shrink-0`; settings/billing 24/32/48 rhythm; notifications without href are not dead links; admin jobs retitled “Recent jobs”.

## Intentionally not changing

- Bridge88 ink/canvas, no gray body text, no card shadows, no extra gradients.
- Button `min-h-10` as the kit default (align adjacent selects down, do not inflate every CTA to 48px).
- Magenta only on Publish now.
- Official social brand logos (Lucide glyphs only).

## Root causes found by screenshot sweep (10 Sep, second pass)

`web/scripts/shots.mjs` captures every route at 1440x900 and 390x844 and asserts against
unstyled controls, inline labels, narrow textareas, and horizontal overflow.
`web/scripts/overflow.mjs` names the elements responsible for an overflow.

Four defects were systemic rather than per-page:

1. **`className` clobbered the base control class.** `Field`, `TextArea`, and `IconButton`
   spread `{...props}` *after* their own `className`, so any caller passing `className`
   silently deleted `b88-input` / the icon button's size. `settings` passed `mt-4` and got a
   199px-wide browser-default textarea. Fixed by merging in the kit; callers no longer need to
   repeat `b88-input`, and layout spacing goes through the new `containerClassName`.
2. **Hand-written `<label>` wrappers ate their own margin.** `<label>` is `display:inline`, so
   vertical margin from `space-y-*` was discarded and each select's label collapsed onto the
   control above it. Fixed with a `Select` kit component plus a `label:has(>.b88-label)`
   block rule as a safety net for any remaining hand-rolled markup.
3. **CSS grid blowout.** Bare `fr` tracks and implicit `auto` tracks keep a min-content floor,
   so a `truncate` row inside a card forced the whole page wider than the viewport (dashboard
   measured 534px at a 390px viewport). Every track is now `minmax(0,…)` with an explicit
   `grid-cols-1` for the single-column case.
4. **Bulk actions scrolled away.** The media selection toolbar sat above a long asset grid, so
   acting on assets chosen at the bottom meant scrolling back to the top. It is now
   `.b88-selection-bar`, fixed to the viewport, with all controls at `--control-size` and a
   matching pill radius.

## Performance conclusion (authoritative)

No measured route is genuinely slow when warm: current median TTFB is 36ms for the public
home, 67ms for Drafts, 86ms for Studio, 105ms for Analytics, and 148ms for Media. Media's
roughly 50ms overhead above the Dashboard control is unchanged from the earlier run; Analytics
now matches the Dashboard control. Their apparent regressions were dev-server load and
concurrent recompilation noise, not new query waterfalls.

Direct profiling attributes 1.4ms to Compose queries plus URL signing, 1.2ms to Studio, and
1.6ms to Drafts. URL signing itself is about 0.1ms. The earlier claim that signing was a major
warm-route cost is retracted. First-hit dev compilation ranged from 0.17s to 11.8s and accounted
for more than 95% of the delay in the visibly slow samples; that compilation cost is not part of
the production runtime. Do not optimize URL signing to address perceived page load time.

## Verification

- `npm run typecheck` — pass
- `npm run lint` — pass (1 pre-existing unused-var warning in `service.test.ts`)
- `npm test` — 20 files, 51 tests pass
- `npm run build` — pass (Next.js compiled; jose Edge Runtime warning from Auth.js is unchanged)
- `node scripts/shots.mjs` — 50 route/viewport combos, 0 issues

Note: `npm run build` and `npm run dev` share `web/.next`. Building while the dev server runs
replaces the dev output underneath it and the running app loses its CSS. Stop the dev server
first, or build with a separate `--distDir`.

1. Extend tokens (`--space-20`, `--space-2xl` 40, `--space-3xl` 64) and replace off-scale marketing/auth padding.
2. Shared layout: loading landmark, table inset, label 8px, input pad 12.
3. Marketing/pricing/auth/account responsive CTAs and sticky 56px nav.
4. Calendar/queue/dashboard remaining alignment.
5. Composer/AI/media density and contain frames.
6. Team/campaigns/channels wrapping and control heights.
