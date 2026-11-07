import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

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

export default function (pi: ExtensionAPI) {
	// Files are read every turn so edits apply without /reload.
	pi.on("before_agent_start", (event, ctx) => {
		const name = agentName(event.systemPrompt);
		if (name !== undefined && name !== "orchestrator-agent") return;
		if (event.systemPrompt.includes(INJECTED) || !isEnabled(ctx)) return;
		return { systemPrompt: event.systemPrompt + block() };
	});

	pi.on("session_start", (_event, ctx) => {
		if (agentName(ctx.getSystemPrompt()) !== undefined) return;
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
