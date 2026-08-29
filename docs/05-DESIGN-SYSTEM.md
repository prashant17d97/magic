# MAGIC — UI/UX Architecture & Design System

**Enterprise console · Light + Dark · Version 1.0**

---

## 1. Design Brief

| Question | Answer |
|---|---|
| Product | Payment reconciliation console for Stripe Connect platforms |
| Primary user | Finance operator working an exception queue for hours a day |
| Secondary users | Finance lead (aggregate view), engineer (ingestion health), auditor (read-only) |
| Emotion to evoke | **Composed authority.** The user should feel the system already checked everything and is simply reporting. Not excitement. Not delight. Certainty |
| Platform | Web, desktop-first (1440 primary), responsive down to tablet. Phone is view-only |
| Brand input | Supplied palette (Material Blue 50/200/500/900), Sora typography |
| Modes | Both, delivered together. Dark is not an afterthought — operators work long sessions |
| Key actions | Scan queue → open exception → verify evidence → resolve or escalate |

### Emotional intent by moment

| Moment | Should feel | Design consequence |
|---|---|---|
| First load | "Everything is accounted for" | Health tiles lead with completeness, not revenue |
| Scanning the queue | "I can see what matters" | Severity carries the hierarchy; density is high but grouped |
| Opening an exception | "I have everything I need" | Evidence, expected-vs-actual, and rule trace in one view — no tab hunting |
| Resolving | "That is recorded properly" | Quiet confirmation. **No celebration** |
| Empty queue | "Verified, not just empty" | All-clear state with a timestamp of last verification |
| Something broke | "My data is safe" | Error states say what is unaffected, and carry a trace ID |

---

## 2. Deliberate Deviations from House Defaults

Documented rather than silent, because each is a reasoned exception.

| House default | MAGIC | Why |
|---|---|---|
| 8pt spacing grid | **4pt base**, 8pt section rhythm | Financial data grids need 4px increments. An 8pt-only grid forces either wasteful row height or cramped padding |
| "Moments of delight" — confetti, celebration | **None in working surfaces** | Confetti when someone resolves a $12,000 discrepancy is tonally wrong. Delight here is a table that never janks and a keyboard flow that never breaks |
| Sora for the whole type stack | **Sora for display/headings only** | Sora is a geometric display face with wide letterforms. It is excellent at 20px+ and poor in a 13px data grid. Body and tables use Inter |
| Card radius 12–16px | **6px** | Corporate density. Large radii waste horizontal space in a table-heavy layout and read as consumer |
| Optimistic UI on mutations | **Never on money** | Showing a resolve as done before the server confirms undermines a product whose premise is accuracy |
| Brand blue as text colour | **Brand-700 minimum in light mode** | `#2196F3` on white measures ≈3.1:1 — it fails AA for body text. Fills and large text only |

---

## 3. Colour System

### 3.1 Brand ramp

The four supplied values are Material Blue 50 / 200 / 500 / 900. The ramp is completed from the same family so the supplied colours remain exact anchors.

| Token | Hex | Role |
|---|---|---|
| `brand-50`  | `#E3F2FD` | **supplied** — selected row tint, subtle info background |
| `brand-100` | `#BBDEFB` | hover on tinted surfaces |
| `brand-200` | `#90CAF9` | **supplied** — borders on brand surfaces, dark-mode secondary |
| `brand-300` | `#64B5F6` | **dark-mode text/link brand** (8.7:1 on dark base) |
| `brand-400` | `#42A5F5` | dark-mode hover |
| `brand-500` | `#2196F3` | **supplied** — primary fill, focus ring, accent. **Not body text in light mode** |
| `brand-600` | `#1E88E5` | primary fill hover |
| `brand-700` | `#1976D2` | minimum light-mode text (4.6:1) |
| `brand-800` | `#1565C0` | light-mode links (5.8:1) |
| `brand-900` | `#0D47A1` | **supplied** — wordmark, headings, emphasis (8.5:1) |

