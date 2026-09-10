# Bridge88 components — API reference

32 components. Each is a named export from `components/<group>/<Name>.js` (JSX inside `.js`, which Vite/Next/CRA all handle). Types are listed here rather than as `.d.ts` files — paste them into your own types if you want them.


## buttons

### Button
`import { Button } from './components/buttons/Button.js';`

One-line: the system's pill CTA — use for every action, in every surface; never square it off.

```jsx
<Button variant="primary">Start free</Button>
<Button variant="secondary" href="/contact">Talk to sales</Button>
```

- `variant`: `primary` (black) · `secondary` (white) · `tertiary` (text link hit-target) · `promo` (magenta, one per page).
- Pair primary + secondary whenever a section needs a main and a sales action — that black/white pair is the brand signature.
- Press state is a micro-scale (`--press-scale`), not a darker fill. Hover is opacity.
- `size="sm"` for in-app toolbars; default `md` holds a 44px tap height.

```ts
import * as React from 'react';

/**
 * The only CTA shape in the system: a pill. Black primary, white secondary,
 * text tertiary, magenta promo (one per page, max).
 * @startingPoint section="Core" subtitle="Pill CTAs — primary, secondary, tertiary, promo" viewport="700x220"
 */
export interface ButtonProps extends React.HTMLAttributes<HTMLElement> {
  /** primary = black fill, secondary = white fill, tertiary = text-only, promo = magenta (scarce) */
  variant?: 'primary' | 'secondary' | 'tertiary' | 'promo';
  size?: 'md' | 'sm';
  children?: React.ReactNode;
  disabled?: boolean;
  /** renders an <a> instead of a <button> */
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  style?: React.CSSProperties;
}
export function Button(props: ButtonProps): JSX.Element;
```

### IconButton
`import { IconButton } from './components/buttons/IconButton.js';`

One-line: circular icon-only button for controls that need no label.

```jsx
<IconButton label="Next" tone="light"><Icon name="arrow-right" /></IconButton>
```

- `tone="inverse"` on navy / black surfaces (translucent white fill).
- Always circular (`--radius-full`), always 40px (44px on touch).

```ts
import * as React from 'react';

/** 40px circular icon button — carousel controls, social links, in-app toolbar actions. */
export interface IconButtonProps extends React.HTMLAttributes<HTMLButtonElement> {
  /** light = soft off-white fill on canvas; inverse = translucent white on dark blocks */
  tone?: 'light' | 'inverse';
  /** px; 40 on desktop, 44 on touch */
  size?: number;
  children?: React.ReactNode;
  /** accessible name — required, the button has no text */
  label: string;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}
export function IconButton(props: IconButtonProps): JSX.Element;
```

## forms

### Checkbox
`import { Checkbox } from './components/forms/Checkbox.js';`

One-line: multi-select control for settings, channel pickers and consent rows.

```jsx
<Checkbox label="Re-post top performers" description="30-day window" defaultChecked />
```

- Checked = `--primary` fill with a white ✓; unchecked is canvas with a hairline border. Never a coloured fill.

```ts
import * as React from 'react';

/** Square-ish (6px) checkbox; checked state is the black primary surface. */
export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** mono uppercase helper line under the label */
  description?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}
export function Checkbox(props: CheckboxProps): JSX.Element;
```

### RadioGroup
`import { RadioGroup } from './components/forms/RadioGroup.js';`

One-line: exclusive choice with room for a helper line per option.

```jsx
<RadioGroup label="Publish behaviour" options={[
  { value: 'now', label: 'Publish immediately' },
  { value: 'queue', label: 'Add to queue', description: 'Next open slot' }
]} />
```

- Reach for `SegmentedTabs` instead when the options are short and switch a view.

```ts
import * as React from 'react';

/** Single-choice list for 2–5 options that need descriptions (use SegmentedTabs for view switches). */
export interface RadioOption { value: string; label: string; description?: string }
export interface RadioGroupProps {
  /** mono uppercase group label */
  label?: string;
  options: (RadioOption | string)[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  style?: React.CSSProperties;
}
export function RadioGroup(props: RadioGroupProps): JSX.Element;
```

### SegmentedTabs
`import { SegmentedTabs } from './components/forms/SegmentedTabs.js';`

One-line: pill tab toggle — use whenever a view switches between 2–5 named states.

