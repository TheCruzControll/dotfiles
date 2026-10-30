import { canonicalProjectPath } from "./workflow-evidence.ts";

export const OBSERVER_BUILD_WORKSPACE_LABEL = "Workflow builds";

export function resolveBuildProjectPath(projectPath) {
  return canonicalProjectPath(projectPath);
}

export function findDedicatedBuildWorkspace(workspaces, label = OBSERVER_BUILD_WORKSPACE_LABEL) {
  const matches = (workspaces ?? []).filter((workspace) => workspace?.label === label && workspace?.workspace_id);
  if (matches.length === 0) {
    return undefined;
  }

  return matches.sort((left, right) => {
    if (Boolean(left.focused) !== Boolean(right.focused)) {
      return left.focused ? -1 : 1;
    }

    return Number(right.number ?? 0) - Number(left.number ?? 0);
  })[0];
}
