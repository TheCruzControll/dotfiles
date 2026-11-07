import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "orchestrator");
const BEGIN = "<!-- orchestrator:begin -->";
const END = "<!-- orchestrator:end -->";
const DIR_LINE = "Orchestrator skill directory:";
// A prompt (or brief) that merely mentions the marker must not suppress injection.
const INJECTED = `${BEGIN}\n${DIR_LINE}`;
const STATE = "orchestrator-state";
// Without this header models read the block as reference text and skip it, or call small code tasks trivial.
const HEADER = `# Orchestrator mode is active
The orchestrator rules below govern how you handle every user message in this session. They take precedence over default habits. Before acting on a message, apply its Trivial prompts gate. Small is not trivial: any file edit, code change, or multi-step task is non-trivial. For anything non-trivial, follow its Non-negotiables first: restate the user's goal in your first message, match a playbook, and open a \`todo\` list whose first items are that playbook's steps, then work the steps, delegating through \`Agent\` where the playbook says to.
Show each orchestration decision with the \`orchestrator\` tool as directed by Flow markers below.
`;

// pi-subagents tags every child prompt with <active_agent name="..."/> (src/prompts.ts buildAgentPrompt);
// append-mode children inherit their parent's tags first, so the last tag names this session. None = main session.
function agentName(systemPrompt: string): string | undefined {
	return [...systemPrompt.matchAll(/<active_agent name="([^"]*)"\/>/g)].at(-1)?.[1];
}

function isEnabled(ctx: ExtensionContext): boolean {
	let on = true;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "custom" && entry.customType === STATE) on = (entry.data as { enabled: boolean }).enabled;
	}
	return on;
}

function block(): string {
	const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
	const modelsPath = join(getAgentDir(), "orchestrator-models.md");
	const models = existsSync(modelsPath)
		? `\n\n# Orchestrator model roles\n\n${readFileSync(modelsPath, "utf8").trim()}`
		: "";
	return [
		`\n\n${BEGIN}`,
		`${DIR_LINE} ${SKILL_DIR}; resolve relative links in it against that directory.\n`,
		HEADER,
		skill.trim() + models,
		END,
	].join("\n");
}

const Line = Type.String({ minLength: 1, maxLength: 240, pattern: "^(?=.*\\S)[^\\r\\n]+$" });
const Title = Type.String({ minLength: 1, pattern: "\\S" });
const Closed = { additionalProperties: false } as const;
const StepIdentity = { playbook: Line, step: Type.Integer({ minimum: 1 }), title: Title };
const EventSchema = Type.Union([
	Type.Object({ kind: Type.Literal("trivial") }, Closed),
	Type.Object({ kind: Type.Literal("principles") }, Closed),
	Type.Object({ kind: Type.Literal("playbook"), name: Line }, Closed),
	Type.Object({ kind: Type.Literal("skill"), name: Line }, Closed),
	Type.Object({ kind: Type.Literal("step"), ...StepIdentity, status: Type.Literal("started") }, Closed),
	Type.Object({ kind: Type.Literal("step"), ...StepIdentity, status: Type.Literal("completed") }, Closed),
	Type.Object({ kind: Type.Literal("step"), ...StepIdentity, status: Type.Literal("skipped"), reason: Line }, Closed),
	Type.Object({ kind: Type.Literal("step"), ...StepIdentity, status: Type.Literal("blocked"), reason: Line }, Closed),
	Type.Object({ kind: Type.Literal("verify"), status: Type.Literal("passed"), evidence: Line }, Closed),
	Type.Object({ kind: Type.Literal("verify"), status: Type.Literal("failed"), evidence: Line }, Closed),
	Type.Object({ kind: Type.Literal("verify"), status: Type.Literal("skipped"), reason: Line }, Closed),
]);
const ParamsSchema = Type.Object({ event: EventSchema }, Closed);
type FlowEvent = Static<typeof EventSchema>;
type Tone = "success" | "warning" | "muted" | "error";
// The call line reads `Orchestrator: <lead> <key><tail>` with only the key bold; the result line is `<status> · <note>`.
type Row = { lead: string; key: string; tail: string; status: string; note: string; tone: Tone };

const row = (lead: string, key: string, status: string, tone: Tone, note = "", tail = ""): Row => ({ lead, key, tail, status, note, tone });