```jsx
<SegmentedTabs items={['Starter','Team','Business','Enterprise']} value={plan} onChange={setPlan} />
```

- Selected tab is the black primary surface; unselected is transparent with ink text. Never colour the selected tab.
- Scrolls horizontally rather than wrapping below 560px.

```ts
import * as React from 'react';

/**
 * Pill toggle where the selected tab uses the primary CTA surface — plan switchers,
 * channel filters, billing period toggles.
 * @startingPoint section="Core" subtitle="Pill tab toggle — selected = primary surface" viewport="700x120"
 */
export interface SegmentedTabsProps extends React.HTMLAttributes<HTMLDivElement> {
  items: string[];
  value?: string;
  onChange?: (item: string) => void;
  style?: React.CSSProperties;
}
export function SegmentedTabs(props: SegmentedTabsProps): JSX.Element;
```

### Select
`import { Select } from './components/forms/Select.js';`

One-line: dropdown for 6+ options — timezones, workspaces, channel accounts.

```jsx
<Select label="Workspace" options={['Northwind', 'Northwind EU', 'Kettle & Co']} hint="Automations are scoped per workspace" />
```

- Matches `TextInput` metrics so mixed forms align. Fewer than six options with descriptions → `RadioGroup`.

```ts
import * as React from 'react';

/** Native select styled to match TextInput exactly (8px radius, hairline border, 48px tall). */
export interface SelectOption { value: string; label: string }
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  /** mono uppercase helper line */
  hint?: string;
  options: (SelectOption | string)[];
  style?: React.CSSProperties;
}
export function Select(props: SelectProps): JSX.Element;
```

### Switch
`import { Switch } from './components/forms/Switch.js';`

One-line: on/off setting that applies immediately — automation rules, notification prefs.

```jsx
<Switch label="Pause queue on holidays" description="Workspace-wide" defaultChecked />
```

- Use `Checkbox` when the change needs a Save; `Switch` when it takes effect on click.

```ts
import * as React from 'react';

/** Pill toggle for immediate on/off settings (no save step). */
export interface SwitchProps {
  label: string;
  description?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
  style?: React.CSSProperties;
}
export function Switch(props: SwitchProps): JSX.Element;
```

### TextInput
`import { TextInput } from './components/forms/TextInput.js';`

One-line: the system's single text field — contact forms, in-app settings, composer metadata.

```jsx
<TextInput label="Work email" placeholder="you@company.com" hint="We reply within one business day" />
```

- 8px radius (`--radius-md`), 12px/14px padding, 1px `--hairline` border, 48px minimum height.
- `multiline` swaps to a textarea; keep the same border and radius.
- Error styling is undocumented in the source — see readme Known Gaps before inventing one.

```ts
import * as React from 'react';

/** Hairline-bordered form field. Focus is a ring, never a fill change. */
export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** mono uppercase helper line under the field */
  hint?: string;
  multiline?: boolean;
  rows?: number;
  style?: React.CSSProperties;
}
export function TextInput(props: TextInputProps): JSX.Element;
```

## surfaces

### ColorBlockSection
`import { ColorBlockSection } from './components/surfaces/ColorBlockSection.js';`

One-line: the brand's storytelling surface — use it to open any narrative section on a page.

```jsx
<ColorBlockSection tone="lime" eyebrow="Scheduling" title="One queue for every channel">
  <p>Bridge88 posts on your calendar, not on your attention.</p>
  <Button variant="primary">Start free</Button>
</ColorBlockSection>
```

- Pick the tone FIRST — it is the most consequential decision in a new section.
- Never shadow a block; colour is the depth device. Never stack two blocks in one viewport.
- `tone="navy"` flips type to white and is the only dark surface above the footer.

```ts
import * as React from 'react';

/**
 * The signature surface: a full-content-width pastel story panel. One per viewport,
 * always separated by white canvas.
 * @startingPoint section="Sections" subtitle="Pastel story panel — the signature surface" viewport="1000x420"
 */
export interface ColorBlockSectionProps extends React.HTMLAttributes<HTMLElement> {
  tone?: 'lime' | 'lilac' | 'cream' | 'pink' | 'mint' | 'coral' | 'navy';
  /** mono uppercase section marker */
  eyebrow?: string;
  title?: string;
  children?: React.ReactNode;
  /** product mock / illustration placed in the right column */
  media?: React.ReactNode;
  /** drops the 24px corners and bleeds to the viewport edge (mobile ≤768px) */
  fullBleed?: boolean;
  style?: React.CSSProperties;
}
export function ColorBlockSection(props: ColorBlockSectionProps): JSX.Element;
```

