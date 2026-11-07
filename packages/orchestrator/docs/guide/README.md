# The orchestrator guide

Orchestrator works best when you stop micromanaging the agent. You describe what you want and how you'll know it's done. Orchestrator picks the playbook, runs the other skills as the steps need them, and shows you the evidence. It's on by default; use `/orchestrator on`, `/orchestrator off`, or `/orchestrator status` to control or check it. You can also invoke it with `/skill:orchestrator`. This guide teaches that habit with realistic prompts.

Here's what you'll learn:

1. [Set up orchestrator](./01-setup.md). Install the package and pick your models.
2. [Route work through orchestrator](./02-orchestrator.md). Give it a goal and watch it pick a playbook.
3. [Understand the code](./03-understand.md). A read-only investigation, then `/skill:how`, `/skill:why`, `/skill:teach`, and `/skill:recall` before you edit anything.
4. [Design the change](./04-design.md). `/skill:architect`, `/skill:arena`, `/skill:swarm`, `/skill:interrogate`, prototypes, and plans before code locks in a shape.
5. [Build and clean the change](./05-build-and-clean.md). The build playbooks, `/skill:tdd`, `/skill:unslop`, and `/skill:no-comments`.
6. [Verify and ship](./06-verify-and-ship.md). Prove behavior on the real app, formally verify what tests rarely reach, vet numbers with `/skill:benchmark-checklist`, then open a focused PR and drive it to merged.
7. [Run work while you sleep](./07-overnight.md). Trust before loops, an overnight contract, and a decision log you can audit.
8. [Steer with principle names](./08-principles.md). The 24 names that redirect an agent mid-task.
9. [Make it yours](./09-make-it-yours.md). Your own mode, `/skill:correct` for repeated mistakes, and how to test a skill change.
10. [Recipes and pitfalls](./10-recipes-and-pitfalls.md). Prompts to copy and mistakes to skip.

Read the pages in order the first time. After that, each page stands alone.

When you're stuck, or can't tell which skill fits, type [`/skill:orchestrator-help`](../../skills/orchestrator-help/SKILL.md) with your question:

```text
/skill:orchestrator-help which skill should i use to review this branch?
```

It answers, hands you a prompt to send, and links the skill or guide page the answer came from. It doesn't start the work, because an orchestrator run spends real tokens, so you send the prompt when you're ready. It runs only when you type it.

## If you only remember one thing

Give the agent a goal and a way to check it, in your own words:

```text
the export writes duplicate rows when a retry lands mid-run. repro first, then fix and verify.
```

You don't need to name a playbook or list skills. "repro first" and a checkable outcome are all the routing signal orchestrator needs. It matches the Bug fix playbook, copies the steps into the `todo` tool, and calls the right skills as each step fires.

Next: [Set up orchestrator](./01-setup.md).
