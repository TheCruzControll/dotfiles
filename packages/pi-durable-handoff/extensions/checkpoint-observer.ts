import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const CHECKPOINT_ENTRY_TYPE = "observer-checkpoint";
const STATUS_KEY = "observer-progress";
const WIDGET_KEY = "observer-progress";
const STATUS_COMMAND = "observer-status";
const MAX_SUMMARY_LENGTH = 140;

const DECISION_PATTERNS = [
	/\b(do you want|would you like|should i|which option|which approach|which one|pick one|choose one|confirm whether)\b/i,
	/\b(need|requires?)\b.{0,40}\b(decision|approval|confirmation|input|direction)\b/i,
];

const BLOCKER_PATTERNS = [
	/\b(blocked|blocking|cannot proceed|can't proceed|unable to continue|waiting on|need access|missing access)\b/i,
	/\b(requires?)\b.{0,40}\b(approval|permission|credentials|access|decision)\b/i,
];

type TaskStatus = "pending" | "in_progress" | "completed" | "deleted" | string;
type CheckpointKind = "idle" | "progress" | "decision" | "blocked" | "complete";

interface TodoTask {
	id: number;
	subject: string;
	status: TaskStatus;
	activeForm?: string;
	blockedBy?: number[];
	owner?: string;
}

interface CheckpointCounts {
	pending: number;
	inProgress: number;
	completed: number;
	blocked: number;
	deleted: number;
}

interface CheckpointEntry {
	version: 1;
	kind: CheckpointKind;
	summary: string;
	activeTask?: string;
	counts: CheckpointCounts;
	timestamp: number;
	settledEntryId?: string;
}

interface SessionState {
	tasks: TodoTask[];
	running: boolean;
	dirty: boolean;
	lastCheckpoint?: CheckpointEntry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asText(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clampSummary(text: string): string {
	const compact = text.replace(/\s+/g, " ").trim();
	return compact.length <= MAX_SUMMARY_LENGTH ? compact : `${compact.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…`;
}

function getSessionKey(ctx: ExtensionContext): string {
	return ctx.sessionManager.getSessionFile() ?? ctx.sessionManager.getSessionId() ?? "ephemeral";
}

function getLeafEntryId(ctx: ExtensionContext): string | undefined {
	return ctx.sessionManager.getLeafEntry()?.id;
}

function extractMessageText(message: AgentMessage | undefined): string {
	if (!message || !("content" in message)) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((item): item is { type: string; text?: string } => isRecord(item) && typeof item.type === "string")
		.map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
		.join("\n")
		.trim();
}

function normalizeTask(raw: unknown): TodoTask | undefined {
	if (!isRecord(raw)) return undefined;
	const id = typeof raw.id === "number" ? raw.id : Number(raw.id);
	const subject = asText(raw.subject) ?? asText(raw.text) ?? asText(raw.title);
	const status = asText(raw.status);
	if (!Number.isFinite(id) || !subject || !status) return undefined;
	const blockedBy = Array.isArray(raw.blockedBy)
		? raw.blockedBy.map((value) => Number(value)).filter((value) => Number.isFinite(value))
		: undefined;
	return {
		id,
		subject,
		status,
		activeForm: asText(raw.activeForm),
		blockedBy,
		owner: asText(raw.owner),
	};
}

function extractTasks(payload: unknown): TodoTask[] | undefined {
	if (Array.isArray(payload)) {
		const tasks = payload.map(normalizeTask).filter((task): task is TodoTask => task !== undefined);
		return tasks.length ? tasks : undefined;
	}
	if (!isRecord(payload)) return undefined;
	if (Array.isArray(payload.tasks)) {
		const tasks = payload.tasks.map(normalizeTask).filter((task): task is TodoTask => task !== undefined);
		return tasks.length || payload.tasks.length === 0 ? tasks : undefined;
	}
	return undefined;
}

function extractSingleTask(payload: unknown): TodoTask | undefined {
	if (!isRecord(payload)) return undefined;
	return normalizeTask(payload.task ?? payload.item ?? payload);
}

function upsertTask(tasks: TodoTask[], task: TodoTask): TodoTask[] {
	const next = [...tasks];
	const index = next.findIndex((item) => item.id === task.id);
	if (index >= 0) {
		next[index] = task;
	} else {
		next.push(task);
	}
	return next.sort((a, b) => a.id - b.id);
}

function applyTodoPayload(tasks: TodoTask[], payload: unknown, input?: Record<string, unknown>): TodoTask[] {
	const action = asText(isRecord(payload) ? payload.action : undefined) ?? asText(input?.action);
	if (action === "clear") return [];

	const listedTasks = extractTasks(payload);
	if (listedTasks) return listedTasks;

	const task = extractSingleTask(payload);
	if (!task) return tasks;

	if (task.status === "deleted") {
		return upsertTask(tasks, task);
	}
	return upsertTask(tasks, task);
}

function calculateCounts(tasks: TodoTask[]): CheckpointCounts {
	const counts: CheckpointCounts = { pending: 0, inProgress: 0, completed: 0, blocked: 0, deleted: 0 };
	for (const task of tasks) {
		if (task.status === "completed") counts.completed += 1;
		else if (task.status === "in_progress") counts.inProgress += 1;
		else if (task.status === "deleted") counts.deleted += 1;
		else counts.pending += 1;
		if (task.status === "pending" && (task.blockedBy?.length ?? 0) > 0) counts.blocked += 1;
	}
	return counts;
}

function describeCounts(counts: CheckpointCounts): string {
	const parts: string[] = [];
	if (counts.inProgress) parts.push(`${counts.inProgress} active`);
	if (counts.pending) parts.push(`${counts.pending} pending`);
	if (counts.completed) parts.push(`${counts.completed} done`);
	if (counts.blocked) parts.push(`${counts.blocked} blocked`);
	return parts.join(" · ") || "no tracked tasks";
}

function findActiveTask(tasks: TodoTask[]): TodoTask | undefined {
	return tasks.find((task) => task.status === "in_progress") ?? tasks.find((task) => task.status === "pending");
}

function findSignalLine(text: string, patterns: RegExp[]): string | undefined {
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		if (patterns.some((pattern) => pattern.test(line))) return clampSummary(line);
	}
	const compact = clampSummary(text);
	return patterns.some((pattern) => pattern.test(compact)) ? compact : undefined;
}

function determineCheckpoint(tasks: TodoTask[], assistantText: string, settledEntryId?: string): CheckpointEntry {
	const counts = calculateCounts(tasks);
	const allTasksComplete = tasks.length > 0 && counts.pending === 0 && counts.inProgress === 0;
	const blockerLine = findSignalLine(assistantText, BLOCKER_PATTERNS);
	const decisionLine = allTasksComplete ? undefined : findSignalLine(assistantText, DECISION_PATTERNS);
	const activeTask = findActiveTask(tasks);
	const activeLabel = activeTask ? activeTask.activeForm ?? activeTask.subject : undefined;

	let kind: CheckpointKind = "idle";
	let summary = "No tracked work yet.";

	if (blockerLine || counts.blocked > 0) {
		kind = "blocked";
		summary = blockerLine ?? `Work is waiting on ${counts.blocked} blocked task${counts.blocked === 1 ? "" : "s"}.`;
	} else if (allTasksComplete) {
		kind = "complete";
		summary = `All tracked tasks are complete (${counts.completed} done).`;
	} else if (decisionLine) {
		kind = "decision";
		summary = decisionLine;
	} else if (activeLabel) {
		kind = "progress";
		summary = `Working on ${activeLabel}.`;
	} else if (counts.pending > 0) {
		kind = "progress";
		summary = `${counts.pending} task${counts.pending === 1 ? "" : "s"} remaining.`;
	}

	return {
		version: 1,
		kind,
		summary: clampSummary(summary),
		activeTask: activeLabel,
		counts,
		timestamp: Date.now(),
		settledEntryId,
	};
}

function formatTimestamp(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderStatus(theme: ExtensionContext["ui"]["theme"], state: SessionState, checkpoint: CheckpointEntry): string | undefined {
	if (checkpoint.kind === "blocked") {
		return theme.fg("error", "ckp!");
	}
	if (checkpoint.kind === "decision") {
		return theme.fg("warning", "ckp?");
	}
	if (state.running) {
		return theme.fg("accent", "ckp…");
	}
	if (checkpoint.kind === "progress") {
		return theme.fg("muted", "ckp");
	}
	return undefined;
}

function buildWidgetLines(theme: ExtensionContext["ui"]["theme"], checkpoint: CheckpointEntry): string[] | undefined {
	if (checkpoint.kind !== "blocked" && checkpoint.kind !== "decision") {
		return undefined;
	}
	const countsText = describeCounts(checkpoint.counts);
	const header = theme.fg("accent", "Observer checkpoints");
	const stateLine = `${theme.fg("muted", "Status:")} ${checkpoint.kind}`;
	const tasksLine = `${theme.fg("muted", "Tasks:")} ${countsText}`;
	const summaryLine = `${theme.fg("muted", "Latest:")} ${checkpoint.summary}`;
	const timeLine = `${theme.fg("muted", "Settled:")} ${formatTimestamp(checkpoint.timestamp)}`;
	return [header, stateLine, tasksLine, summaryLine, timeLine];
}

function updateUi(ctx: ExtensionContext, state: SessionState): void {
	if (!ctx.hasUI) return;
	const theme = ctx.ui.theme;
	const liveCheckpoint = state.lastCheckpoint ?? determineCheckpoint(state.tasks, "", getLeafEntryId(ctx));
	ctx.ui.setStatus(STATUS_KEY, renderStatus(theme, state, liveCheckpoint));
	const widgetLines = buildWidgetLines(theme, liveCheckpoint);
	ctx.ui.setWidget(WIDGET_KEY, widgetLines, widgetLines ? { placement: "belowEditor" } : undefined);
}

function reconstructState(ctx: ExtensionContext): SessionState {
	const state: SessionState = { tasks: [], running: false, dirty: false };
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "custom" && entry.customType === CHECKPOINT_ENTRY_TYPE && isRecord(entry.data)) {
			const data = entry.data;
			if (
				data.version === 1 &&
				typeof data.summary === "string" &&
				typeof data.kind === "string" &&
				isRecord(data.counts) &&
				typeof data.timestamp === "number"
			) {
				state.lastCheckpoint = {
					version: 1,
					kind: data.kind as CheckpointKind,
					summary: data.summary,
					activeTask: asText(data.activeTask),
					counts: {
						pending: Number(data.counts.pending) || 0,
						inProgress: Number(data.counts.inProgress) || 0,
						completed: Number(data.counts.completed) || 0,
						blocked: Number(data.counts.blocked) || 0,
						deleted: Number(data.counts.deleted) || 0,
					},
					timestamp: data.timestamp,
					settledEntryId: asText(data.settledEntryId),
				};
			}
			continue;
		}

		if (entry.type !== "message") continue;
		const message = entry.message as AgentMessage & {
			toolName?: string;
			details?: unknown;
			structuredContent?: unknown;
			input?: Record<string, unknown>;
		};
		if (message.role !== "toolResult" || message.toolName !== "todo") continue;
		state.tasks = applyTodoPayload(state.tasks, message.details ?? message.structuredContent, message.input);
	}
	return state;
}

function getLastAssistantText(ctx: ExtensionContext): string {
	for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
		if (entry.type !== "message") continue;
		if (entry.message.role !== "assistant") continue;
		return extractMessageText(entry.message);
	}
	return "";
}