### FeatureTile
`import { FeatureTile } from './components/surfaces/FeatureTile.js';`

One-line: the white-canvas feature block — use for 2–3-up capability rows between colour blocks.

```jsx
<FeatureTile eyebrow="Queue" title="Channel-aware scheduling">Every post is validated against the network's own rules before it goes out.</FeatureTile>
```

```ts
import * as React from 'react';

/** Larger off-white composition tile holding a product mock or illustration. */
export interface FeatureTileProps extends React.HTMLAttributes<HTMLDivElement> {
  eyebrow?: string;
  title?: string;
  children?: React.ReactNode;
  media?: React.ReactNode;
  style?: React.CSSProperties;
}
export function FeatureTile(props: FeatureTileProps): JSX.Element;
```

### PricingCard
`import { PricingCard } from './components/surfaces/PricingCard.js';`

One-line: a plan tier on the pricing page — stroked, never shadowed.

```jsx
<PricingCard tier="Team" price="$29" cadence="/ seat / month"
  features={['Unlimited channels','Approval flows']}
  cta={<Button variant="primary" fullWidth>Start free</Button>} />
```

- 24px radius, 24px padding, 1px `--hairline`. `highlighted` darkens the border to ink — no colour fill.

```ts
import * as React from 'react';

/** Stroked (not shadowed) white card for a plan tier. */
export interface PricingCardProps extends React.HTMLAttributes<HTMLDivElement> {
  tier: string;
  price?: string;
  /** mono uppercase cadence, e.g. "/ SEAT / MONTH" */
  cadence?: string;
  blurb?: string;
  features?: string[];
  cta?: React.ReactNode;
  /** swaps the hairline border for a full-ink border */
  highlighted?: boolean;
  style?: React.CSSProperties;
}
export function PricingCard(props: PricingCardProps): JSX.Element;
```

### PromoBanner
`import { PromoBanner } from './components/surfaces/PromoBanner.js';`

One-line: the only place the magenta CTA appears — announcements above a form or page section.

```jsx
<PromoBanner eyebrow="New" action={<Button variant="promo" size="sm">Save your spot</Button>}>
  Bridge88 Live: automation patterns that actually ship.
</PromoBanner>
```

- 8px radius (not 24px) — a banner is not a colour block.

```ts
import * as React from 'react';

/** Inline pastel banner for launches and release notes; carries one magenta promo CTA. */
export interface PromoBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'lilac' | 'lime' | 'cream';
  eyebrow?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}
export function PromoBanner(props: PromoBannerProps): JSX.Element;
```

### TemplateCard
`import { TemplateCard } from './components/surfaces/TemplateCard.js';`

One-line: gallery tile for automation templates and saved recipes.

```jsx
<TemplateCard title="Weekly product digest" meta="4 channels" tilt={-1.5} preview={<Icon name="layout-grid" size={28} />} />
```

- Soft off-white tile on white canvas; only lifts a shadow on hover.
- `tilt` between -2 and 2 degrees; keep the rotation at every breakpoint, it is a brand signal.

```ts
import * as React from 'react';

/** Off-white thumbnail tile for template / recipe galleries. */
export interface TemplateCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  /** mono uppercase caption line */
  meta?: string;
  preview?: React.ReactNode;
  /** small off-axis rotation (deg) for the sticky-note collage effect */
  tilt?: number;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export function TemplateCard(props: TemplateCardProps): JSX.Element;
```

## navigation

### Footer
`import { Footer } from './components/navigation/Footer.js';`

One-line: the site footer — mono uppercase column headings, small sans links, white canvas.

```jsx
<Footer columns={[{heading:'Product',links:['Queue','Analytics']}]} note="© 2026 Bridge88" />
```

- 96px vertical padding, 32px sides. Columns collapse to one below 559px.

```ts
import * as React from 'react';

/** Dense link grid on white canvas with the wordmark set in display weight. */
export interface FooterProps extends React.HTMLAttributes<HTMLElement> {
  brand?: string;
  columns?: { heading: string; links: string[] }[];
  /** mono uppercase legal line */
  note?: string;
  style?: React.CSSProperties;
}
export function Footer(props: FooterProps): JSX.Element;
```