Measured contrast on white: `brand-500` 3.13:1 (UI components and large text only), `brand-700` 4.60:1, `brand-800` 5.75:1, `brand-900` 8.54:1.

### 3.2 Status ramp

The supplied palette has no semantic colours, and this product is entirely about state. These are deliberately desaturated so blue remains the only saturated accent — status colours read as information, not decoration.

| Meaning | Light | On-white contrast | Dark | Surface (light / dark) |
|---|---|---:|---|---|
| Success / reconciled | `#067A55` | 5.35:1 | `#3DD9A4` | `#E6F5F0` / `#06251C` |
| Warning / review | `#A15C07` | 5.27:1 | `#F5B544` | `#FDF4E3` / `#2A1D06` |
| Danger / critical | `#C0271F` | 5.92:1 | `#FF7A6E` | `#FCEDEB` / `#2C0F0C` |
| Info / in progress | `brand-800` | 5.75:1 | `brand-300` | `brand-50` / `#0B1A2E` |
| Neutral / ignored | `neutral-500` | 4.8:1 | `neutral-400` | `neutral-50` / `neutral-800` |

**Severity never travels on colour alone.** Every severity indicator is `icon + label + colour`. This is an accessibility requirement and a comprehension one — operators scan labels faster than they decode hues.

### 3.3 Neutral ramp

Slightly blue-tinted so neutrals sit in the same family as the brand rather than beside it.

```
neutral-0   #FFFFFF     neutral-500  #64748B
neutral-25  #FAFBFD     neutral-600  #4A5568
neutral-50  #F4F6FA     neutral-700  #344055
neutral-100 #E9EDF4     neutral-800  #1E2739
neutral-200 #D7DEE9     neutral-900  #0F172A
neutral-300 #B6C0D0     neutral-950  #080B12
neutral-400 #8592A8
```

### 3.4 Semantic tokens

