# orchestrator

An always-on engineering orchestrator for [pi](https://pi.dev). The `orchestrator` skill rides along in every turn: it answers trivial asks directly, and routes real work through a playbook, a set of named engineering principles, and deliberate background subagents. Around it sit 55 situational skills and two subagents.

The aim is less code, of higher quality, proven against the real artifact. When one agent can be trusted to write small, verifiable changes, you can run many in parallel with confidence. Every frontier model has different strengths, so the design and review skills run multi-model panels.

## Install

```bash
pi install npm:@tintinweb/pi-subagents@0.23.1
pi install ~/dotfiles/packages/orchestrator
```

[pi-subagents](https://github.com/tintinweb/pi-subagents) provides the `Agent` tool that every playbook spawns through. If it is missing, the extension warns at session start.

The PR watcher (`skills/orchestrator/scripts/watch-pr`) used by the Babysit and Shipping playbooks needs [Bun](https://bun.sh) (`brew install oven-sh/bun/bun`). Without it those playbooks fall back to polling with `gh`.

## Get started

1. Run [`/skill:setup-orchestrator`](./skills/setup-orchestrator/SKILL.md). It detects your models, asks for a reasoning budget, and writes your role lines (see [Models](#models)).
2. Then just prompt. The extension injects the orchestrator skill into the system prompt on every turn, so there is nothing to invoke.

```
this pr has a subtle bug where the scroll drifts every 750ms even when idle. repro first, then fix
and verify.
```

```
i'm going to bed. land the stack even if ci flakes. i want everything merged by morning.
```

Trivial or conversational prompts ("what does git rebase -i do") get a direct answer, with no playbook and no subagents. For everything else the orchestrator:

1. matches your task to a playbook and opens a `todo` list whose first items are its steps, copied in verbatim.
2. routes to the other skills as the steps fire.
3. writes unslopped replies framed for the consumer and the maintainer.

`/orchestrator off` stops the injection for the current session, `/orchestrator on` restores it, and `/orchestrator status` shows which is active. It is on by default.

New here? The [guide](./docs/guide/README.md) walks through a first real task, from setup and prompting through verification and overnight runs. Stuck, or unsure which skill fits? Ask [`/skill:orchestrator-help`](./skills/orchestrator-help/SKILL.md). The full rules live in [`skills/orchestrator/SKILL.md`](./skills/orchestrator/SKILL.md).

### Playbooks

<details>
<summary>the twenty-three playbooks</summary>

| playbook | for |
|---|---|
| [investigation](./skills/orchestrator/playbooks/investigation.md) | a read-only question. how does x work, why was y built this way, are we sure. |
| [bug fix](./skills/orchestrator/playbooks/bug-fix.md) | reproduce a defect, root-cause it, and fix with runtime evidence. |
| [perf](./skills/orchestrator/playbooks/perf-issue.md) | trace a measured slowness and improve it against a baseline. |
| [hillclimb](./skills/orchestrator/playbooks/hillclimb.md) | sustained, scientific improvement of one metric against a target, looping hypotheses with before/after measurement and one commit per accepted win. |
| [runtime forensics](./skills/orchestrator/playbooks/runtime-forensics.md) | diagnose a live symptom (leak, idle-cpu spin, glitch) from instrumentation. |
| [trace forensics](./skills/orchestrator/playbooks/trace-forensics.md) | diagnose a captured profiling artifact (cpuprofile, trace, spindump, heap snapshot). |
| [feature](./skills/orchestrator/playbooks/feature.md) | new or changed behavior, built from a named data shape. |
| [refactoring](./skills/orchestrator/playbooks/refactoring.md) | a behavior-preserving change to structure or shape. |
| [prototype](./skills/orchestrator/playbooks/prototype.md) | a throwaway sketch to make a design or behavioral decision cheaply, or to settle an empirical fork by observing it. |
| [visual parity](./skills/orchestrator/playbooks/visual-parity.md) | pixel-exact ui equivalence between two implementations. |
| [authoring a skill](./skills/orchestrator/playbooks/authoring-a-skill.md) | writing or editing a SKILL.md. |
| [eval](./skills/orchestrator/playbooks/eval.md) | test how a skill or prompt change affects agent behavior, blinded. |
| [babysit](./skills/orchestrator/playbooks/babysit.md) | drive a pr or a stack to merge-ready: conflicts, review threads, ci. |
| [shipping](./skills/orchestrator/playbooks/shipping.md) | independently verify a green stack, then land the contiguous verified run bottom-up through github by default or origin when available. |
| [autonomous run](./skills/orchestrator/playbooks/autonomous-run.md) | drive a long task to completion without stopping. |
| [orchestrate](./skills/orchestrator/playbooks/orchestrate.md) | a standing project handed to one coordinator chat: multi-day, many stacked prs, fleets of subagents. |
| [autopilot-full](./skills/orchestrator/playbooks/autopilot-full.md) | run independent prs to merged with one owner per pr. a swarm verifies each code-ready head, and every later change to the patch gets a fresh check. |
| [autopilot-stack](./skills/orchestrator/playbooks/autopilot-stack.md) | autopilot-full without the merge. build and verify prs for the operator to review and land, stacking a pr only on a pr it builds on. |
| [session pickup](./skills/orchestrator/playbooks/session-pickup.md) | resume or take over a prior agent's in-flight work. |
| [pause safely](./skills/orchestrator/playbooks/pause-safely.md) | suspend in-flight work cleanly so it can be resumed later. |
| [multi-phase plan](./skills/orchestrator/playbooks/multi-phase-plan.md) | work that spans phases or stacked PRs. |
| [worktree cleanup](./skills/orchestrator/playbooks/worktree-cleanup.md) | reclaim disk by pruning merged or abandoned worktrees and stale ios simulators, safety-gated. |
| [opening a pr](./skills/orchestrator/playbooks/opening-a-pr.md) | open a ready pr from small ordered commits with a conventional commits title and a briefing-style body. invoked at the end of every other playbook. |

</details>

## Skills

The orchestrator runs most of these for you when a step needs them (`how`, `why`, `architect`, `arena`, `swarm`, `interrogate`, `unslop`, `no-comments`, `technical-writing`, `tdd`, and the principles). Type `/skill:<name>` to run one directly:

```
/skill:how do we cancel runs? do we have an n+1 when we look up every run to cancel?
```

```
/skill:interrogate review this pr.
```

<details>
<summary>all skills</summary>

| skill | use it when |
|---|---|
| [`/skill:orchestrator`](./skills/orchestrator/SKILL.md) | the entry point for any non-trivial task. always on through the extension; type it only to load the rules explicitly. |
| [`/skill:orchestrator-help`](./skills/orchestrator-help/SKILL.md) | you're new to orchestrator, or unsure which skill, playbook, or principle fits. finds out what you're trying to do, answers that part, and hands you a prompt to type. runs only when you type `/skill:orchestrator-help`. |
| [`/skill:in-your-own-words`](./skills/in-your-own-words/SKILL.md) | you want the agent to play back your goal and the problem before it starts. runs only when you type `/skill:in-your-own-words`. |
| [`/skill:sharpen`](./skills/sharpen/SKILL.md) | you want a prompt made deeper, not bigger, before you send it: what a top professional would do that you didn't ask for, the raw material they'd start from, their methods and tools, and an outside check that the result is right. hands back the rewritten prompt and leaves your choices open. doesn't do the task. runs only when you type `/skill:sharpen`. |
| [`/skill:how`](./skills/how/SKILL.md) | you want a walkthrough of how a subsystem works. |
| [`/skill:why`](./skills/why/SKILL.md) | you want to know why something was built this way. discovers available MCPs at run time and queries each evidence category in parallel (source control, issue tracker, long-form docs, real-time chat, infra observability, error tracking, analytics warehouse). |
| [`/skill:recall`](./skills/recall/SKILL.md) | you're starting or resuming work and want your recent context on a topic rebuilt from your own chat history and the shared record, handed back as a tight current-state brief. |
| [`/skill:ketchup`](./skills/ketchup/SKILL.md) | you want what changed in this chat since your last message, in plain words and small visuals, with every item waiting on you listed and decidable from the reply alone, even when that makes the reply long. |
| [`/skill:blast-radius`](./skills/blast-radius/SKILL.md) | you have a small-looking change and want to know what else it could break, with the one fact it's safe because of proven by running code, not asserted. |
| [`/skill:architect`](./skills/architect/SKILL.md) | you're about to write code that crosses a function boundary and want the caller's usage, types, and module shape settled first. |
| [`/skill:arena`](./skills/arena/SKILL.md) | you want N parallel attempts at the same thing, then to grab the best parts of each. |
| [`/skill:swarm`](./skills/swarm/SKILL.md) | you want N parallel workers across different slices or races, then one aggregated report. |
| [`/skill:interrogate`](./skills/interrogate/SKILL.md) | you have a diff and want different models to try to break it, keeping only findings a run proves. |
| [`/skill:automate-me`](./skills/automate-me/SKILL.md) | you want your own `-mode` skill, drafted from how you've actually worked. |
| [`/skill:setup-orchestrator`](./skills/setup-orchestrator/SKILL.md) | you want to pick which models orchestrator uses per role. detects your models and writes `~/.pi/agent/orchestrator-models.md`. |
| [`/skill:reflect`](./skills/reflect/SKILL.md) | a long task landed and you want the recipe captured as a skill edit. |
| [`/skill:correct`](./skills/correct/SKILL.md) | you keep correcting agents for the same mistakes. mines history for mistake classes, fixes each at the highest level that works (architecture, then types, lint, and ci, then tests, with docs last), and keeps a table pairing each rule with what enforces it. |
| [`/skill:teach`](./skills/teach/SKILL.md) | you want to actually understand a change or subsystem, not just have it summarized. runs how + why and weaves one plain explanation, built up diagram by diagram. |
| [`/skill:tdd`](./skills/tdd/SKILL.md) | you're fixing a bug and there's a cheap local test path. write the failing test first, then the fix. |
| [`/skill:benchmark-checklist`](./skills/benchmark-checklist/SKILL.md) | you ran a benchmark or measured a speedup or regression. vets the number (limiter, tuning, errors, repeat runs, end-to-end relevance) before you report or act on it. |
| [`/skill:no-comments`](./skills/no-comments/SKILL.md) | strip comments before review; spawns Comment Sicko, fixes accepted findings, offers encodings for claimed constraints. |
| [`/skill:typescript-best-practices`](./skills/typescript-best-practices/SKILL.md) | you're reading or editing typescript. grounds the type-system-discipline principle in syntax. |
| [`/skill:figure-it-out`](./skills/figure-it-out/SKILL.md) | no bundled playbook fits. designs a rigorous, auditable playbook for the task. |
| [`/skill:show-me-your-work`](./skills/show-me-your-work/SKILL.md) | you want a reviewable decision trail. logs decisions to a tsv you can commit. |
| [`/skill:create-verification-skill`](./skills/create-verification-skill/SKILL.md) | your project has no scripted way to prove app behavior. generates a project-local verify skill with a feature map, for any language or platform. |
| [`/skill:maintain-verification-skill`](./skills/maintain-verification-skill/SKILL.md) | your verify skill's feature map has drifted from the app. source wave + one live pass, at most one PR of proven corrections. |
| [`/skill:create-formal-verification-skill`](./skills/create-formal-verification-skill/SKILL.md) | tests can't reach the case that breaks a race, retry, state machine, parser, or unsafe code. verifies one property with the tool that fits and generates a project-local skill to recheck it on every change. |
| [`/skill:maintain-formal-verification-skill`](./skills/maintain-formal-verification-skill/SKILL.md) | code your formal verification covers has changed since it was last checked. updates the model, harness, or properties to match the code, reruns, and says whether each failure is drift in the verification or a bug in the code. |
| [`/skill:statechart`](./skills/statechart/SKILL.md) | someone who owns the behavior needs to see it, not read a spec. checks a tla+ model, draws what the user sees as a mermaid statechart, marks each state that breaks a rule, and gives the shortest path to each one. |
| [`/skill:unslop`](./skills/unslop/SKILL.md) | you're cleaning up writing. removes AI tells. |
| [`/skill:bro`](./skills/bro/SKILL.md) | you want the last message restated in plain human language, no jargon. |
| [`/skill:technical-writing`](./skills/technical-writing/SKILL.md) | layered doc standard (Diátaxis + Google developer style + STE + Global English) for docs, RFCs, readmes, PR descriptions, commit messages. |

</details>

<details>
<summary>example prompts</summary>

```
bug fix:           this pr has a subtle bug where the scroll drifts every 750ms even when idle.
                   repro first, then fix and verify.
perf:              a big list takes a second or two to load even though we virtualize. run a cpu
                   trace and tell me why.
feature:           build a small feature behind a feature flag. verify it really works.
prototype:         build two prototypes of the markdown renderer so we can compare. spawn an agent
                   for each.
multi-phase:       open source these skills as a package. nothing internal leaks, work in a temp
                   dir, show me the dependency graph first.
overnight run:     i'm going to bed. land the stack even if ci flakes. i want everything merged by
                   morning.
babysit:           check on pr 123. anything outstanding?
visual parity:     the row spacing is too tall when this flag is on. the second image is correct.
                   repro and fix until it matches.
figure it out:     i'm stepping away. migrate every caller from the synchronous store to the new
                   async one, keeping behavior identical. i want to trust it was done right when
                   i'm back.
how:               /skill:how do we cancel runs? do we have an n+1 when we look up every run to
                   cancel?
why:               /skill:why is this feature flag not on yet?
architect:         design this instrumentation to be high signal with no false positives.
                   /skill:architect this first.
arena:             /skill:arena take my prompt to the arena verbatim. i want to compare their
                   proposals with yours.
swarm:             /skill:swarm check every package under packages/ against its check.sh. one
                   worker per package. one report.
interrogate:       /skill:interrogate review this pr.
tdd:               /skill:tdd implement
unslop:            can we unslop and tighten the new changes?
reflect:           /skill:reflect that took too long. capture what we learned so the next run
                   doesn't repeat it.
correct:           /skill:correct
show-me-your-work: /skill:show-me-your-work keep a decision trail i can review when i'm back.
automate-me:       /skill:automate-me
help:              /skill:orchestrator-help which skill should i use to review this branch?
```

</details>

### Principles

Twenty-four short skills, one principle each. `orchestrator` indexes them inline and reads that index at task start. The standalone files let other skills reference a principle by name, and let the index point at the full rule for each.

<details>
<summary>all twenty-four principles</summary>

| principle | group | rule |
|---|---|---|
| [laziness-protocol](./skills/principle-laziness-protocol/SKILL.md) | core | Bias toward deletion and the smallest change that solves the problem. |
| [foundational-thinking](./skills/principle-foundational-thinking/SKILL.md) | core | Apply before writing logic: choosing core types and data structures, sequencing scaffold-vs-feature work, asking what concurrent actors share. Get the data structures right so downstream code becomes obvious. |
| [redesign-from-first-principles](./skills/principle-redesign-from-first-principles/SKILL.md) | core | Redesign as if the requirement had been a foundational assumption from day one, instead of bolting it on. |
| [attack-the-premise](./skills/principle-attack-the-premise/SKILL.md) | core | Apply when two or more fixes that share one premise have failed the same gate. Write the premise down and test it directly before you write another fix that assumes it. |
| [subtract-before-you-add](./skills/principle-subtract-before-you-add/SKILL.md) | core | Remove dead weight, redundant validators, and stub references first, then build on the simpler base. |
| [minimize-reader-load](./skills/principle-minimize-reader-load/SKILL.md) | core | Count layers between question and answer, and hidden state in the reader's head; collapse one-caller wrappers and shrink mutable scope. |
| [outcome-oriented-execution](./skills/principle-outcome-oriented-execution/SKILL.md) | core | Apply during planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture; don't preserve smooth intermediate states with throwaway compatibility code. |
| [experience-first](./skills/principle-experience-first/SKILL.md) | core | Choose user delight over implementation convenience; ship fewer polished features over more rough ones. |
| [exhaust-the-design-space](./skills/principle-exhaust-the-design-space/SKILL.md) | core | Build 2-3 competing prototypes and compare side by side before committing. |
| [build-the-lever](./skills/principle-build-the-lever/SKILL.md) | core | Apply to any non-trivial work, not just bulk work: edits, migrations, analyses, checks. Build the tool that does it or proves it (codemod, script, generator, or a skill your subagents follow) instead of working by hand. The tool is the artifact a reviewer can rerun. |
| [model-the-domain](./skills/principle-model-the-domain/SKILL.md) | architecture | Encode the domain in a structure instead of scattered conditionals. |
| [boundary-discipline](./skills/principle-boundary-discipline/SKILL.md) | architecture | Concentrate guards at system boundaries (CLI, config, network, external APIs); trust internal types and keep business logic in pure functions. |
| [type-system-discipline](./skills/principle-type-system-discipline/SKILL.md) | architecture | Make illegal states unrepresentable, brand semantic primitives, parse external data at boundaries, exhaust variants, derive from authoritative schemas. |
| [make-operations-idempotent](./skills/principle-make-operations-idempotent/SKILL.md) | architecture | Converge to the same end state regardless of partial prior runs. |
| [migrate-callers-then-delete-legacy-apis](./skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md) | architecture | Migrate callers and delete the old API in the same wave instead of preserving compatibility layers. |
| [separate-before-serializing-shared-state](./skills/principle-separate-before-serializing-shared-state/SKILL.md) | architecture | Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant. |
| [prove-it-works](./skills/principle-prove-it-works/SKILL.md) | verification | Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles.'. |
| [fix-root-causes](./skills/principle-fix-root-causes/SKILL.md) | verification | Trace each symptom back to the first place the system went wrong and fix it there. A guard is a fix only when the state it handles is legitimate. |
| [sequence-verifiable-units](./skills/principle-sequence-verifiable-units/SKILL.md) | verification | Apply to multi-step work (sweeps, migrations, runs of similar edits) and to how you stack commits and PRs. Break work into small units that each end in a verifiable state, check each before the next, and order delivery so the sequence proves itself to a reviewer. |
| [test-behavior-not-implementation](./skills/principle-test-behavior-not-implementation/SKILL.md) | verification | Apply when you write, change, or keep a test. Assert what the code's users can observe, so the test fails when that behavior breaks and keeps passing when only the internals change. |
| [explain-the-number](./skills/principle-explain-the-number/SKILL.md) | verification | Apply before you trust, report, or act on a number you measured: a speedup, a regression, a throughput, a latency, or an eval result. Find what limits it, and rule out that it measured something other than the work you think. |
| [guard-the-context-window](./skills/principle-guard-the-context-window/SKILL.md) | delegation | Route bulk to subagents; keep summaries in the main thread, not raw payloads. |
| [never-block-on-the-human](./skills/principle-never-block-on-the-human/SKILL.md) | delegation | Proceed, present the result, let the human course-correct after the fact; reserve confirmation for irreversible actions. |
| [encode-lessons-in-structure](./skills/principle-encode-lessons-in-structure/SKILL.md) | meta | Encode the rule as a lint, metadata flag, runtime check, or script instead of more text. |

</details>

## Models

Role lines live in `~/.pi/agent/orchestrator-models.md`: one `role: provider/model:thinking` per line, no frontmatter. A panel role takes a comma-separated list. `inherit-parent` or `auto` runs the agent on the parent model. The extension injects the file next to the orchestrator skill, and every spawn passes the role's `model` and `thinking` to `Agent`.

[`/skill:setup-orchestrator`](./skills/setup-orchestrator/SKILL.md) writes the file. It lists your models with `pi --list-models`, maps the reasoning budget you pick onto the `:thinking` suffix (`max`, `xhigh`, `high`, `medium`), and lets you change any role. A missing file or line falls back to these defaults:

```
code delegates (feature, refactoring, bug-fix, perf-issue, hillclimb, swarm workers): openai/gpt-6.1-terra:high
how explorer, why investigators, reflect tooling: openai/gpt-6.1-terra:medium
judgment and prose, hardest tasks, how explainer, why synthesizer, reflect judgment/divergent/synthesizer: anthropic/claude-opus-5-5:xhigh
arena runners, arena cross-judge pool, architect runners, interrogate reviewers: anthropic/claude-opus-5-5:xhigh, openai/gpt-6.1-sol:high
escalation: anthropic/claude-fable-5-1:high
```

A code delegate that fails the same check twice hands the next attempt to `hardest tasks`, then once more to `escalation`.

When a default changes, a file written before the change still pins the old value. Delete those role lines, or the whole file, then run `/skill:setup-orchestrator` again. A rerun keeps any role whose model differs from the default.

## Subagents

The main session owns the playbook, the `todo` list, and every `Agent` spawn. The package ships two agents:

- [`orchestrator-agent`](./agents/orchestrator-agent.md) is the code-writing delegate spawned during a run. It has every tool and uses `prompt_mode: append`, so it inherits the parent prompt, orchestrator rules included. It pins no model; the caller passes the role's `model` and `thinking`. Spawn a fresh one per task, and never spawn it to run a playbook itself.
- [`comment-sicko`](./agents/comment-sicko.md) is a read-only comment reviewer (`read, grep, find, ls, bash`, `prompt_mode: replace`, so it gets no orchestrator rules). Run it through [`/skill:no-comments`](./skills/no-comments/SKILL.md) rather than directly.

Your own agents in `~/.pi/agent/agents/<name>.md` (global) or `.pi/agents/<name>.md` (project) keep working alongside these. pi-subagents ranks package agents below every agent you write, so a file of yours with the same name, such as `~/.pi/agent/agents/orchestrator-agent.md`, overrides the shipped one. `/agents` lists the shipped agents read-only, with Eject (an editable copy that shadows the original) and Disable.

## Credits

Forked from [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan, MIT. This package is MIT too; see [LICENSE](./LICENSE).