### MarqueeStrip
`import { MarqueeStrip } from './components/navigation/MarqueeStrip.js';`

One-line: black 36px customer-logo ribbon; sits directly beneath the nav, once per page.

```jsx
<MarqueeStrip items={['Northwind','Kettle & Co','Palette','Runway Foods']} />
```

- Text only — Bridge88 ships no customer logo assets. Respects reduced-motion via `--marquee-duration`.

```ts
import * as React from 'react';

/** Thin black ribbon under the nav that scrolls customer names in white. */
export interface MarqueeStripProps extends React.HTMLAttributes<HTMLDivElement> {
  items: string[];
  /** CSS duration, defaults to --marquee-duration (28s) */
  speed?: string;
  style?: React.CSSProperties;
}
export function MarqueeStrip(props: MarqueeStripProps): JSX.Element;
```

### SidebarNav
`import { SidebarNav } from './components/navigation/SidebarNav.js';`

One-line: the app's primary navigation — pair it with a 56px top bar.

```jsx
<SidebarNav items={[{label:'Queue',icon:<Icon name="calendar-days" size={18}/>},{label:'Analytics',icon:<Icon name="bar-chart-3" size={18}/>}]}
  value={route} onChange={setRoute} footer={<SegmentedTabs items={['Light','Dark']} value={theme} onChange={setTheme} />} />
```

- No hover fill on rows; only the active row takes a surface.

```ts
import * as React from 'react';

/** Fixed 248px app sidebar; the active row is the black pill (selected = primary surface). */
export interface SidebarItem { label: string; icon?: React.ReactNode }
export interface SidebarNavProps extends React.HTMLAttributes<HTMLElement> {
  /** wordmark set in type — no logo mark exists in this system */
  brand?: string;
  items: (SidebarItem | string)[];
  value?: string;
  onChange?: (label: string) => void;
  /** bottom-pinned slot, e.g. the light/dark SegmentedTabs */
  footer?: React.ReactNode;
  width?: number;
  style?: React.CSSProperties;
}
export function SidebarNav(props: SidebarNavProps): JSX.Element;
```

### TopNav
`import { TopNav } from './components/navigation/TopNav.js';`

One-line: the marketing site header; 56px tall, white, hairline-soft bottom rule.

```jsx
<TopNav links={[{label:'Product'},{label:'Pricing'},{label:'Docs'}]}
  actions={<><Button variant="secondary" size="sm">Talk to sales</Button><Button variant="primary" size="sm">Start free</Button></>} />
```

- The two pills stay on the bar above 560px; primary links collapse to a hamburger overlay below 960px.

```ts
import * as React from 'react';

/**
 * Sticky white marketing bar: wordmark, primary links, sign-in, and the
 * secondary + primary pill pair on the right.
 * @startingPoint section="Navigation" subtitle="Sticky marketing nav with CTA pair" viewport="1280x120"
 */
export interface TopNavProps extends React.HTMLAttributes<HTMLElement> {
  /** wordmark text — Bridge88 has no supplied logo mark, so the name is set in type */
  brand?: string;
  links?: { label: string; href?: string; onClick?: () => void }[];
  /** the right-anchored pill pair, e.g. <><Button variant="secondary"/><Button variant="primary"/></> */
  actions?: React.ReactNode;
  signInLabel?: string;
  onSignIn?: () => void;
  sticky?: boolean;
  style?: React.CSSProperties;
}
export function TopNav(props: TopNavProps): JSX.Element;
```

## data

### CheckGlyph
`import { CheckGlyph } from './components/data/CheckGlyph.js';`

One-line: the only place semantic green appears — an included-feature check.

```jsx
<CheckGlyph />
```

- Glyph fill only; never fill a surface with `--success`.

```ts
import * as React from 'react';

/** 16px green check used as a glyph (never a surface) in comparison matrices. */
export interface CheckGlyphProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: number;
  style?: React.CSSProperties;
}
export function CheckGlyph(props: CheckGlyphProps): JSX.Element;
```

### FeatureRow
`import { FeatureRow } from './components/data/FeatureRow.js';`

One-line: comparison-table row for pricing and plan matrices.

```jsx
<FeatureRow label="Approval workflows" values={[false, true, true, '(Custom)']} />
```