function present(event: FlowEvent): Row {
	switch (event.kind) {
		case "trivial":
			return row("", "Trivial task", "✓ recorded", "success", "", ", skipping.");
		case "principles":
			return row("", "Reading principles", "✓ recorded", "success");
		case "playbook":
			return row("Playbook", event.name, "✓ matched", "success");
		case "skill":
			return event.name.startsWith("principle-")
				? row("Reading principle", event.name.slice("principle-".length).split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "), "✓ recorded", "success")
				: row("Opening skill", event.name, "✓ recorded", "success");
		case "step": {
			const lead = `${event.playbook} ${event.step}.`;
			switch (event.status) {
				case "started": return row(lead, event.title, "◐ started", "warning");
				case "completed": return row(lead, event.title, "● completed", "success");
				case "skipped": return row(lead, event.title, "⊘ skipped", "muted", event.reason);
				case "blocked": return row(lead, event.title, "◐ blocked", "warning", event.reason);
			}
		}
		case "verify": {
			const key = `Verification ${event.status}`;
			switch (event.status) {
				case "passed": return row("", key, "✓ passed", "success", event.evidence);
				case "failed": return row("", key, "✗ failed", "error", event.evidence);
				case "skipped": return row("", key, "⊘ skipped", "muted", event.reason);
			}
		}
	}
}

// Self-drawn so the row gets the accent-tinted message background instead of the shared tool background.
function shell(theme: { bg: (name: "customMessageBg" | "toolErrorBg", text: string) => string }, context: { outputPad: number; isError: boolean }, children: (Text | Spacer)[]): Box {
	const box = new Box(context.outputPad, 0, (text) => theme.bg(context.isError ? "toolErrorBg" : "customMessageBg", text));
	for (const child of children) box.addChild(child);
	return box;
}

function terminalLine(text: string): string {
	return text
		.replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, "")
		.replace(/(?:\u001b\]|\u009d)[^\u0007\u009c\u001b]*(?:\u0007|\u009c|\u001b\\)?/g, "")
		.replace(/\u001b./g, "")
		.replace(/[\r\n\t\u2028\u2029]+/g, " ")
		.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "orchestrator",
		label: "Orchestrator",
		description: "Record one orchestrator flow marker in the main session. This tool does not read skills, run steps, or verify outcomes.",
		parameters: ParamsSchema,
		renderShell: "self",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (agentName(ctx.getSystemPrompt()) !== undefined) throw new Error("Orchestrator markers are available only in the main session.");
			if (!isEnabled(ctx)) throw new Error("Orchestrator is disabled for this session.");
			let text = "Recorded. This marker does not perform or verify work.";
			if (params.event.kind === "playbook") text += " Copy every step of its playbook file into todo verbatim, then mark each step with a step marker.";
			if (params.event.kind === "verify" && params.event.status === "failed") text += " Fix the cause and verify again before reporting.";
			return { content: [{ type: "text", text }], details: { event: params.event } };
		},
		renderCall(args, theme, context) {
			let text = theme.fg("accent", "▌ ") + theme.fg("accent", theme.bold("Orchestrator:"));
			if (Check(ParamsSchema, args)) {
				const r = present(args.event);
				if (r.lead) text += " " + theme.fg("text", terminalLine(r.lead));
				text += " " + theme.fg("text", theme.bold(terminalLine(r.key))) + theme.fg("text", r.tail);
			}
			return shell(theme, context, [new Spacer(1), new Text(text, 0, 0)]);
		},
		renderResult(result, _options, theme, context) {
			const bar = theme.fg("accent", "▌ ");
			let text = bar + theme.fg("muted", "recorded");
			if (context.isError) {
				const message = result.content.find((item) => item.type === "text")?.text.split("\n")[0] ?? "";
				text = bar + theme.fg("error", `✗ ${terminalLine(message)}`);
			} else if (Check(ParamsSchema, result.details)) {
				const r = present(result.details.event);
				text = bar + theme.fg(r.tone, r.status) + (r.note ? theme.fg("text", ` · ${terminalLine(r.note)}`) : "");
			}
			return shell(theme, context, [new Text(text, 0, 0), new Spacer(1)]);
		},
	});
	// Files are read every turn so edits apply without /reload.
	pi.on("before_agent_start", (event, ctx) => {
		const name = agentName(event.systemPrompt);
		if (name !== undefined && name !== "orchestrator-agent") return;
		if (event.systemPrompt.includes(INJECTED) || !isEnabled(ctx)) return;
		return { systemPrompt: event.systemPrompt + block() };
	});

	pi.on("session_start", (_event, ctx) => {
		if (agentName(ctx.getSystemPrompt()) !== undefined) {
			pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "orchestrator"));
			return;
		}
		if (!pi.getAllTools().some((tool) => tool.name === "Agent")) {
			ctx.ui.notify("orchestrator: Agent tool missing — install npm:@tintinweb/pi-subagents@0.23.1", "warning");
		}
	});

	pi.registerCommand("orchestrator", {
		description: "Orchestrator rules for this session: on | off | status",
		handler: async (args, ctx) => {
			const arg = args.trim() || "status";
			if (arg !== "on" && arg !== "off" && arg !== "status") {
				ctx.ui.notify("Usage: /orchestrator on|off|status", "error");
				return;
			}
			if (arg !== "status") pi.appendEntry(STATE, { enabled: arg === "on" });
			const on = arg === "status" ? isEnabled(ctx) : arg === "on";
			ctx.ui.notify(`orchestrator: ${on ? "on" : "off"}`, "info");
		},
	});
}
