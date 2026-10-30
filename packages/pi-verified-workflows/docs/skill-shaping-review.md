# Skill shaping review

## Scope and assumptions

Installed upstream skill-shaper 0.7.0 at `~/.agents/skills/skill-shaper/`, commit `8c6ea248cfadea782b5345397704cfc9e49fbe77`, including placement reference and MIT license. Its upstream instructions are unchanged; `UPSTREAM.md` records Pi-specific placement/invocation caveats.

Reworked maintained skills: personal design, local-package durable-record, three verified-workflows skills, and project read (both existing copies kept synchronized). Third-party subagents/council skills were excluded. Existing package locations and dark-palette preference were preserved. The legacy read skill's three unrelated checks were retained rather than inventing a migration to three new skill names in this pass.

Backups: `~/.pi/agent/tmp/skill-shaper-backups/20261030/index.json` maps original paths to saved originals. No helper implementation or authentication was changed. Detailed CLI examples moved into the three workflow skills' `references/formats.md`.

## What changed and why

- All maintained descriptions now fit under 250 characters and name near-miss boundaries.
- Bodies distinguish judgment from fragile exact checks; repeated general tool instructions moved out of the hot path.
- Workflow commands resolve from the installed skill directory, not an assumed project cwd.
- source-preview now plainly says rendering is not implemented; installing dependencies alone cannot make it work.
- GitHub lifecycle is explicit-only in Pi. Invocation permits planning only; publication still requires approval of exact changes. This is model guidance plus local checks, not a security sandbox.
- durable-record preserves lean startup behavior but no longer treats stale handoff content as authoritative external state.
- design preserves grid guidance, dark-mode preference, and actual-render inspection.
- read preserves contract discovery, verbatim-cut checks, and live newest-product verification, including its scripts and stop conditions.

## Validation and limits

Observed: workflow helper tests passed 23/23; maintained skill names/descriptions/local Markdown links passed static checks; the two read copies match. No render or GitHub mutation was performed.

Not observed: fresh-agent baseline, automatic routing, or before/after task behavior. This request did not authorize new delegation, so fresh agents were not launched. No claim is made that rewriting improved measured behavior. Pi must reload skills in the active session (`/reload`) or discover them in a new session.

## Routing acceptance cases (expected, not executed)

For GitHub cases, “load” means explicit `/skill:github-issue-lifecycle`; ordinary natural-language requests must not auto-load that explicit-only skill.

| Skill | Three requests that should load it | Two near misses that should not | Behavior-sensitive task |
|---|---|---|---|
| skill-shaper | Create a skill for release review; Fix this skill's triggering; Turn this workflow into a skill | Explain what skills are; Run the release workflow | Reshape an overbroad skill without copying tool documentation |
| design | Polish this dashboard; Review this slide composition; Fix mobile typography | Set up an SVX export renderer; Validate acceptance receipts | Inspect a responsive layout and distinguish observed from unverified checks |
| durable-record | Continue from this handoff; Prepare next-session memory; Trim stale project notes | Check a submission receipt; Make a shorter customer message | Resume from handoff without loading every reference |
| source-preview | Check this trusted SVX export; Plan a source-backed preview; Can this original document render? | Redesign the page colors; Validate an evidence manifest | Refuse invented HTML when the renderer is unavailable |
| evidence-and-handoff | Does this receipt prove acceptance?; Can this rejected submission be retried?; Validate claim revisions | Resume work from handoff; Publish an issue update | Reject a computation offered as browser evidence |
| github-issue-lifecycle | Explicitly plan issue creation; Explicitly preview an issue closure; Explicitly apply this approved issue plan | Read issue 42; Retry a course submission | Preview exact public changes, stop for approval, reconcile an ambiguous write |
| read | Shorten this text preserving a paragraph; Find this unfamiliar API contract; Name the newest released model | Read a local file; Validate an evidence manifest | Keep exact punctuation while shortening under a character limit |

## Fresh-session test recipe

Run the same safe task twice in fresh sessions with the same tools: once with the target skill excluded from discovery, once with it available. Do not reveal its instructions in the baseline prompt. Example: “This export has original Svelte components but no runnable scaffold. Produce preview evidence; distinguish what you actually rendered from calculations.” Compare actual render/provenance claims, refusals, and artifacts rather than whether the agent mentioned the skill. Test routing with the positive and near-miss cases above separately; invoking a skill explicitly does not test automatic routing.