```ts
import * as React from 'react';

/** One row of the plan comparison matrix; separators are hairline-soft. */
export interface FeatureRowProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  /** true → green check, false → em dash, string → literal value */
  values?: (boolean | string)[];
  style?: React.CSSProperties;
}
export function FeatureRow(props: FeatureRowProps): JSX.Element;
```

### StatCard
`import { StatCard } from './components/data/StatCard.js';`

One-line: the analytics KPI tile; 2–4 across the top of a reporting view.

```jsx
<StatCard label="Reach" value="184k" delta="+22%" />
```

- The number is display type at weight 340 — never bold it. Deltas are the only place green appears outside `CheckGlyph`.

```ts
import * as React from 'react';

/** Single metric in a stroked card: mono label, display-scale number, mono delta. */
export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string;
  /** e.g. "+22%" — rendered in mono */
  delta?: string;
  /** up/down both read as improvement in green; flat stays ink */
  trend?: 'up' | 'down' | 'flat';
  footnote?: string;
  style?: React.CSSProperties;
}
export function StatCard(props: StatCardProps): JSX.Element;
```

## feedback

### Dialog
`import { Dialog } from './components/feedback/Dialog.js';`

One-line: confirmations and short flows that must block the queue — deleting a rule, disconnecting a channel.

```jsx
<Dialog open={open} eyebrow="Confirm" title="Disconnect Instagram?" onClose={close}
  actions={<><Button variant="secondary" size="sm" onClick={close}>Keep</Button><Button variant="primary" size="sm">Disconnect</Button></>}>
  Scheduled posts on this channel will pause instead of failing.
</Dialog>
```

- The scrim is the only place `--scrim-modal` is used. Never colour a dialog surface.

```ts
import * as React from 'react';

/** Level-3 modal: 24px-radius white card over a 60% black scrim. Escape and scrim click close it. */
export interface DialogProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  title?: string;
  /** mono uppercase kicker above the title */
  eyebrow?: string;
  children?: React.ReactNode;
  /** right-aligned button row, primary last */
  actions?: React.ReactNode;
  onClose?: () => void;
  /** max width in px, default 520 */
  width?: number;
  style?: React.CSSProperties;
}
export function Dialog(props: DialogProps): JSX.Element | null;
```

### Toast
`import { Toast } from './components/feedback/Toast.js';`

One-line: transient confirmation for queued, saved and published actions.

```jsx
<Toast tone="success" onDismiss={hide}>Post queued for Thu 09:00</Toast>
```

- Inverse pill, never a coloured fill — green appears only as the check glyph. Copy is one clause, no exclamation mark.

```ts
import * as React from 'react';

/** Black pill confirmation that a background action completed. Bottom-centre, auto-dismiss. */
export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  /** success prepends the green check glyph */
  tone?: 'neutral' | 'success';
  /** inline undo / view action, usually a tertiary Button */
  action?: React.ReactNode;
  onDismiss?: () => void;
  style?: React.CSSProperties;
}
export function Toast(props: ToastProps): JSX.Element;
```

### Tooltip
`import { Tooltip } from './components/feedback/Tooltip.js';`

One-line: names an icon-only control; never carries copy the user must read to proceed.

```jsx
<Tooltip content="Next week"><IconButton label="Next week"><Icon name="arrow-right" /></IconButton></Tooltip>
```

- One short phrase, mono uppercase, 6px radius. Explanations belong in a `hint` or `Dialog`.

```ts
import * as React from 'react';

/** Mono uppercase inverse label for icon-only controls and truncated values. */
export interface TooltipProps extends React.HTMLAttributes<HTMLSpanElement> {
  content: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export function Tooltip(props: TooltipProps): JSX.Element;
```

## core

### Avatar
`import { Avatar } from './components/core/Avatar.js';`

One-line: identifies an account or reviewer inside the app; falls back to mono initials.

```jsx
<Avatar name="Northwind" tone="mint" />
```

- Do not use on marketing pages — the source design language avoids avatars there.

```ts
import * as React from 'react';

/** Circular account / reviewer identity. App surfaces only — marketing avoids personification. */
export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** used for initials and the title attribute */
  name: string;
  src?: string;
  /** px, default 32 */
  size?: number;
  tone?: 'neutral' | 'lime' | 'lilac' | 'mint' | 'coral';
  style?: React.CSSProperties;
}
export function Avatar(props: AvatarProps): JSX.Element;
```