```css
:root {
  /* ── Surfaces ─────────────────────────────── */
  --bg-base:        #F4F6FA;   /* page — tinted, so white cards read as elevated */
  --bg-surface:     #FFFFFF;   /* cards, tables */
  --bg-raised:      #FFFFFF;   /* popovers, dropdowns */
  --bg-overlay:     #FFFFFF;   /* modals, drawers */
  --bg-sunken:      #E9EDF4;   /* inputs, code blocks */
  --bg-selected:    #E3F2FD;   /* brand-50 */
  --bg-hover:       #F4F6FA;
  --scrim:          rgba(15, 23, 42, 0.45);

  /* ── Text ─────────────────────────────────── */
  --text-primary:   #0F172A;
  --text-secondary: #4A5568;
  --text-tertiary:  #8592A8;
  --text-disabled:  #B6C0D0;
  --text-inverse:   #FFFFFF;
  --text-brand:     #1565C0;   /* brand-800 — NOT brand-500 */
  --text-link:      #1565C0;

  /* ── Borders ──────────────────────────────── */
  --border-subtle:  #E9EDF4;
  --border-default: #D7DEE9;
  --border-strong:  #8592A8;
  --border-brand:   #2196F3;
  --border-focus:   #2196F3;

  /* ── Interactive ──────────────────────────── */
  --brand-fill:        #2196F3;
  --brand-fill-hover:  #1E88E5;
  --brand-fill-active: #1976D2;
  --brand-on-fill:     #FFFFFF;

  /* ── Status ───────────────────────────────── */
  --success-fg: #067A55;  --success-bg: #E6F5F0;  --success-border: #A8DCC8;
  --warning-fg: #A15C07;  --warning-bg: #FDF4E3;  --warning-border: #EBCE94;
  --danger-fg:  #C0271F;  --danger-bg:  #FCEDEB;  --danger-border:  #F0B3AD;
  --info-fg:    #1565C0;  --info-bg:    #E3F2FD;  --info-border:    #90CAF9;
  --muted-fg:   #64748B;  --muted-bg:   #F4F6FA;  --muted-border:   #D7DEE9;

  /* ── Elevation (light mode: shadow) ───────── */
  --shadow-xs: 0 1px 2px rgba(15,23,42,.06);
  --shadow-sm: 0 1px 3px rgba(15,23,42,.08), 0 1px 2px rgba(15,23,42,.04);
  --shadow-md: 0 4px 8px rgba(15,23,42,.08), 0 2px 4px rgba(15,23,42,.04);
  --shadow-lg: 0 12px 24px rgba(15,23,42,.10), 0 4px 8px rgba(15,23,42,.04);
}

[data-theme="dark"] {
  /* Never pure black — halation on OLED and eye strain over long sessions */
  --bg-base:        #080B12;
  --bg-surface:     #10151F;
  --bg-raised:      #171D2A;
  --bg-overlay:     #1E2534;
  --bg-sunken:      #05070C;
  --bg-selected:    #0F2740;
  --bg-hover:       #171D2A;
  --scrim:          rgba(0, 0, 0, 0.65);

  /* Never pure white — #E8EDF5 prevents halation on dark */
  --text-primary:   #E8EDF5;
  --text-secondary: #97A3B6;
  --text-tertiary:  #5D6979;
  --text-disabled:  #3B4453;
  --text-inverse:   #080B12;
  --text-brand:     #64B5F6;   /* brand-300 — 8.7:1 on base */
  --text-link:      #64B5F6;

  --border-subtle:  #171D2A;
  --border-default: #262E3F;
  --border-strong:  #414B60;
  --border-brand:   #2196F3;
  --border-focus:   #64B5F6;

  --brand-fill:        #2196F3;
  --brand-fill-hover:  #42A5F5;
  --brand-fill-active: #1E88E5;
  --brand-on-fill:     #06121F;

  /* Status desaturated ~12% and lightened for dark backgrounds */
  --success-fg: #3DD9A4;  --success-bg: #06251C;  --success-border: #12503C;
  --warning-fg: #F5B544;  --warning-bg: #2A1D06;  --warning-border: #5C4310;
  --danger-fg:  #FF7A6E;  --danger-bg:  #2C0F0C;  --danger-border:  #63241E;
  --info-fg:    #64B5F6;  --info-bg:    #0B1A2E;  --info-border:    #1B3D63;
  --muted-fg:   #8592A8;  --muted-bg:   #10151F;  --muted-border:   #262E3F;

  /* Dark elevation: luminance step carries depth; shadow only anchors floating layers */
  --shadow-xs: 0 1px 2px rgba(0,0,0,.4);
  --shadow-sm: 0 1px 3px rgba(0,0,0,.5);
  --shadow-md: 0 4px 12px rgba(0,0,0,.55);
  --shadow-lg: 0 16px 32px rgba(0,0,0,.6);
}
```

**Note the light-mode inversion:** `--bg-base` is `neutral-50`, not white, and cards are white. In a dense table product this is the more useful arrangement — the table reads as an elevated working surface rather than dissolving into the page.

