import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
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
type Row = { glyph: string; title: string; result: string; tone: "success" | "warning" | "muted" | "error" };

function present(event: FlowEvent): Row {
	switch (event.kind) {
		case "trivial":
			return { glyph: "∅", title: "Trivial task, skipping.", result: "✓ recorded", tone: "success" };
		case "principles":
			return { glyph: "›", title: "Reading principles", result: "✓ recorded", tone: "success" };
		case "playbook":
			return { glyph: "→", title: `Playbook: ${event.name}`, result: "✓ matched", tone: "success" };
		case "skill": {
			const title = event.name.startsWith("principle-")
				? `Reading principle ${event.name.slice("principle-".length).split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}`
				: `Opening skill ${event.name}`;
			return { glyph: "›", title, result: "✓ recorded", tone: "success" };
		}
		case "step": {
			const title = `${event.playbook} ${event.step}. ${event.title}`;
			switch (event.status) {
				case "started": return { glyph: "→", title, result: "◐ started", tone: "warning" };
				case "completed": return { glyph: "→", title, result: "● completed", tone: "success" };
				case "skipped": return { glyph: "→", title, result: `⊘ skipped · ${event.reason}`, tone: "muted" };
				case "blocked": return { glyph: "→", title, result: `◐ blocked · ${event.reason}`, tone: "warning" };
			}
		}
		case "verify": {
			const title = `Verification ${event.status}`;
			switch (event.status) {
				case "passed": return { glyph: "›", title, result: `✓ passed · ${event.evidence}`, tone: "success" };
				case "failed": return { glyph: "›", title, result: `✗ failed · ${event.evidence}`, tone: "error" };
				case "skipped": return { glyph: "›", title, result: `⊘ skipped · ${event.reason}`, tone: "muted" };
			}
		}
	}
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
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (agentName(ctx.getSystemPrompt()) !== undefined) throw new Error("Orchestrator markers are available only in the main session.");
			if (!isEnabled(ctx)) throw new Error("Orchestrator is disabled for this session.");
			let text = "Recorded. This marker does not perform or verify work.";
			if (params.event.kind === "playbook") text += " Copy every step of its playbook file into todo verbatim, then mark each step with a step marker.";
			if (params.event.kind === "verify" && params.event.status === "failed") text += " Fix the cause and verify again before reporting.";
			return { content: [{ type: "text", text }], details: { event: params.event } };
		},
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("Orchestrator "));
			if (Check(ParamsSchema, args)) {
				const row = present(args.event);
				text += theme.fg("muted", row.glyph) + " " + theme.fg("dim", terminalLine(row.title));
			}
			return new Text(text, 0, 0);
		},
		renderResult(result, _options, theme, context) {
			if (context.isError) {
				const message = result.content.find((item) => item.type === "text")?.text.split("\n")[0] ?? "";
				return new Text(theme.fg("error", `✗ ${terminalLine(message)}`), 0, 0);
			}
			if (Check(ParamsSchema, result.details)) {
				const row = present(result.details.event);
				return new Text(theme.fg(row.tone, terminalLine(row.result)), 0, 0);
			}
			return new Text(theme.fg("muted", "recorded"), 0, 0);
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