### Badge
`import { Badge } from './components/core/Badge.js';`

One-line: labels a state or category in one or two words; never interactive.

```jsx
<Badge tone="lime">Scheduled</Badge>
<Badge tone="cream">In review</Badge>
<Badge tone="outline">Draft</Badge>
```

- Always mono uppercase at caption size. State→tone mapping used across the app: scheduled = lime, in review = cream, automated = lilac, draft = outline.

```ts
import * as React from 'react';

/** Mono uppercase status chip — post state, plan label, channel tag. */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children?: React.ReactNode;
  /** pastel tones map to the block palette; ink is the primary surface */
  tone?: 'neutral' | 'ink' | 'lime' | 'lilac' | 'cream' | 'mint' | 'coral' | 'outline';
  /** chip = 6px corners (default), pill = fully rounded */
  shape?: 'chip' | 'pill';
  style?: React.CSSProperties;
}
export function Badge(props: BadgeProps): JSX.Element;
```

### EmptyState
`import { EmptyState } from './components/core/EmptyState.js';`

One-line: what a list shows before it has content, and how this system marks a view it has no source for.

```jsx
<EmptyState eyebrow="No posts yet" title="Your queue is clear"
  action={<Button variant="primary" size="sm">New post</Button>}>
  Drafts you add land here, sorted by publish time.
</EmptyState>
```

```ts
import * as React from 'react';

/** Dashed or soft panel for an empty list, an unbuilt view, or a first-run prompt. */
export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** mono uppercase kicker, e.g. "NO POSTS YET" */
  eyebrow?: string;
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'dashed' | 'soft';
  style?: React.CSSProperties;
}
export function EmptyState(props: EmptyStateProps): JSX.Element;
```

## media

### AssetTile
`import { AssetTile } from './components/media/AssetTile.js';`

One-line: one asset in the media library grid.

```jsx
<AssetTile title="spring-set-01.jpg" meta="1080×1350 · 2.1 MB" tone="mint" usedIn="3 posts" selected />
```

- Selection is a 1px ink outline plus a soft fill — never a colour tint or a checkbox overlay.

```ts
import * as React from 'react';

/** Selectable library tile: media frame, type badge, filename and usage line. */
export interface AssetTileProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  /** mono uppercase line, e.g. "1080×1350 · 2.1 MB" */
  meta?: string;
  type?: 'image' | 'video';
  ratio?: string;
  src?: string;
  tone?: 'soft' | 'mint' | 'cream' | 'lime' | 'lilac' | 'coral' | 'pink';
  /** duration chip for video */
  duration?: string;
  selected?: boolean;
  /** e.g. "3 posts" */
  usedIn?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export function AssetTile(props: AssetTileProps): JSX.Element;
```

### MediaCarousel
`import { MediaCarousel } from './components/media/MediaCarousel.js';`

One-line: previews a carousel post (multi-image or mixed image/video) exactly as the network will show it.

```jsx
<MediaCarousel ratio="1:1" items={[
  { tone: 'mint', alt: 'Spring set' },
  { tone: 'cream', type: 'video', duration: '0:14' },
  { tone: 'coral', alt: 'Finish detail' }
]} />
```

- Dots below, counter chip top-right, circular controls overlaid — all documented shapes. Keep one ratio per carousel; networks won't mix.

```ts
import * as React from 'react';
import { MediaFrameProps } from './MediaFrame';

/** Multi-asset post preview: MediaFrame plus circular prev/next controls, counter and dots. */
export interface MediaCarouselProps extends React.HTMLAttributes<HTMLDivElement> {
  /** each item is MediaFrame props (src, type, ratio, alt, duration, tone…) */
  items: MediaFrameProps[];
  /** default ratio for items that don't set one */
  ratio?: string;
  showCounter?: boolean;
  style?: React.CSSProperties;
}
export function MediaCarousel(props: MediaCarouselProps): JSX.Element;
```

### MediaFrame
`import { MediaFrame } from './components/media/MediaFrame.js';`

One-line: wraps every image and video in the product — previews, libraries, post rows.

```jsx
<MediaFrame ratio="4:5" type="image" tone="mint" alt="Spring set, three finishes" />
<MediaFrame ratio="9:16" type="video" duration="0:32" label="Studio walkthrough" />
```

