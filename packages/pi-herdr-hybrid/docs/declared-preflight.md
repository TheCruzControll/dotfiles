# Declared launch preflight

`subagent`, `subagent_resume`, and individual `subagent_workflow` steps accept an optional `preflight` object:

```json
{"cwd":"/absolute/project","executables":["node","./node_modules/.bin/tsc"],"paths":["package.json","node_modules","test/verify.ts"]}
```

Checks run synchronously during planning, before admission, artifact writing, stale resume-sidecar removal, or pane creation. `cwd` asserts the effective child directory (resume uses its saved policy); real paths are compared, so symlink aliases work. Declaring any preflight also requires that directory to exist. Executables must be executable regular files, resolved relative to child cwd or the supplied parent PATH. Paths must be readable; use them to assert prepared dependencies or verification files. Each list has at most 16 entries and each string at most 4096 characters; PATH lookup examines at most 256 entries. Errors identify the requirement index without echoing declaration contents.

Checks never execute commands, install anything, load project configuration, or inspect dependency contents. Shell punctuation is literal. This establishes availability only, not runtime versions, a complete dependency graph, test success, or environment changes introduced later by direnv/prefix wrappers. Filesystem checks are snapshots, not protection against later changes. Only declare resources expected in the parent planning environment. Nothing is inferred from task prose. Checks are request-local: resume callers must declare them again. Omitted checks retain existing behavior and saved policy format.

Auto-exit now waits for Pi's final `agent_settled` notification, not low-level `agent_end` (which can precede queued work/retries). An aborted settle cannot publish completion. Explicit `subagent_done` handoffs remain unchanged.

Other existing lifecycle behavior is preserved: startup ready/executing signals are distinct from pane creation; Escape is only an interruption request; explicit completion, unreported clean exit, crash and pane death have distinct watcher outcomes and lifecycle reasons. Chains already block on every outcome except explicit `completed`. A pane closure without completion evidence is not success. Broad lifecycle status `completed` still means terminal zero-exit evidence for ownership settlement, not task acceptance; inspect `reason` to distinguish `completed-user-exit`.
