# Bridge88 Design System — drop-in package

Everything Claude (or a human) needs to build Bridge88 UI. No build step, no dependencies beyond React.

## Install

1. Copy this folder into your repo — `src/bridge88/` is a good home.
2. Import the stylesheet once at your app root:
   ```js
   import './bridge88/bridge88.css';
   ```
3. Import components where you need them:
   ```jsx
   import { Button } from './bridge88/components/buttons/Button.js';
   import { MediaFrame } from './bridge88/components/media/MediaFrame.js';

   <Button variant="primary">Start free</Button>
   <MediaFrame ratio="4:5" tone="mint" alt="Spring set" />
   ```
4. Dark mode: set `data-theme="dark"` on `<html>` (or `class="b88-dark"` on any subtree). Every token flips; no component changes needed.

Files are `.js` containing JSX — fine for Vite, Next and CRA. Rename to `.jsx`/`.tsx` if your setup prefers it; prop contracts are in `COMPONENTS.md`.

## Point Claude at this

Add to your repo's `CLAUDE.md`:

```md
When building UI, follow src/bridge88/README.md and use the components in
src/bridge88/components — see src/bridge88/COMPONENTS.md for props and usage.
Never hand-roll a component that already exists there.
```

## Two substitutions to replace

- **Fonts** — `bridge88.css` pulls **Geist / Geist Mono** from Google Fonts as a stand-in for the licensed brand faces. Swap the `@import` for real `@font-face` rules when you have the files.
- **Icons** — `components/icon/Icon.js` loads **Lucide** from a CDN. In a real app, `npm i lucide-react` and rewrite that one file, or point it at your own set. Nothing else touches icons.

## Components

| Group | Components |
|---|---|
| `buttons/` | Button, IconButton |
| `forms/` | TextInput, Select, SegmentedTabs, Checkbox, RadioGroup, Switch |
| `surfaces/` | ColorBlockSection, PricingCard, TemplateCard, FeatureTile, PromoBanner |
| `navigation/` | TopNav, SidebarNav, MarqueeStrip, Footer |
| `data/` | FeatureRow, StatCard, CheckGlyph |
| `feedback/` | Dialog, Toast, Tooltip |
| `core/` | Badge, Avatar, EmptyState |
| `media/` | MediaFrame, VideoPlayer, MediaCarousel, MediaUploader, AssetTile |
| `icon/` | Icon |

## Token quick reference

```
colour     --ink --canvas --primary --on-primary --surface-soft --hairline --hairline-soft
           --block-lime --block-lilac --block-cream --block-pink --block-mint --block-coral --block-navy
           --accent-magenta --success --scrim-modal
type       --font-sans --font-mono
           --display-xl-* --display-lg-* --headline-* --subhead-* --card-title-*
           --body-lg-* --body-* --body-sm-* --link-* --button-* --eyebrow-* --caption-*
           weights: 320 330 340 480 540 700 (nothing between)
space      --space-hair/xxs/xs/sm/md/lg/xl/xxl/section  (1 4 8 12 16 24 32 48 96)
radius     --radius-xs/sm/md/lg/xl/pill/full  (2 6 8 24 32 50 9999)
depth      --elevation-1-border --elevation-2 --elevation-3 --scrim-modal
motion     --ease-standard --duration-fast/base/slow --press-scale --hover-opacity
```

## Rules not to break

1. Every text CTA is a pill; every icon button is a circle. Nothing is square.
2. Selected state = the primary (black) surface. Never a coloured selected state.
3. Hierarchy comes from **weight**, not opacity. There is no mid-gray text role.
4. One colour block per viewport, always separated by white canvas. Never shadow a block.
5. Cards are stroked, not shadowed. Colour is the depth device.
6. Magenta is one promo CTA per page. Green appears only as a glyph.
7. Mono type is taxonomy only — eyebrows, captions, chips, metadata. Never a paragraph.
8. Hover = opacity 0.80. Press = scale 0.97. No colour-shift states.
9. Media is aspect-locked per network, 8px corners, never cropped, no shadow.
10. No emoji, anywhere.

---

## Content fundamentals

**Voice.** Plain, technical, unhurried. Bridge88 describes what the product does and stops. The register is a competent colleague explaining their setup, not a brand performing enthusiasm.

**Person.** Second person for the reader ("Write it once", "Tell us what you're automating"), first-person plural only for the company's own actions ("We reply within one business day"). Never first-person singular. The product is named as an actor: "Bridge88 posts it everywhere", "Bridge88 will attach the channel breakdown."