export default function checkpointObserver(pi: ExtensionAPI) {
	const stateBySession = new Map<string, SessionState>();

	function loadState(ctx: ExtensionContext): SessionState {
		const sessionKey = getSessionKey(ctx);
		const state = reconstructState(ctx);
		stateBySession.set(sessionKey, state);
		updateUi(ctx, state);
		return state;
	}

	function getState(ctx: ExtensionContext): SessionState {
		const sessionKey = getSessionKey(ctx);
		const existing = stateBySession.get(sessionKey);
		if (existing) return existing;
		return loadState(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		loadState(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		loadState(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		const state = getState(ctx);
		state.running = true;
		updateUi(ctx, state);
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "todo") return;
		const state = getState(ctx);
		state.tasks = applyTodoPayload(state.tasks, event.details ?? event.structuredContent, event.input);
		state.dirty = true;
		updateUi(ctx, state);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const state = getState(ctx);
		state.running = false;

		const settledEntryId = getLeafEntryId(ctx);
		const assistantText = getLastAssistantText(ctx);
		const checkpoint = determineCheckpoint(state.tasks, assistantText, settledEntryId);
		const changed =
			state.dirty ||
			!state.lastCheckpoint ||
			state.lastCheckpoint.settledEntryId !== checkpoint.settledEntryId ||
			state.lastCheckpoint.kind !== checkpoint.kind ||
			state.lastCheckpoint.summary !== checkpoint.summary ||
			JSON.stringify(state.lastCheckpoint.counts) !== JSON.stringify(checkpoint.counts);

		if (changed) {
			pi.appendEntry<CheckpointEntry>(CHECKPOINT_ENTRY_TYPE, checkpoint);
			state.lastCheckpoint = checkpoint;
			state.dirty = false;
		}

		updateUi(ctx, state);

		if (checkpoint.kind === "blocked") {
			ctx.ui.notify(`Checkpoint: blocked — ${checkpoint.summary}`, "warning");
		} else if (checkpoint.kind === "decision") {
			ctx.ui.notify(`Checkpoint: decision needed — ${checkpoint.summary}`, "info");
		}
	});

	pi.registerCommand(STATUS_COMMAND, {
		description: "Show the latest settled progress checkpoint",
		handler: async (_args, ctx) => {
			const state = getState(ctx);
			const checkpoint = state.lastCheckpoint ?? determineCheckpoint(state.tasks, getLastAssistantText(ctx), getLeafEntryId(ctx));
			const lines = [
				`Status: ${checkpoint.kind}`,
				`Tasks: ${describeCounts(checkpoint.counts)}`,
				`Latest: ${checkpoint.summary}`,
				`Settled: ${formatTimestamp(checkpoint.timestamp)}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
