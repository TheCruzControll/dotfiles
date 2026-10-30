# Council Mode Pass Contracts

Load this before launching council advisors.

## Pass 1 report

Include this JSON schema in the advisor task and request JSON text in its explicit completion summary. The hybrid does not expose an outputSchema parameter or external-runner API.

```js
const pass1OutputSchema = {
  type: "object",
  required: [
    "recommendation",
    "evidence",
    "assumptions",
    "risks",
    "confidence",
    "challengeClaims",
    "ownerDecisions",
    "changeMyMind"
  ],
  properties: {
    recommendation: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        required: ["claim", "sources"],
        properties: {
          claim: { type: "string" },
          sources: { type: "array", items: { type: "string" } }
        }
      }
    },
    assumptions: {
      type: "array",
      items: {
        type: "object",
        required: ["assumption", "status"],
        properties: {
          assumption: { type: "string" },
          status: { enum: ["verified", "unverified"] }
        }
      }
    },
    risks: { type: "array", items: { type: "string" } },
    confidence: {
      type: "object",
      required: ["level", "reason"],
      properties: {
        level: { enum: ["high", "medium", "low"] },
        reason: { type: "string" }
      }
    },
    challengeClaims: { type: "array", items: { type: "string" }, maxItems: 3 },
    ownerDecisions: { type: "array", items: { type: "string" } },
    changeMyMind: { type: "array", items: { type: "string" } }
  }
};
```

Task text:

- inspect supplied evidence directly
- do not ask other advisors or read peer reports
- stay read-only
- do not spawn children
- return only the structured report
- keep the report under about 600 words

Say: `Return only JSON matching this shape in your subagent_done summary. Do not wrap it in Markdown.` Include evidence the advisor cannot read with tools.

## Pass 1 aggregate receipt

Return one aggregate receipt. Preserve result order or map it by stable key.

The workflow receipt contains `id`, `status`, `steps`, and `children` keyed by stable step key. Each child includes `id`, `sessionFile`, `kind`, and explicit `summary`. The parent maps these to advisor identities and parses the JSON summary. Invalid JSON or missing required report fields require a parent-directed correction, not an invented structured result.

Do not replace `runtime-default-unknown` with a guessed context.

## Pass 2 challenge

A challenge packet contains only disputed claims, strong conflicting evidence, missing proof, owner decisions, and high-impact risks. Attribute peer content as "another advisor". Do not include full peer reports.

Include pass2OutputSchema as JSON-only task instructions for resumed or fresh fallback advisors.

```js
const pass2OutputSchema = {
  type: "object",
  required: ["responses", "recommendationChanged", "outOfScopeFindings"],
  properties: {
    responses: {
      type: "array",
      items: {
        type: "object",
        required: ["claimId", "disposition", "reason", "sources"],
        properties: {
          claimId: { type: "string" },
          disposition: { enum: ["accept", "reject", "refine", "owner-decision"] },
          reason: { type: "string" },
          sources: { type: "array", items: { type: "string" } }
        }
      }
    },
    recommendationChanged: {
      type: "object",
      required: ["changed", "reason"],
      properties: {
        changed: { type: "boolean" },
        reason: { type: "string" }
      }
    },
    outOfScopeFindings: { type: "array", items: { type: "string" } }
  }
};
```

Use concise names such as cross-oracle. Resume with subagent_resume({ sessionPath, message, name }). The parent collects receipts keyed by advisor using child IDs, sessionFile paths, and explicit summary text. Pass 3 uses the latest session paths. phase, output, runId-based resume, and structuredOutput are not hybrid API parameters.

## Advisor profile template

Create model-based advisors in the user or project agent directory, not in this package:

```markdown
---
name: council-sol
description: Read-only fresh-context advisor for bounded council decisions
tools: read, grep, find, ls
model: provider/top-reasoning-model
thinking: high
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: false
defaultContext: fresh
acceptanceRole: read-only
---

Analyze the council question independently. Inspect evidence directly. Do not edit, run mutating commands, commit, push, contact peers, or spawn subagents. Return concise, cited advice using the report contract in the council task.
```