**Casing.** Sentence case for every headline, button, label and nav item — "Start free", "Add to queue", "Compare plans". The only uppercase is the mono taxonomy layer: eyebrows and captions ("SCHEDULING", "THIS WEEK'S QUEUE", "4 CHANNELS"). Never title-case a headline.

**Sentence shape.** Headlines are one clause, often split across two lines with a hard break: "Write it once. / Bridge88 posts it everywhere." Body paragraphs run one to two sentences and carry a concrete noun — channels, queue, reviewer, invoice. Numbers are exact ("15 channels", "184k", "+0.6pt"), never "tons" or "10x".

**Copy that carries the product.** Automation rules are written as plain sentences, and shown that way in the UI: "If a post beats 2× median reach → re-queue in 30 days." Feature names are literal — Queue, Composer, Automations, Analytics, Channels.

**Punctuation.** Em dashes sparingly, mid-sentence only. The middot separates metadata ("Northwind · 12 channels", "Auto · 30 days"). No exclamation marks anywhere.

**No emoji.** Not in UI, not in marketing, not in empty states. The mono caption layer does the labelling emoji would otherwise do.

**FAQ and support copy** answers the question in the first four words, then explains: "No — remove a seat and billing prorates on the next invoice."

**Vibe check:** if a line would sound odd said flatly to a colleague at a desk, rewrite it.

## Visual foundations

**Colour.** Two systems in one. The frame is monochrome: `--ink` #000 on `--canvas` #fff, with `--surface-soft` #f7f7f5 tiles and 1px `--hairline` #e6e6e6 rules. The narrative layer is seven pastel grounds — lime #dceeb1, lilac #c5b0f4, cream #f4ecd6, pink #efd4d4, mint #c8e6cd, coral #f3c9b6, navy #1f1d3d. Exactly one accent, magenta #ff3d8b, one promo CTA per page. Green #1ea64a exists only as a check glyph. There is **no mid-gray text role** — hierarchy comes from weight, never opacity.