- Ratios are network-native: 1:1 and 4:5 feed posts, 9:16 stories and shorts, 16:9 YouTube, 1.91:1 link cards.
- `objectFit: cover` on real assets, but the frame itself never crops the composition — per the source, mocks shrink rather than reflow.
- Placeholders are pastel block grounds with a mono caption. Never invent photography.

```ts
import * as React from 'react';

/** The system's only media container: 8px corners, never crops the subject, aspect-locked per network. */
export interface MediaFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  /** omit to render a labelled colour placeholder — the brand ships no photography */
  src?: string;
  type?: 'image' | 'video';
  /** network-native aspect ratios, or any CSS aspect-ratio string */
  ratio?: '1:1' | '4:5' | '9:16' | '16:9' | '1.91:1' | string;
  alt?: string;
  /** video still */
  poster?: string;
  /** mono chip, bottom-right, e.g. "0:32" */
  duration?: string;
  /** placeholder caption when there is no src */
  label?: string;
  /** placeholder ground — pastel block or soft off-white */
  tone?: 'soft' | 'mint' | 'cream' | 'lime' | 'lilac' | 'coral' | 'pink';
  /** renders an "ALT MISSING" chip when alt is empty — use in the composer */
  showAltWarning?: boolean;
  /** absolutely-positioned children, e.g. a play button */
  overlay?: React.ReactNode;
  style?: React.CSSProperties;
}
export function MediaFrame(props: MediaFrameProps): JSX.Element;
```

### MediaUploader
`import { MediaUploader } from './components/media/MediaUploader.js';`

One-line: how media enters Bridge88 — composer, asset library, brand kit.

```jsx
<MediaUploader hint="JPG · PNG · MP4 · up to 4 GB" onFiles={setFiles} />
```

- Dashed 24px-radius panel; the drag-over state darkens the border to ink and fills with `--surface-soft`. No coloured "success" flash.

```ts
import * as React from 'react';

/** Dashed drop zone for images and video; click or drag, no progress theatre. */
export interface MediaUploaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** mono uppercase line describing what's accepted */
  accept?: string;
  /** overrides the accept line, e.g. "MP4 · UP TO 4 GB · 9:16" */
  hint?: string;
  onFiles?: (files: File[]) => void;
  /** tighter padding and no Browse button — for sidebars and composer rails */
  compact?: boolean;
  style?: React.CSSProperties;
}
export function MediaUploader(props: MediaUploaderProps): JSX.Element;
```

### VideoPlayer
`import { VideoPlayer } from './components/media/VideoPlayer.js';`

One-line: playback for a single video — composer preview, asset detail, marketing product film.

```jsx
<VideoPlayer ratio="9:16" duration="0:32" caption="Studio walkthrough · TikTok cut" />
```

- Controls are the documented circular icon button; the only chrome is a 4px scrubber and the duration. No skins, no branded player colour.
- Never autoplay with sound.

```ts
import * as React from 'react';

/** Video surface with a centred circular play control, thin scrubber and mono duration. */
export interface VideoPlayerProps extends React.HTMLAttributes<HTMLElement> {
  src?: string;
  poster?: string;
  ratio?: '16:9' | '9:16' | '1:1' | '4:5' | string;
  /** mono duration shown next to the scrubber */
  duration?: string;
  /** mono uppercase caption under the frame */
  caption?: string;
  /** placeholder ground when there is no src */
  tone?: 'cream' | 'mint' | 'lime' | 'lilac' | 'coral' | 'pink';
  style?: React.CSSProperties;
}
export function VideoPlayer(props: VideoPlayerProps): JSX.Element;
```

## icon

### Icon
`import { Icon } from './components/icon/Icon.js';`

One-line: renders a Lucide glyph; the only icon system in Bridge88 (substituted — the source design doc ships no icon assets).

```jsx
<Icon name="calendar-days" size={20} />
```

- Inherits `currentColor`, so it matches whatever text colour surrounds it.
- Stroke weight stays 1.75 — do not mix filled and stroked glyph sets.
- Loads the Lucide UMD bundle from CDN on first use.

```ts
import * as React from 'react';

/** Lucide glyph wrapper — the system's only icon source (1.75px stroke, 20px default). */
export interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Lucide icon name, kebab-case, e.g. "calendar-days" */
  name: string;
  size?: number;
  strokeWidth?: number;
  style?: React.CSSProperties;
}
export function Icon(props: IconProps): JSX.Element;
```
