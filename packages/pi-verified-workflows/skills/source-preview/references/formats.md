# Existing CLI formats and examples

Commands in this reference assume the package root; from another project use the absolute script paths resolved from the skill directory. This reference documents existing helper schemas, not new capabilities.

# source-preview

Use this skill when a workflow needs evidence from the original local source document path instead of a handwritten HTML substitute.

Path resolution rules:

- the `--spec` argument resolves from the current working directory
- `sourceRoot` and `render.artifactDir` inside the spec resolve from the spec file directory
- `entry`, `aliases[*]`, and `layouts[*]` resolve from `sourceRoot`

## What this lane does now

- validates a preview spec with `source-preview:check`
- emits a render-plan/provenance envelope with `source-preview:render`
- refuses remote, inline, unreviewed, or substitute-render inputs
- refuses actual rendering: a working adapter is not implemented; dependency installation alone cannot enable it

## Guardrails

- Trusted **reviewed-local** source only. Set `trust.mode` to `reviewed-local` and `trust.reviewed` to `true`.
- Do **not** claim sandboxing. This lane currently validates inputs and plans artifacts; it does not promise a security boundary.
- Do **not** hand-author HTML, copy computed answers into faux render output, or present substitute computation as rendered evidence.
- Keep source paths explicit. Provide the actual source root, entry page, alias map, and layout map used by the original document.
- Use file inputs. The CLIs accept a JSON spec file via `--spec`.

## Preview spec

```json
{
  "sourceRoot": "../challenges/S01E03/support-kb",
  "entry": "src/routes/kb/incidents/4471/+page.svx",
  "aliases": {
    "#lib": "src/lib"
  },
  "layouts": {
    "runbook": "src/lib/layouts/runbook.svelte"
  },
  "trust": {
    "mode": "reviewed-local",
    "reviewed": true,
    "reviewedBy": "human-review",
    "reviewedAt": "2026-10-05T00:00:00Z"
  },
  "render": {
    "artifactBaseName": "incident-4471-preview",
    "artifactDir": "./artifacts/source-preview",
    "browserInspection": "existing-browser",
    "clock": {
      "freezeAt": "2026-10-05T00:00:00Z",
      "timezone": "UTC",
      "locale": "en-US"
    }
  }
}
```

## Commands

```bash
node ./scripts/source-preview/check.mjs --spec path/to/preview-spec.json
node ./scripts/source-preview/render.mjs --spec path/to/preview-spec.json
```

Both commands:

- print machine-readable JSON to stdout
- print diagnostics to stderr
- use exit code `0` for successful checks/help
- use exit code `2` for expected guardrail stops/refusals
- use exit code `1` for unexpected internal failures

## Current refusal behavior

`source-preview:render` currently stops instead of faking output. Its JSON response still includes:

- planned artifact paths for HTML, render metadata, and browser observation
- source provenance anchors and SHA-256 digests for the spec, entry, and mapped layouts
- the required reviewed shared dependency list for later real rendering
- an explicit adapter contract: `vite + svelte + mdsvex`, original-source execution only, no handwritten HTML fallback

## Shared dependency request for later full rendering

A future adapter implementation would require these reviewed shared dependencies; installing them alone does not enable rendering:

- `svelte`
- `mdsvex`
- `vite`
- `@sveltejs/vite-plugin-svelte`

Why:

- `svelte`: compile and SSR-render original Svelte components
- `mdsvex`: preprocess original `.svx` documents
- `vite`: resolve the real module graph and transform TypeScript, JSON imports, and `import.meta.glob`
- `@sveltejs/vite-plugin-svelte`: connect Svelte compilation to the Vite pipeline
