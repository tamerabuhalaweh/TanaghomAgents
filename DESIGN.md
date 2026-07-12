# Design System

## Direction

Tanaghom is a light-first operational workspace: calm enough for long working
sessions, dense enough for real campaign operations, and explicit about what
requires human attention. The visual reference points are Linear's clarity,
Attio's operational density, and Stripe's finishing quality without copying any
one product.

## Color

All implementation colors use OKLCH.

```css
:root {
  --color-bg: oklch(1 0 0);
  --color-surface: oklch(0.972 0.006 190);
  --color-surface-strong: oklch(0.94 0.01 190);
  --color-ink: oklch(0.19 0.025 200);
  --color-muted: oklch(0.47 0.025 200);
  --color-border: oklch(0.88 0.012 190);
  --color-primary: oklch(0.42 0.09 185);
  --color-primary-hover: oklch(0.36 0.09 185);
  --color-primary-soft: oklch(0.94 0.025 185);
  --color-accent: oklch(0.68 0.20 35);
  --color-warning: oklch(0.78 0.16 75);
  --color-danger: oklch(0.58 0.22 28);
  --color-success: oklch(0.55 0.13 150);
}
```

Deep teal owns primary actions, selection, and working states. Coral is limited
to moments needing attention. Amber and red retain their standard warning and
failure meanings. State meaning never depends on color alone.

## Typography

Use Inter as the single product family with system fallbacks. Maintain a compact
fixed scale: 12px captions, 14px secondary UI, 16px body and controls, 20px
section headings, 28px page headings. Use tabular numerals for operational data.
Headings are semibold with letter spacing no tighter than -0.025em. Body copy is
limited to 70ch.

## Layout

Desktop uses persistent navigation and a bounded work canvas. Tablet becomes a
master-detail workspace. Mobile uses a compact header and bottom navigation,
with the same information architecture and no removed approval capability.

Use a 4px spacing foundation with semantic steps of 4, 8, 12, 16, 24, 32, 48,
and 64px. Group related controls tightly and separate operational sections
generously. Cards are reserved for truly independent actionable objects; lists,
dividers, and aligned regions carry most grouping.

## Signature Motif

The coordinated handoff motif is four connected nodes with one changing state.
It represents the four agents working through a shared record. Use it sparingly
in product identity, agent progress, and empty states; never as a decorative
page background.

## Components

- Controls use 10-12px corner radii; panels stop at 16px.
- Buttons and interactive rows provide at least 44px touch targets.
- Focus rings use a high-contrast teal outline with separation from the control.
- Status indicators combine icon, label, and plain-language explanation.
- Loading uses structural skeletons; failures state what happened and the next
  action; empty states teach the first useful action.
- Approval decisions remain inline or in a dedicated review workspace rather
  than generic confirmation modals.

## Motion

Use 150-220ms state transitions with ease-out curves. Motion communicates list
updates, selection, saved decisions, and navigation context. Respect reduced
motion and never delay access to operational information.

## Localization

Use logical CSS properties, avoid directional icons for non-directional meaning,
allow at least 30% text expansion, and keep UI strings whole for translation.
The initial release is English, with Arabic and RTL structure planned from the
first component.
