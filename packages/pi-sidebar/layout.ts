import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { nativeFooter, type ContextReader } from "./footer.ts";
import { attachFullscreen } from "./fullscreen.ts";
import { columns, defaultPanel, type PanelRenderer } from "./panel.ts";
export { columns } from "./panel.ts";

interface Component { render(width: number): string[]; invalidate(): void; children?: Component[] }
interface Host extends Component {
  mode?: string;
  terminal: { rows: number };
  layoutRoot?: Component;
  setLayoutRoot?(component: Component): void;
  requestRender(force?: boolean): void;
}
const RESET = "\x1b[0m\x1b]8;;\x07";

export function joinColumns(left: string[], right: string[], chat: number, side: number): string[] {
  const height = Math.max(left.length, right.length);
  const start = height - right.length;
  return Array.from({ length: height }, (_, i) => {
    const line = truncateToWidth(left[i] ?? "", chat, "");
    const other = truncateToWidth(right[i - start] ?? "", side, "");
    return line + RESET + " ".repeat(Math.max(0, chat - visibleWidth(line))) + "  " + other + RESET;
  });
}

/** Private Pi 1.4 regular-mode adapter; never reparents components or changes focus. */
export function attachSidebar(host: Host, marker: Component, panel: PanelRenderer = defaultPanel, readUsage?: ContextReader) {
  if (host.mode === "fullscreen") return attachFullscreen(host, marker, joinColumns, panel, readUsage);
  const above = host.children?.[3];
  const below = host.children?.[5];
  const footer = host.children?.[6];
  const native = nativeFooter(footer, readUsage);
  function supported() {
    return host.mode === "regular" && host.children?.length === 7 && host.children[3] === above &&
      host.children[5] === below && Array.isArray(below?.children) && host.children[6] === footer && Array.isArray(above?.children) && above.children.includes(marker) && !!native?.supported();
  }
  if (!supported() || !above || !below) return undefined;
  const own = Object.getOwnPropertyDescriptor(host, "render");
  const original = host.render;
  let enabled = true;
  let disposed = false;
  const wrapped = function(width: number): string[] {
    if (disposed || !supported()) return original.call(host, width);
    const size = columns(width, enabled);
    const widgets = size.side ? above.render(size.side - 4) : [];
    const belowWidgets = size.side ? below.render(size.side - 4) : [];
    const belowOwn = Object.getOwnPropertyDescriptor(below, "render");
    const aboveOwn = Object.getOwnPropertyDescriptor(above, "render");
    // Suppress only during this render: mode switches share the widget container.
    const footerOwn = Object.getOwnPropertyDescriptor(footer!, "render");
    const originalFooter = footer!.render;
    if (size.side || !enabled) {
      above.render = () => [];
      below.render = () => [];
    }
    footer!.render = width => [...native!.render(width), ...(enabled && !size.side ? originalFooter.call(footer, width) : [])];
    let left: string[];
    try { left = original.call(host, size.chat); }
    finally {
      if (aboveOwn) Object.defineProperty(above, "render", aboveOwn);
      else delete (above as Partial<Component>).render;
      if (belowOwn) Object.defineProperty(below, "render", belowOwn);
      else delete (below as Partial<Component>).render;
      if (footerOwn) Object.defineProperty(footer!, "render", footerOwn);
      else delete (footer as Partial<Component>).render;
    }
    if (!size.side) return left;
    const height = Math.max(1, Math.floor(host.terminal.rows));
    return joinColumns(left, panel(size.side, height, widgets, native!.details(), belowWidgets), size.chat, size.side);
  };
  host.render = wrapped;
  host.requestRender(true);
  return {
    toggle() { enabled = !enabled; host.invalidate(); host.requestRender(true); return enabled; },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Do not overwrite an adapter installed after ours.
      if (host.render === wrapped) {
        if (own) Object.defineProperty(host, "render", own);
        else delete (host as Partial<Component>).render;
      }
      host.invalidate(); host.requestRender(true);
    },
  };
}