### 3.5 Theme switching

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark token block applies */ }
}
```

System preference is the default. A manual toggle overrides it and persists to the user's server-side preference so it follows them across devices. No flash of wrong theme: the theme class is set in a blocking inline script before paint.

---

## 4. Typography

### 4.1 Font stack and its division of labour

| Face | Role | Why |
|---|---|---|
| **Sora** | Display, page headings, wordmark, KPI figures | Geometric, confident, distinct. Excellent at 20px+ and in all-caps lockups |
| **Inter** | Body, tables, labels, forms, all UI chrome | Designed for screen UI at small sizes; ships genuine tabular figures |
| **JetBrains Mono** | Stripe object IDs, event IDs, checksums, JSON evidence | Disambiguates `0/O` and `1/l/I` — non-negotiable when operators copy `ch_3PxK2mLkdIwHu7ix1a2b3c4d` |

Sora carries the brand. Inter carries the work. Fighting Sora into a 13px grid would cost legibility for a font choice nobody sees at that size anyway.

```css
--font-display: 'Sora', system-ui, sans-serif;
--font-body:    'Inter', system-ui, sans-serif;
--font-mono:    'JetBrains Mono', ui-monospace, monospace;
```

### 4.2 Tabular numerals — mandatory

```css
.numeric, td.numeric, .kpi-value {
  font-variant-numeric: tabular-nums lining-nums;
  font-feature-settings: 'tnum' 1, 'lnum' 1;
  text-align: right;
  font-variant-ligatures: none;
}
```

Every numeric column is right-aligned with tabular figures. Misaligned decimal points in a column of amounts is the single detail finance users notice first and forgive last.

### 4.3 Scale

| Token | Family | Size / line | Weight | Use |
|---|---|---|---|---|
| `display` | Sora | 32 / 40 | 700 | Wordmark, sign-in |
| `h1` | Sora | 24 / 32 | 600 | Page title |
| `h2` | Sora | 20 / 28 | 600 | Section heading |
| `h3` | Sora | 16 / 24 | 600 | Card heading, panel title |
| `kpi` | Sora | 28 / 34 | 600, `tnum` | Health tile figure |
| `body` | Inter | 14 / 20 | 400 | Default UI text |
| `body-sm` | Inter | 13 / 18 | 400 | Secondary text |
| `table` | Inter | 13 / 18 | 400, `tnum` | Grid cells |
| `table-head` | Inter | 12 / 16 | 600, +0.02em | Column headers |
| `caption` | Inter | 12 / 16 | 400 | Timestamps, helper text |
| `label` | Inter | 11 / 14 | 600, +0.04em, uppercase | Field labels, badges |
| `mono` | JetBrains Mono | 12 / 16 | 400 | IDs, checksums |
| `mono-sm` | JetBrains Mono | 11 / 15 | 400 | Inline IDs in table cells |

Maximum three hierarchy levels per screen. If a fourth is needed, the screen is doing too much.

### 4.4 Wordmark

```
M A G I C     Sora 700, +0.14em tracking, brand-900 (light) / brand-300 (dark)
```

All caps with generous tracking is exactly where Sora's geometry is strongest. No icon mark in v1 — a wordmark ages better than a hurried symbol, and a literal sparkle or wand would undercut the seriousness the product depends on.

---

## 5. Spacing, Radius, Elevation

### Spacing — 4pt base

```
space-1   4px    within a cell, icon↔label
space-2   8px    between related controls
space-3   12px   cell padding (default density)
space-4   16px   between groups
space-5   20px
space-6   24px   between sections
space-8   32px   card padding
space-12  48px   between major page regions
space-16  64px
```

### Density modes

User-toggleable and persisted. Different operators have genuinely different tolerances, and forcing one is a needless fight.

| Mode | Row height | Cell padding Y | Font |
|---|---|---|---|
| Compact | 32px | 4px | `table` 13px |
| Default | 40px | 8px | `table` 13px |
| Comfortable | 48px | 12px | `body` 14px |

### Radius

```
radius-xs   2px    badges, tags
radius-sm   4px    inputs, buttons, table cells
radius-md   6px    cards, panels, dropdowns   ← the default
radius-lg   8px    modals, drawers
radius-full 9999px avatars, status dots
```

### Elevation ladder

| Level | Light | Dark |
|---|---|---|
| 0 — page | `--bg-base`, no shadow | `--bg-base` |
| 1 — card | `--bg-surface` + `--shadow-xs` + `--border-subtle` | `--bg-surface` (luminance step) |
| 2 — dropdown | `--bg-raised` + `--shadow-md` | `--bg-raised` + `--shadow-sm` |
| 3 — drawer | `--bg-overlay` + `--shadow-lg` | `--bg-overlay` + `--shadow-md` |
| 4 — modal | `--bg-overlay` + `--shadow-lg` + scrim | same + scrim |

Light mode uses shadow for depth; dark mode uses luminance steps, with shadow only to anchor floating layers. Heavy shadows on dark backgrounds read as smudges.

---

## 6. Status System

The most important semantic system in the product.

### Severity

| Severity | Icon | Colour | Meaning |
|---|---|---|---|
| Critical | filled circle with `!` | danger | Money is provably missing or misdirected |
| High | triangle with `!` | warning | Likely discrepancy needing action this week |
| Medium | hollow circle | info | Anomaly worth reviewing |
| Low | small dot | muted | Informational; safe to batch |

### Exception status

| Status | Presentation |
|---|---|
| Open | Solid severity colour, full-weight row |
| Investigating | Severity colour with a left rail and assignee avatar |
| Resolved | Muted, strikethrough on the exposure figure, checkmark |
| Ignored | Muted at 70% opacity, hidden by default filter |

### Account state

| State | Presentation |
|---|---|
| Healthy | No indicator — absence is the signal |
| Payouts paused | Warning chip: "Payouts paused — related checks suppressed" |
| Charges disabled | Danger chip |
| Syncing / backfilling | Info chip with a progress ratio |

The "payouts paused" chip earns its place. Without it, an operator sees suppressed checks and assumes the system missed something. One chip converts a trust problem into an explanation.

---

## 7. Component Specifications

### Button

| Variant | Light | Dark | Use |
|---|---|---|---|
| Primary | `brand-fill` bg, white text | `brand-fill` bg, `#06121F` text | One per view maximum |
| Secondary | `--bg-surface`, `--border-default`, `--text-primary` | same tokens | Default action |
| Ghost | transparent, `--text-secondary` | same | Toolbar, tertiary |
| Danger | `--danger-fg` border + text; solid fill only on confirm | same | Destructive |

