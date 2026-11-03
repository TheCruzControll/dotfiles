import { nativeFooter, type ContextReader } from "./footer.ts";
import { HStack } from "@earendil-works/pi-tui";
import { columns } from "./panel.ts";
import type { PanelRenderer } from "./panel.ts";
// Pi 1.4's layout-node symbol is not a public barrel export.
const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

export function attachFullscreen(host: any, marker: any, compose: (left: string[], right: string[], chat: number, side: number) => string[], renderPanel: PanelRenderer, readUsage?: ContextReader) {
  const root = host.layoutRoot;
  const node = root?.[NODE]?.();
  const dock = node?.entries?.[1]?.component;
  const dockNode = dock?.[NODE]?.();
  const above = host.children?.[3];
  const below = host.children?.[5];
  const footer = host.children?.[6];
  const native = nativeFooter(footer, readUsage);
  if (host.mode !== "fullscreen" || typeof host.setLayoutRoot !== "function" || host.children?.length !== 7 ||
      node?.type !== "vstack" || node.entries.length !== 2 ||
      node.entries[0].component?.[NODE]?.()?.type !== "scroll" ||
      dockNode?.type !== "vstack" || dockNode.entries.length !== 6 ||
      dockNode.entries[2].component !== above || dockNode.entries[4].component !== below ||
      !Array.isArray(below?.children) || dockNode.entries[5].component !== footer ||
      !above?.children?.includes(marker) || !native?.supported()) return;
  const originalBelow = below.render;
  const belowDescriptor = Object.getOwnPropertyDescriptor(below, "render");
  const originalFooter = footer.render;
  const footerDescriptor = Object.getOwnPropertyDescriptor(footer, "render");
  const original = above.render;
  const descriptor = Object.getOwnPropertyDescriptor(above, "render");
  let enabled = true;
  let disposed = false;
  let sideWidth = 0;
  let lines: string[] = [];
  const panel = {
    render(width: number) { return lines.map(line => "  " + line); },
    invalidate() {},
    // Consume pointer input without focus/capture; sidebar must not scroll chat.
    handleMouse() { return { handled: true, render: false }; },
  };
  const wrapper = new HStack([root, panel]);
  const active = () => !disposed && host.mode === "fullscreen" && host.layoutRoot === wrapper;
  const supported = () => host.children?.[3] === above && host.children?.[5] === below && host.children?.[6] === footer &&
    dockNode.entries[2].component === above && dockNode.entries[4].component === below && dockNode.entries[5].component === footer &&
    above.render === suppressed && below.render === suppressedBelow && footer.render === compactFooter &&
    native.supported() && above.children?.includes(marker);
  function prepare(width: number) {
    sideWidth = supported() ? columns(width, enabled).side : 0;
    lines = sideWidth ? renderPanel(sideWidth, host.terminal.rows, original.call(above, sideWidth - 4), native.details(), originalBelow.call(below, sideWidth - 4)) : [];
  }
  // Native layout allocates viewport height, ScrollView width, cursor and mouse boxes.
  (wrapper as any)[NODE] = () => ({ type: "hstack", gap: 0, align: "stretch", entries: [
    { component: root, basis: 0, grow: 1, shrink: 1, minSize: 1,
      visible: (viewport: { width: number }) => { prepare(viewport.width); return true; } },
    { component: panel, get basis() { return sideWidth + 2; }, shrink: 0,
      visible: () => sideWidth > 0 },
  ] });
  // TuiAltScreen also uses plain render() when leaving the alternate screen.
  wrapper.render = (width: number) => {
    prepare(width);
    const chat = sideWidth ? width - sideWidth - 2 : width;
    const left = root.render(chat);
    return sideWidth ? compose(left, lines, chat, sideWidth) : left;
  };
  const suppressed = function(width: number) { return active() && (sideWidth > 0 || !enabled) && supported() ? [] : original.call(above, width); };
  const suppressedBelow = (width: number) => active() && (sideWidth > 0 || !enabled) && supported() ? [] : originalBelow.call(below, width);
  const compactFooter = (width: number) => active() && supported()
    ? [...native.render(width), ...(enabled && sideWidth === 0 ? originalFooter.call(footer, width) : [])]
    : originalFooter.call(footer, width);
  footer.render = compactFooter;
  above.render = suppressed;
  below.render = suppressedBelow;
  host.setLayoutRoot(wrapper);
  return {
    toggle() { enabled = !enabled; host.invalidate(); host.requestRender(true); return enabled; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (above.render === suppressed) {
        if (descriptor) Object.defineProperty(above, "render", descriptor);
        else delete above.render;
      }
      if (below.render === suppressedBelow) {
        if (belowDescriptor) Object.defineProperty(below, "render", belowDescriptor);
        else delete below.render;
      }
      if (footer.render === compactFooter) {
        if (footerDescriptor) Object.defineProperty(footer, "render", footerDescriptor);
        else delete footer.render;
      }
      if (host.layoutRoot === wrapper) host.setLayoutRoot(root);
      host.invalidate(); host.requestRender(true);
    },
  };
}