**Dark mode.** `[data-theme="dark"]` inverts ink and canvas (#fff on #0b0b0c), deepens tiles to #17181a, and holds every block hue at roughly 12% lightness (lime → #28331a, lilac → #2a2350) so the panel rhythm survives. Magenta and green lift slightly for contrast. Dark mode ships in the app; marketing stays light.

**Type.** One variable sans for everything, one mono for taxonomy. Display runs 86px and 64px at weight 340 with hard negative tracking (-1.72px, -0.96px) and 1.00–1.10 line height. Body sits 20/18/16px at weights 330/320/330 with 1.40–1.45 leading. Emphasis is a weight change at the same size — a 20px link at 480 next to 20px body at 330. Legal weights: 320, 330, 340, 480, 540, 700; nothing between. Mono is uppercase with positive tracking, and never sets a paragraph.

**Spacing & layout.** 8px base; 96px between major sections, 48px inside a colour block, 24px inside a card, 16px inside a tile. Content maxes at 1280px with 48px desktop gutters collapsing to 24px on mobile. Colour blocks break the column grid — they span content width and hold a single editorial column with generous side margins, poster-like rather than dense. The nav is 56px and sticky; the marquee ribbon is 36px.

**Media.** Every image and video sits in one frame type: 8px corners, aspect-locked to the network it will publish to (1:1 and 4:5 feed, 9:16 stories and shorts, 16:9 YouTube, 1.91:1 link cards). Frames never crop the composition and carry no shadow — a media frame on a colour block is flat. Chrome over media is limited to mono uppercase chips on the inverse surface (duration bottom-right, type or "ALT MISSING" top-left) and the documented circular icon button at 55–60% black for play, previous and next. Selection is a 1px ink outline plus a soft fill, never a colour tint. Because the brand ships no photography, an empty frame renders a pastel block ground with a mono caption naming what belongs there and at what ratio — that placeholder is the system's honest default, not a decorative texture.

**Backgrounds.** Flat colour only. No gradients, no photographic hero, no texture, no repeating pattern, no grain. Imagery, when it exists, is a flat product UI mock or a pastel illustration placed inside a block; product mocks never crop and never carry their own drop shadow. Media placeholders in this system are labelled mint/cream rectangles — the brand ships no photography, so mocks stand in.

**Corner radii.** 2px anchor decoration · 6px chips and sticky-note thumbnails · 8px inputs, tiles, image frames, banners · 24px cards and colour blocks · 32px oversized callouts · 50px pill for every text CTA · full round for icon buttons and check glyphs. Nothing is square.

**Cards.** Stroked, not shadowed: white fill, 1px hairline, 24px radius, 24px padding. A highlighted card darkens its border to full ink — it never takes a colour fill. Template tiles are the exception that lifts a soft `0 4px 16px rgba(0,0,0,0.06)` shadow on hover only.

**Elevation.** Four levels: flat (colour blocks, hero, footer), hairline border (cards, inputs, table cells), soft lift (floating template tiles, menus), modal (stronger shadow over a 60% black scrim). Colour substitutes for elevation — a section break is a change of ground, not a shadow. Never shadow a colour block.

**Borders.** Only two weights of rule: `--hairline` for structural edges (card, input, sidebar, nav bottom in-app) and `--hairline-soft` for row separators and footer column rules. No coloured borders, no left-accent bars.

**Transparency & blur.** Almost never. Two sanctioned uses: white at 16% for circular icon buttons on dark blocks, and black at 60% as a modal scrim. No frosted glass, no backdrop blur, no tinted overlays on imagery.

**Animation.** Restrained and short — 120ms for state feedback, 200ms for surface changes, `cubic-bezier(0.2,0,0.2,1)`. Fades and small translations only; nothing bounces, nothing springs. The one continuous motion is the 28s linear marquee. `prefers-reduced-motion` zeroes all of it.

**Hover.** Opacity 0.80 on pills and links (never a darker fill, never a colour change). Nav items and sidebar rows take no hover fill. Template tiles gain the level-2 shadow.

**Press.** Scale 0.97, same fill. The source is explicit: press is micro-scale, not a darkened surface.

**Focus.** A 2px `--focus-ring` outline offset 2px, and on inputs an outline ring — the field's fill and border never change on focus.

**Selected state.** Selected equals the primary surface: a selected tab, or the active sidebar row, is the black pill. Never a coloured selected state.

**Fixed elements.** Marketing: sticky 56px nav, everything else scrolls. App: fixed 248px sidebar and 56px top bar, single scrolling content pane. Nothing else pins.

**Responsive.** Blocks keep 48px of canvas around them above 768px so the 24px corners read; below that the corners drop and the block bleeds to the viewport edge as a poster. Display-xl falls from 86px to ~48px at 560px; pills go full width; the pricing grid steps 4-up → 2-up → 1-up; the comparison matrix becomes per-tier accordions below 960px.

## Iconography

**One set, substituted.** The source doc names no icon system and ships no icon assets, sprite, or icon font — there was nothing to copy in. Icons here come from **[Lucide](https://lucide.dev) 0.469.0, loaded from CDN** and wrapped by the `Icon` component. **This is a substitution — please send the real Bridge88 icon set (SVG folder, sprite, or font) and I will swap it in and delete the CDN dependency.** Lucide was chosen because its 1.75–2px open stroke, round caps and geometric construction sit closest to the monochrome editorial frame; a filled set would fight the type.

**Rules in use.**
- Stroke only, weight 1.75, `currentColor` — icons inherit surrounding text colour, so they invert automatically in dark mode.
- 16px inside dense rows and buttons, 18px in nav and toolbars, 20px default, 24–28px in tile previews. Never larger than 28px; illustrations, not icons, carry scale.
- Icons never appear alone as the sole label of a destination except in the circular `IconButton`, which always carries an accessible `label`.
- Glyph vocabulary in use: `calendar-days`, `pen-line`, `repeat`, `bar-chart-3`, `link`, `settings`, `search`, `bell`, `plus`, `filter`, `image`, `hash`, `send`, `heart`, `message-circle`, `download`, `arrow-left`, `arrow-right`, `more-horizontal`, `sparkles`, `layout-grid`, `circle-dot`.
- **No emoji, ever**, in UI or copy.
- Two Unicode characters are used deliberately as glyphs, per the source: `✓` for the green check (`CheckGlyph`) and `—` for an excluded feature in comparison rows. The middot `·` is a metadata separator, not an icon.
- No logo, brand mark, or customer logo assets exist in the system: the marquee strip carries customer **names** in type, and `assets/` holds no imagery.

## Known gaps (inherited and new)

- Pastel hexes are screenshot-derived approximations in the source; treat as faithful, not exact.
- **Input error / validation styling is undocumented.** I did not invent one.
- Real fonts unavailable: the source's proprietary sans and mono are substituted with **Geist** and **Geist Mono** (its own recommendation was Inter/Geist + JetBrains Mono/Geist Mono). Please send the licensed font files and I'll add real `@font-face` rules.
- No photography, illustration, or logo assets were supplied, so `assets/` is empty and mocks use labelled colour placeholders.
- Marquee and block reveal animations are undocumented in the source; nothing was invented beyond the linear marquee.
