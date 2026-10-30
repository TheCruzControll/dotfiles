const LIFECYCLE = "workflow:child-lifecycle";

/** Branch membership establishes ownership; runtime IDs alone do not. */
export function hasOwnedChildren(branch: readonly any[]): boolean {
	const children = new Map<string, boolean>();
	for (const entry of branch) {
		if (entry?.type !== "custom" || entry.customType !== LIFECYCLE) continue;
		const record = entry.data;
		if (!record || record.version !== 1 ||
			 typeof record.id !== "string" || !record.id ||
			 typeof record.sessionFile !== "string" || !record.sessionFile ||
			 (record.paneId !== undefined && typeof record.paneId !== "string")) continue;
		const key = JSON.stringify([record.id, record.sessionFile, record.paneId ?? null]);
		// A delayed/replayed observation cannot undo positive exit evidence.
		if (children.get(key) === false) continue;
		children.set(key, record.status !== "completed" && record.status !== "failed");
	}
	return [...children.values()].some(Boolean);
}
