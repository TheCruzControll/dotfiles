---
name: design
description: Designs, implements, or reviews visual work with deliberate hierarchy and composition. Use when appearance or visual usability matters; not for source-export render setup, which uses source-preview.
---

# Design

A polished source file is not evidence of a usable visual result.

## Two governing concepts

**Visual hierarchy:** decide what this audience should notice first, second, and last. Ask which action or message leads, whether real content supports that emphasis, and which decorative elements compete with it. Preserve existing brand, approved copy, interactions, and accessibility behavior unless the request changes them.

**Content-led grid:** organize relationships rather than pouring content into identical boxes. For multi-element pages, screens, slides, or dashboards, read `references/grid-systems.md`; choose shared edges and type measure from actual material, then use intentional exceptions. Small visual fixes need only the relevant part, not a full redesign.

## Local preferences and verification

- Default new visual work to a dark palette unless the user requests light or the existing system/approved brand requires otherwise. Contrast and state legibility still govern.
- Coordinate type roles, spacing, color, and alignment as a system; responsive layouts reflow instead of shrinking the desktop composition. Preserve reading and keyboard order.
- Inspect actual rendered output at representative sizes with real/long content and enlarged text. Look for broken hierarchy, clipping, alignment, contrast, focus, and motion-preference problems; iterate from what is observed.
- If rendering or browser access is unavailable, label the result unverified and give the concrete checks still needed. Do not substitute computed values or handmade HTML for rendering the actual implementation.

Report the governing visual decision and what was actually inspected, not a generic claim of visual or accessibility compliance. For source-document adapter setup use `source-preview`; for provenance/acceptance records use `evidence-and-handoff`.
