import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const SUBAGENT_STATUS = "sidebar-subagents";

/** Read upstream's authoritative fleet only when it changes, never from render or a timer. */
export function registerSubagentStatus(pi: ExtensionAPI) {
  let ui: ExtensionContext["ui"] | undefined;
  let unsubscribe: (() => void) | undefined;
  const clear = () => {
    unsubscribe?.();
    unsubscribe = undefined;
    ui?.setStatus(SUBAGENT_STATUS, undefined);
    ui = undefined;
  };
  const refresh = () => {
    if (!ui) return;
    unsubscribe?.();
    const requestId = `sidebar-${randomUUID()}`;
    unsubscribe = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (reply: any) => {
      unsubscribe?.();
      unsubscribe = undefined;
      const count = reply?.data?.fleet?.totalActive;
      const valid = reply?.version === 1 && reply.success === true && reply.data?.fleet?.version === 1 && Number.isSafeInteger(count) && count >= 0;
      ui?.setStatus(SUBAGENT_STATUS, valid ? `subagents ${count} active` : undefined);
    });
    pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method: "status" });
  };
  pi.events.on("subagent:jobs-changed", refresh);
  pi.events.on("subagents:rpc:v1:ready", refresh);
  pi.on("session_start", (_event, ctx) => {
    clear();
    if (ctx.mode !== "tui") return;
    ui = ctx.ui;
    queueMicrotask(refresh);
  });
  pi.on("session_tree", refresh);
  pi.on("session_shutdown", clear);
}
