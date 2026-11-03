import { stripVTControlCharacters } from "node:util";
import { basename } from "node:path";
import { homedir } from "node:os";
import type { ConductorField } from "./conductor.ts";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export function columns(width: number, enabled: boolean) {
  const side = width < 100 ? 26 : Math.max(34, Math.min(46, Math.floor(width * 0.23)));
  return enabled && width >= 80 ? { chat: width - side - 2, side } : { chat: width, side: 0 };
}

export interface PanelDetails { model: string[]; conductor?: string[]; activity: string[] }
export type PanelRenderer = (width: number, height: number, widgets: string[], details?: PanelDetails, belowWidgets?: string[]) => string[];

/** Remove framing, not the goal/task content inside it. */
export function normalizeWidgets(lines: string[]): string[] {
  const result: string[] = [];
  for (const raw of lines) {
    let line = stripVTControlCharacters(raw).trim();
    if (/^[\s─━═┌┐└┘├┤┬┴┼╭╮╰╯│┃║+\-=]{3,}$/.test(line)) continue;
    line = line.replace(/^[│┃║]\s?/, "").replace(/\s?[│┃║]$/, "").trim();
    // Box headings often live in their top rule (╭── Goal ──╮).
    line = line.replace(/^[┌╭├└╰][─━═]+\s*/, "").replace(/\s*[─━═]+[┐╮┤┘╯]$/, "");
    line = line.replace(/^pi-goal-x\s*[─━—-]*\s*/i, "Goal · ");
    if (/^(?:(?:ctrl|shift|alt)[+ -]|press\s)/i.test(line) && /(?:toggle|expand|collapse|details|hide|show)/i.test(line)) continue;
    if (!line && (!result.length || !result.at(-1))) continue;
    if (/^todos?\b/i.test(line) && result.length && result.at(-1)) result.push("");
    result.push(line);
  }
  while (result.at(-1) === "") result.pop();
  return result;
}

export function createPanel(read: () => { title?: string; cwd?: string; spent?: number; theme?: any; conductor?: ConductorField[] }): PanelRenderer {
  return (width, height, widgets, details: PanelDetails = { model: [], activity: [] }, belowWidgets = []) => {
    const state = read();
    const theme = state.theme;
    const fg = (text: string, heading = false) => heading
      ? (theme?.bold?.(theme?.fg?.("text", text) ?? text) ?? `\x1b[1m${text}\x1b[22m`)
      : (theme?.fg?.("muted", text) ?? `\x1b[90m${text}\x1b[39m`);
    const bg = "\x1b[48;2;25;27;32m";
    const clean = (s: string) => stripVTControlCharacters(s).replace(/[\r\n\t]/g, " ");
    const cwd = clean(state.cwd ?? "");
    const home = homedir();
    const path = cwd === home ? "~" : cwd.startsWith(home + "/") ? "~" + cwd.slice(home.length) : cwd;
    const content = ["", fg(clean(state.title || basename(cwd) || "Pi"), true)];
    const headings = new Set<string>();
    const heading = (label: string) => { const styled = fg(label, true); headings.add(styled); return styled; };
    const section = (label: string, lines: string[], preserve = false) => {
      if (!lines.some(line => stripVTControlCharacters(line).trim())) return;
      content.push("", heading(label), ...lines.flatMap(line => wrapTextWithAnsi(preserve ? line : clean(line), Math.max(1, width - 4)).map(part => preserve ? part : fg(part))));
    };
    if (state.spent != null && Number.isFinite(state.spent)) section("Cost", [`$${state.spent.toFixed(2)} spent`]);
    section("Model", details.model);
    const conductor = details.conductor?.some(line => clean(line).trim()) &&
      !details.conductor.some(line => clean(line).trim() === "Conductor:off") ? state.conductor ?? [] : [];
    let conductorClipped = false;
    if (conductor.length) {
      content.push("", heading("Conductor"));
      for (const field of conductor) {
        const lines = field.lines.flatMap(line => wrapTextWithAnsi(clean(line), Math.max(1, width - 4)));
        if (!lines.length) continue;
        const clipped = lines.length > 3;
        conductorClipped ||= clipped;
        content.push(...(field === conductor[0] ? [] : [""]), heading(field.label), ...lines.slice(0, 3).map((line, index) => fg(clipped && index === 2
          ? truncateToWidth(line, Math.max(0, width - 5), "") + "…" : line)));
      }
      if (conductorClipped) content.push(fg("… /conductor status"));
    } else section("Conductor", details.conductor ?? []);
    // Below-editor text retains idle labels and shortcut hints, without normalization.
    section("Activity", [...details.activity.map(line => fg(clean(line))), ...belowWidgets], true);
    const normalized = normalizeWidgets(widgets);
    if (normalized.length) {
      const labeled = normalized.some(line => /^(?:goals?|tasks?|todos?)\b/i.test(line));
      content.push("", ...(labeled ? [] : [heading("Tasks")]), ...normalized.flatMap(line => wrapTextWithAnsi(line, Math.max(1, width - 4)).map(part => /^(?:goals?|tasks?|todos?)\b/i.test(line) ? heading(part) : fg(part))));
    }
    const count = Math.max(1, Math.floor(height));
    const bottom = path && count >= 2 ? [heading("Workspace"), fg(path)] : [fg(path)];
    const capacity = Math.max(0, count - bottom.length);
    const body = content.slice(0, capacity);
    if (content.length > capacity && capacity) {
      body.pop();
      while (body.length && (!body.at(-1) || headings.has(body.at(-1)!))) body.pop();
      body.push(fg(conductor.length ? "… /conductor status" : "… more in /goal or /todos"));
    }
    while (body.length < capacity) body.push("");
    body.push(...bottom);
    return body.map(line => {
      const text = truncateToWidth(line, Math.max(0, width - 4), "");
      // Foreground styling may reset all attributes: restore the surface after every reset.
      const padded = "  " + text + " ".repeat(Math.max(0, width - 2 - visibleWidth(text)));
      return bg + padded.replace(/\x1b\[(?:0)?m/g, match => match + bg) + "\x1b[0m";
    });
  };
}

export const defaultPanel = createPanel(() => ({}));
