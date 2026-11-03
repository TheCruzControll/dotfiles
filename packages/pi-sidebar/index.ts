import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { attachSidebar } from "./layout.ts";
import { createPanel } from "./panel.ts";
import { conductorFields } from "./conductor.ts";
import { registerSubagentStatus } from "./subagents.ts";

const KEY = "local-right-sidebar-probe";
export default function sidebar(pi: ExtensionAPI) {
  registerSubagentStatus(pi);
  let controller: ReturnType<typeof attachSidebar>;
  let ui: ExtensionContext["ui"] | undefined;
  function cleanup() {
    controller?.dispose();
    controller = undefined;
    ui?.setWidget(KEY, undefined);
    ui = undefined;
  }
  pi.on("session_start", (_event, ctx) => {
    cleanup();
    if (ctx.mode !== "tui") return;
    ui = ctx.ui;
    let host: Parameters<typeof attachSidebar>[0] | undefined;
    const marker = { render: () => [] as string[], invalidate() {} };
    ctx.ui.setWidget(KEY, (tui) => { host = tui; return marker; });
    // setWidget installs the factory result synchronously before returning.
    if (host) controller = attachSidebar(host, marker, createPanel(() => {
      let spent: number | undefined;
      for (const entry of ctx.sessionManager?.getEntries?.() ?? []) {
        if (entry.type !== "message" || entry.message.role !== "assistant") continue;
        const cost = entry.message.usage?.cost?.total;
        if (typeof cost === "number" && Number.isFinite(cost)) spent = (spent ?? 0) + cost;
      }
      return { title: pi.getSessionName?.(), cwd: ctx.cwd, spent, theme: ctx.ui.theme,
        conductor: conductorFields(ctx.sessionManager?.getBranch?.() ?? [], ctx.cwd) };
    }), () => ctx.getContextUsage?.());
    controller?.toggle();
    if (!controller) {
      cleanup();
      ctx.ui.notify("Sidebar unavailable: unsupported Pi layout. Existing widgets unchanged.", "warning");
    }
  });
  pi.on("session_shutdown", cleanup);
  const toggle = (ctx: ExtensionContext) => {
    if (!controller) { ctx.ui.notify("Sidebar unavailable in this layout; try /reload in Pi 1.4.", "warning"); return; }
    const visible = controller.toggle();
    ctx.ui.notify(visible ? "Sidebar enabled (auto-hidden below 80 columns)" : "Sidebar hidden", "info");
  };
  pi.registerCommand("sidebar", { description: "Toggle the local right widget sidebar", handler: async (_args, ctx) => toggle(ctx) });
  pi.registerShortcut("ctrl+shift+b", { description: "Toggle right widget sidebar", handler: async (ctx) => toggle(ctx) });
}
