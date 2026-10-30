# Grid systems for visual composition

Source: [alpacassie — Grid systems for your AI agent](https://alpacassie.com/guides/grid-systems#gs-idea). This is a concise working adaptation of the guide, not a reproduction of its downloadable skill or of Müller-Brockmann's book. The guide distinguishes its selected historical sources from its own modern web recommendations.

## Build from content, not an empty template

1. Inventory the real headings, paragraphs, figures, captions, controls, and primary action. Decide what must fit and what should lead.
2. Choose a readable type measure and leading together with type size, then size the content area around actual text. Revisit the margins when those choices change.
3. Define outer margins and shared edges; choose only as many columns and gutters as the composition needs. Content may span several tracks. Do not default to twelve columns.
4. If using modules or repeated rows, coordinate their depth with text rhythm. Avoid cutting content into arbitrary equal-height boxes. Allow image-plus-caption groups to grow together.
5. Make display, body, metadata, and caption roles visibly distinct. Attach related material through alignment and proximity. Break an alignment only for a reason that strengthens the message.
6. Compare sketches or renders at actual size. A typeface or content change may require reconsidering line breaks, field depth, spacing, and margins rather than patching with offsets.

## Web adaptation

- Encode margins, gaps, and tracks as reusable CSS values where appropriate; use fluid tracks and a maximum reading width.
- Reduce or rearrange columns when the actual content no longer fits. Preserve a sensible reading and focus order; don't shrink the whole wide layout to mobile.
- Test narrow and wide screens, longer text, enlarged text, keyboard navigation, and reduced motion. The guide suggests 320px and 390px as useful narrow-screen checks, not universal breakpoints.
- A visible grid overlay can help inspect whether intended edges and spans really align; inspect the same page without it to judge hierarchy and reading flow.

## Useful design brief

For **[audience]**, help them **[main task]** on **[surface]**. With the actual content and existing brand rules, propose margins, columns, gutters, and any row divisions. Explain the shared alignment lines, text roles, image/caption relationships, responsive reflow, and any purposeful exception. Show what was tested, not just what was planned.