```
Sizes:   sm 28px · md 32px · lg 40px      (compact scale — this is a dense tool)
Radius:  radius-sm (4px)
States:  default → hover (fill-hover) → active (fill-active + scale .98)
         → focus (2px --border-focus ring, 2px offset)
         → loading (inline spinner, label retained, width locked)
         → disabled (40% opacity, cursor not-allowed)
```

Loading state keeps the label and locks the width. A button that collapses to a spinner shifts the layout under the user's cursor.

### Badge / Chip

```
Height 20px · padding 0 6px · radius-xs · label 11px/600 uppercase +0.04em
Composition: [icon 12px] [label]     — colour is never the only signal
Variants: success · warning · danger · info · muted · brand
```

### Data Table

```
Header:  sticky, --bg-surface, 1px --border-default bottom, table-head type
Row:     height per density, 1px --border-subtle bottom
         hover  → --bg-hover        (CSS only, never JS state)
         select → --bg-selected + 2px --border-brand left rail
         focus  → 2px --border-focus inset ring (keyboard navigation)
Columns: text left · numeric right + tnum · status centre · actions right, sticky
Sort:    click header; aria-sort; chevron indicator; shift-click for secondary
Resize:  drag handle on the header divider; persisted per user
Empty:   see §9
Loading: skeleton rows at EXACT final height — zero layout shift
```

### Filter Bar

```
[ Search ⌘/ ] [ Status ▾ ] [ Severity ▾ ] [ Account ▾ ] [ Rule ▾ ] [ Date ▾ ]
                                          [ Saved views ▾ ] [ ⚙ Columns ] [ ⇅ Density ]

Applied filters render as removable chips below the bar.
"Clear all" appears only when at least one filter is active.
Every filter writes to the URL — the view is always shareable.
```

### Exception Detail Panel

A right drawer at 640px on desktop; full screen below 1024px. Structure top to bottom:

```
┌────────────────────────────────────────────────┐
│ [severity] Rule name              [×]          │
│ Narrative sentence — plain language            │
│ ┌──────────────────────────────────────────┐   │
│ │ EXPOSURE          −$412.50 USD           │   │  ← Sora kpi, tnum
│ │ Account · Payout · First seen            │   │
│ └──────────────────────────────────────────┘   │
├────────────────────────────────────────────────┤
│ EVIDENCE                                       │
│  Expected            Actual         Δ          │  ← three columns, aligned
│  $1,200.00           $787.50        −$412.50   │
│                                                │
│ LINKED OBJECTS                                 │
│  ch_3PxK2m…  ⧉    po_1MtL9k…  ⧉               │  ← mono, click to copy
│                                                │
│ RULE TRACE                                     │
│  L2.DEST.TRANSFER_AMOUNT  ·  rule v14          │
│  maturity 2h  ·  evaluated 2026-08-29 09:14    │
│  parameters: { tolerance_minor: 0 }            │
│                                                │
│ HISTORY                                        │
│  ● opened      run #8821    2026-08-27 06:02   │
│  ● assigned    P. Kumar     2026-08-27 09:30   │
├────────────────────────────────────────────────┤
│ [Resolve]  [Ignore]  [Assign ▾]   [Open in ⧉]  │
└────────────────────────────────────────────────┘
```

The expected/actual/delta table is the heart of the panel. It is the answer to "why is this flagged" rendered as a comparison rather than a paragraph — which is how a finance operator actually reads a discrepancy.

### Form Controls

```
Height 32px (md) · radius-sm · 1px --border-default · --bg-surface
Focus:   --border-focus 1px + 2px ring at 20% opacity
Error:   --danger-fg border + icon + message text (never colour alone)
Label:   label token, --text-secondary, 4px above the control
Helper:  caption, --text-tertiary
Required: asterisk after the label, plus aria-required
```

---

## 8. Information Architecture

```
┌───────────────┬────────────────────────────────────────────────┐
│  MAGIC        │  Exceptions                       [⌘K] [◐] [▾] │
│  ─────────    │  ────────────────────────────────────────────  │
│  ⌂ Health     │  [filter bar]                                  │
│  ⚠ Exceptions │  ┌──────────────────────────────────────────┐  │
│  ↻ Runs       │  │ table                                    │  │
│  ⇄ Settlements│  │                                          │  │
│  ⛁ Accounts   │  │                                          │  │
│  ↓ Exports    │  └──────────────────────────────────────────┘  │
│  ⧉ Audit      │  [cursor pager]                                │
│  ⚙ Settings   │                                                │
│  ─────────    │                                                │
│  [tenant ▾]   │                                                │
│  [user ▾]     │                                                │
└───────────────┴────────────────────────────────────────────────┘
   240px, collapsible to 56px (icons + tooltips)
```

Navigation is flat and shallow. Every primary destination is one click. The tenant switcher sits at the bottom of the sidebar, visually separated — switching tenant is a context change, not a navigation action, and it deserves the friction of a distinct location.

Nav badges show open critical counts, and only critical. A badge on every item is a badge on nothing.

---

## 9. Screens

### 9.1 Health Overview

Leads with **completeness**, not revenue. A revenue figure at the top would imply this is a reporting tool; the first thing an operator needs to know is whether the data can be trusted at all.

