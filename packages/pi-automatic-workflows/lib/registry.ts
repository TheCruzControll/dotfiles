export const WORKFLOWS = {
  lightweight: { label: "Lightweight", verify: false, summary: "Handle simple conversation or trivial edits without full process." },
  architect: { label: "Architect", verify: false, summary: "For substantive features or changes crossing a function boundary, ground the subsystem and compare at least two structurally different designs." },
  "bug-fix": { label: "Bug fix", verify: true, summary: "Reproduce, isolate root cause, fix, and rerun the original reproduction." },
  feature: { label: "Feature", verify: true, summary: "Understand the system, design the data/API shape, implement in verifiable steps, and verify behavior." },
  refactor: { label: "Refactor", verify: true, summary: "Establish behavior, change structure without behavior changes, run focused checks, inspect the diff." },
  investigation: { label: "Investigation", verify: false, summary: "Inspect evidence and explain how or why, with sources and uncertainty. Read-only." },
  review: { label: "Review", verify: false, summary: "Inspect changes and context; report concrete evidence-backed findings. Do not fix." },
  plan: { label: "Plan", verify: false, summary: "Investigate constraints, compare options, propose approach and verification, then stop for review." },
  performance: { label: "Performance", verify: true, summary: "Measure a baseline, diagnose bottleneck, improve, compare under equivalent conditions." },
  hillclimb: { label: "Hillclimb", verify: true, summary: "Explicit sustained optimization toward a named metric and stopping condition." },
  "runtime-forensics": { label: "Runtime forensics", verify: false, summary: "Instrument and diagnose a live runtime symptom; do not automatically fix." },
  "trace-forensics": { label: "Trace forensics", verify: false, summary: "Analyze a supplied performance trace/profile and state what it can establish." },
  prototype: { label: "Prototype", verify: false, summary: "Build a disposable experiment to resolve uncertainty; do not silently ship it." },
  "visual-parity": { label: "Visual parity", verify: true, summary: "Compare a UI with an explicit visual reference using rendering evidence." },
  "skill-authoring": { label: "Skill authoring", verify: true, summary: "Use skill-shaper for skill creation or trigger changes." },
  eval: { label: "Evaluation", verify: true, summary: "Compare behavior on representative scenarios; qualify small samples." },
  "session-pickup": { label: "Session pickup", verify: false, summary: "Reconstruct goal, state, evidence, and remaining work from authorized records." },
  "pause-safely": { label: "Pause safely", verify: false, summary: "Record state, checks, blockers, and restart path, then stop." },
  "multi-phase-plan": { label: "Multi-phase plan", verify: false, summary: "Plan ordered, verifiable phases and dependencies; stop for review." },
  "worktree-cleanup": { label: "Worktree cleanup", verify: false, summary: "Inspect requested cleanup candidates; obtain explicit deletion approval." },
  babysit: { label: "Babysit", verify: false, summary: "Work a requested PR toward merge-ready; status-only stays read-only; never infer merge permission." },
  shipping: { label: "Shipping", verify: true, summary: "Independently verify exact revisions; ship only explicitly authorized scope." },
  "opening-a-pr": { label: "Opening a PR", verify: true, summary: "Prepare and open a PR only when explicitly requested or authorized." },
  "autonomous-run": { label: "Autonomous run", verify: true, summary: "Continue only on an explicit long-run request with a predicate and stopping limits." },
  orchestrate: { label: "Orchestrate", verify: true, summary: "Coordinate an explicitly scoped long-running program with durable phases and dependencies." },
  "autopilot-stack": { label: "Autopilot stack", verify: true, summary: "Build and verify an explicitly authorized PR queue without merging." },
  "autopilot-full": { label: "Autopilot full", verify: true, summary: "Build, verify, and merge only an explicitly approved queue and merge scope." },
};

export const WORKFLOW_FILES = {
  lightweight: null, architect: "architect", "bug-fix": "bug-fix", feature: "feature", refactor: "refactoring",
  investigation: "investigation", review: "review", plan: "plan", performance: "perf-issue", hillclimb: "hillclimb",
  "runtime-forensics": "runtime-forensics", "trace-forensics": "trace-forensics", prototype: "prototype",
  "visual-parity": "visual-parity", "skill-authoring": "authoring-a-skill", eval: "eval",
  "session-pickup": "session-pickup", "pause-safely": "pause-safely", "multi-phase-plan": "multi-phase-plan",
  "worktree-cleanup": "worktree-cleanup", babysit: "babysit", shipping: "shipping", "opening-a-pr": "opening-a-pr",
  "autonomous-run": "autonomous-run", orchestrate: "orchestrate", "autopilot-stack": "autopilot-stack", "autopilot-full": "autopilot-full",
};

export const PRINCIPLE_NAMES = [
  "attack-the-premise", "boundary-discipline", "build-the-lever", "encode-lessons-in-structure",
  "exhaust-the-design-space", "experience-first", "explain-the-number", "fix-root-causes",
  "foundational-thinking", "guard-the-context-window", "laziness-protocol", "make-operations-idempotent",
  "migrate-callers-then-delete-legacy-apis", "minimize-reader-load", "model-the-domain",
  "never-block-on-the-human", "outcome-oriented-execution", "prove-it-works",
  "redesign-from-first-principles", "separate-before-serializing-shared-state",
  "sequence-verifiable-units", "subtract-before-you-add", "test-behavior-not-implementation", "type-system-discipline",
];

export const DEFAULT_CONFIG = Object.freeze({ enabled: true, projectOptOutFile: ".pi-workflows-off" });
