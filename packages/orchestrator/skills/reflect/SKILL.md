---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/skill:reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, use `$PI_SESSION_FILE` from `bash` for this conversation's transcript when set. Otherwise, look only in `~/.pi/agent/sessions/<slug>/`, where `<slug>` is `--` plus the workspace's absolute path without its leading `/`, with other `/` characters replaced by `-`, plus `--`. Do not search across workspace folders; that reads private chats from unrelated projects.

Session files are `<timestamp>_<uuid>.jsonl`; their first line is a session header, not a user message. Match the opening user message and conversation context to identify the active session; do not rely on recency alone. If no file can be identified unambiguously, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

One message, three background `Agent` calls, `subagent_type: "general-purpose"`. Reviewers need MCP access to look up the tickets, chat threads, and observability traces the transcript references. Tell them not to edit files.

Each reviewer and the synthesizer name a role line in `~/.pi/agent/orchestrator-models.md` and a default. The role lines are injected into context; if not, read the file. Use the line's value, or the default if the file or line is missing. Split `provider/model:thinking` into `model` and `thinking` for `Agent`; omit both when the value is `auto` or `inherit-parent`. If a model cannot be resolved and the agent falls back to the parent, say so and use the default when available. If the default is unavailable, use the closest available model of the same family and say so.

| Lens | Role line | Default `model:thinking` | Prompt template |
|---|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | `anthropic/claude-opus-5-5:xhigh` | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | `openai/gpt-6.1-terra:medium` | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | `anthropic/claude-opus-5-5:xhigh` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. After completion notifications, use `get_subagent_result` to retrieve each reviewer's full findings.

## 3. Synthesize

One background `Agent` call, `subagent_type: "general-purpose"`, model and thinking from the `reflect judgment, divergent, synthesizer` line (default `anthropic/claude-opus-5-5:xhigh`). It spot-verifies citations through MCP; tell it not to edit files. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. After its completion notification, use `get_subagent_result` to retrieve its Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. Read `../principle-encode-lessons-in-structure/SKILL.md` and follow it.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Never edit a skill in an installed package. Before approval, show its destination: `.pi/skills/<skill>/` or `.agents/skills/<skill>/` for a project, or `~/.pi/agent/skills/<skill>/` or `~/.agents/skills/<skill>/` for the user. After approval, copy an installed package's skill folder there and edit the copy. Never open a PR or push.

Skipped in pi: the built-in skill-creation handoff. pi has no built-in equivalent; use an available skill-creation skill as below, or report and skip these edits.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): read an available skill-creation skill's `SKILL.md` and follow its draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): read an available skill-creation skill's `SKILL.md` and follow it to optimize the description.
- `new skill: <kebab-name>`: read an available skill-creation skill's `SKILL.md` and follow it to create the skill. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