```
Row 1 — trust tiles
┌────────────────┬────────────────┬────────────────┬────────────────┐
│ COMPLETENESS   │ INGESTION LAG  │ QUEUE DEPTH    │ LAST RUN       │
│ 100%           │ 12s            │ 0              │ 4 min ago      │
│ 2,847 accounts │ p95            │ all queues     │ 1,204 objects  │
│ 0 drift ✓      │ ✓ healthy      │ ✓ healthy      │ ✓ complete     │
└────────────────┴────────────────┴────────────────┴────────────────┘

Row 2 — exposure
┌─────────────────────────────────┬─────────────────────────────────┐
│ OPEN EXPOSURE BY SEVERITY       │ EXCEPTIONS OVER TIME (30d)      │
│ Critical  $4,182.00      3      │ [stacked area — opened vs       │
│ High      $12,904.55    47      │  resolved, muted palette]       │
│ Medium    $2,201.00    128      │                                 │
│ Low       $410.20      302      │                                 │
└─────────────────────────────────┴─────────────────────────────────┘

Row 3 — attention
┌─────────────────────────────────┬─────────────────────────────────┐
│ ACCOUNTS NEEDING ATTENTION      │ RECENT RUNS                     │
│ payouts paused · negative bal · │ payout · checksum Δ · exceptions│
│ sync failing                    │                                 │
└─────────────────────────────────┴─────────────────────────────────┘
```

Every tile is clickable and lands on the pre-filtered list behind it.

### 9.2 Exception Queue — the primary screen

Default columns, left to right:

```
[☐] SEVERITY  RULE               ACCOUNT      SUBJECT        EXPOSURE   AGE   ASSIGNEE  STATUS
[☐] ● Critical Payout checksum   Acme Studio  po_1MtL9k…     −$412.50   2d    —         Open
[☐] ▲ High     Transfer missing  Brightside   ch_3PxK2m…   −$1,204.00   6h    P.K.      Investigating
```

Design decisions worth naming:

- **Severity first.** It is the sort key an operator thinks in.
- **Exposure right-aligned, tabular, signed.** The delta sign is meaningful; a bare figure is not.
- **Age relative, not absolute.** "2d" beats a timestamp for triage; the exact time is in the tooltip and the detail panel.
- **Row click opens the drawer, list stays in place.** The operator never loses their position — the single biggest quality-of-life factor in queue work.
- **Bulk resolve is absent.** Bulk ignore and bulk assign exist. Resolving in bulk defeats the purpose of individual verification, and the omission is the design.

### 9.3 Reconciliation Runs

Run detail leads with the checksum, because it is the number that ties to the bank:

```
┌──────────────────────────────────────────────────────┐
│ Payout po_1MtL9k · Acme Studio · 2026-08-27          │
│                                                      │
│   Payout amount           $18,402.00                 │
│   Σ balance transactions  $17,989.50                 │
│   ────────────────────────────────────               │
│   Δ                        −$412.50   ⚠ MISMATCH     │
│                                                      │
│   Rule version 14 · transactional · 1,204 objects    │
│   Snapshot checksum a3f9…c210  [copy]                │
└──────────────────────────────────────────────────────┘
```

A green `Δ $0.00 ✓ BALANCED` is what a healthy run looks like, and it should feel like a receipt.

### 9.4 Settlements Explorer

The charge-type-agnostic browse view. Columns: date, merchant account, gross, fee, platform revenue, merchant net, status, match tier. Charge type is available as a filter and a detail field — but it never structures the table, because the whole architecture exists to keep it out of the surfaces above `settlements`.

### 9.5 Accounts

One row per connected account: name, country, charges/payouts enabled, last sync, completeness drift, open exception count and value. Sorted by exposure descending — the accounts costing the most money are the ones you want at the top.

### 9.6 Settings → Rules

Rules grouped by layer. Each row: enabled toggle, rule ID (mono), name, severity (override-able), maturity window, parameters, and — importantly — **a count of exceptions this rule has raised in the last 30 days and its ignore rate**.

That ignore rate is the tuning signal. A rule with an 80% ignore rate is producing noise, and surfacing that in the settings UI is what makes tuning a routine act rather than a project.

---

## 10. Motion

```
duration-instant  100ms   hover, focus, colour change
duration-fast     150ms   dropdown, tooltip, badge change
duration-base     200ms   drawer, panel, tab switch
duration-slow     300ms   modal, page transition
```

