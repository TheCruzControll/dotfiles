---
name: source-preview
description: Checks whether a trusted local document export can be rendered from its original source. Use for source-backed previews, not visual redesign; use design for that.
---

# Source preview

Equivalent calculations and handwritten HTML do not prove that the original document rendered.

## Current boundary

This adapter is a validator/planner only: **real rendering is not implemented**, even if dependencies are installed. Do not describe planned HTML, screenshots, or browser observations as existing artifacts. Do not install dependencies or execute source to bypass the refusal.

## Run the check

Resolve `<package>` as `../..` from this skill directory, not the caller's working directory. Read `references/formats.md` for the existing spec shape.

1. Establish the actual source root, original entry, alias and named-layout mappings. Require reviewed-local source; a trust flag records a review, it does not perform one or sandbox code.
2. Write a JSON spec. Spec `sourceRoot` and `render.artifactDir` resolve from the spec directory; entry/alias/layout paths resolve from `sourceRoot`.
3. Run `node <package>/scripts/source-preview/check.mjs --spec <absolute-spec-path>`.
4. If a render is requested, `node <package>/scripts/source-preview/render.mjs --spec <absolute-spec-path>` currently returns a refusal with a provenance plan. Surface that blocker rather than manufacturing output.

## Evidence boundary

A future working adapter must preserve original components, layout, CSS and bundler transforms, then separately capture observations through the existing managed browser. A compiler result is not browser inspection; static SSR is not interaction testing. Use `evidence-and-handoff` to validate resulting records, not to certify their truth.
