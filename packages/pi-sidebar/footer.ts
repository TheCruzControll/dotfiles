import { stripVTControlCharacters } from "node:util";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { SUBAGENT_STATUS } from "./subagents.ts";

export type ContextReader = () => { tokens: number | null; percent: number | null } | undefined;

/** Guard the native footer, never replace/dispose another extension's footer. */
export function nativeFooter(container: any, readUsage: ContextReader = () => undefined) {
  const component = container?.children?.[0];
  if (container?.children?.length !== 1 || !component?.session?.state ||
      typeof component?.footerData?.getExtensionStatuses !== "function") return;
  const clean = (value: string) => stripVTControlCharacters(value).replace(/[\r\n\t]/g, " ");
  return {
    supported: () => container.children.length === 1 && container.children[0] === component,
    model() {
      const state = component.session.state;
      return clean(`${state.model?.id ?? "no-model"} · ${state.thinkingLevel ?? "off"}`);
    },
    details() {
      const state = component.session.state;
      const routed = component.session.routedModel;
      const statuses = Array.from(component.footerData.getExtensionStatuses().entries() as Iterable<[string, string]>)
        .sort(([a], [b]) => a.localeCompare(b));
      return {
        model: [state.model ? `${state.model.provider}/${state.model.id}` : "No model",
          ...(routed ? [`→ ${routed.model.provider}/${routed.model.id} · ${routed.thinkingLevel ?? "off"}`] : [])].map(clean),
        conductor: statuses.filter(([key]) => key === "automatic-workflows").map(([, text]) => clean(text)),
        activity: statuses.filter(([key]) => key !== "automatic-workflows").map(([, text]) => clean(text)),
      };
    },
    render(width: number) {
      const usage = readUsage();
      const tokens = usage?.tokens;
      const percent = usage?.percent;
      const count = tokens != null && Number.isFinite(tokens)
        ? tokens >= 1000 ? `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${tokens}` : "Tokens ?";
      const fraction = percent != null && Number.isFinite(percent) ? `${percent.toFixed(1).replace(/\.0$/, "")}%` : "Usage ?";
      const subagents = component.footerData.getExtensionStatuses().get(SUBAGENT_STATUS);
      const activity = subagents ? ` · ${clean(subagents)}` : "";
      return [truncateToWidth(`\x1b[90m${count} · ${fraction}${activity}  ${this.model()}\x1b[39m`, width, "")];
    },
  };
}