```
ease-out    cubic-bezier(0.16, 1, 0.3, 1)     entrances
ease-in     cubic-bezier(0.7, 0, 0.84, 0)     exits
ease-inout  cubic-bezier(0.65, 0, 0.35, 1)    both
```

No spring physics. No bounce. Springs read as playful, and playful is the wrong register for a tool people open when money is missing.

| Interaction | Motion |
|---|---|
| Row hover | Background 100ms, no transform |
| Detail drawer open | Slide from right 200ms `ease-out` + scrim fade |
| Row resolved | Fade to muted 200ms, then collapse height 150ms |
| Toast | Slide in from top-right 150ms, auto-dismiss 5s |
| Skeleton | Subtle shimmer, 1.5s loop, `--bg-sunken` → `--bg-hover` |
| Filter applied | Table body cross-fade 100ms — never a spinner over existing data |
| Nav collapse | Width 200ms `ease-inout` |

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## 11. Accessibility Checklist

| Requirement | Implementation |
|---|---|
| Contrast — body text | AA verified per token pair, both themes. `brand-500` explicitly excluded from body text in light mode |
| Contrast — UI components | 3:1 minimum on all borders, icons, focus rings |
| Focus visible | 2px `--border-focus`, 2px offset, on every interactive element |
| Keyboard operable | Full queue workflow without a pointer; no keyboard trap outside modals |
| Focus management | Drawer traps focus and restores to the originating row on close |
| Table semantics | Real `<table>`, `scope` on `<th>`, `aria-sort`, `<caption>` |
| Live regions | `aria-live="polite"` on result counts, toasts, run status |
| Colour independence | Severity and status always carry icon + text |
| Icon-only buttons | `aria-label` on every one |
| Skip link | "Skip to main content" as the first focusable element |
| Target size | 32px minimum interactive height; 24px icon buttons carry 4px padding to reach 32px |
| Reduced motion | Guard applied globally |
| Zoom | Usable at 200% without horizontal scroll on the primary column set |
| Forms | Label associated, error announced, `aria-describedby` on helper and error text |

---

## 12. Responsive Behaviour

| Breakpoint | Layout |
|---|---|
| ≥ 1440 | Sidebar 240px + table + 640px drawer side by side |
| 1280–1439 | Drawer overlays the table |
| 1024–1279 | Sidebar collapses to icons; secondary columns hide |
| 768–1023 | Sidebar becomes a sheet; table drops to a card list; drawer is full-screen |
| < 768 | Read-only. Health tiles and a card list. Resolution actions hidden with an explanatory note |

Phone is deliberately view-only. Resolving a financial discrepancy on a 375px screen without the evidence panel is an invitation to a mistake, and shipping a cramped version of a high-stakes action is worse than not shipping it.

Column priority as width shrinks:

```
Always:  severity · rule · exposure · status
Then:    account · age
Then:    subject · assignee
First to hide: subject id, assignee
```

---

## 13. Delight — Redefined for This Product

The standard delight checklist does not transfer. Here is the version that does.

| Standard | MAGIC equivalent |
|---|---|
| Hero feels alive on load | Health tiles resolve instantly with real numbers — no spinner theatre |
| Illustrated empty states | All-clear state states *when* it was verified, not just that it is empty |
| Human error messages | Errors say what is unaffected and carry a copyable trace ID |
| A moment of delight | A table that never janks, and `j`/`k` that never drops a keystroke |
| Onboarding feels like a welcome | First run shows the discovery report — "here is what we found in your account" — before asking for anything |
| Informative loading | Skeletons at exact final dimensions, zero layout shift |
| Typographic rhythm | Tabular figures that align perfectly down a column of 50 amounts |
| Premium dark mode | Dark is the default for operators who live in the tool; both modes are designed, neither is inverted |

The reflective-level goal is not "that was fun." It is **"I trust this thing."** Trust is earned through precision, consistency, and never being wrong in a small visible way — because a user who catches the UI misaligning a decimal point will start doubting the reconciliation engine behind it.
