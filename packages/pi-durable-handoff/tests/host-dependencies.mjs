// Opt-in host dependency resolution; no installs or repository links required.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
const host = process.env.PI_CODING_AGENT_DIR;
if (!host) throw new Error("Set PI_CODING_AGENT_DIR to the installed Pi package directory");
const parentURL = pathToFileURL(`${host}/package.json`).href;
registerHooks({ resolve(specifier, context, nextResolve) {
 if (specifier.startsWith("@earendil-works/") || specifier === "typebox") {
  return nextResolve(specifier, { ...context, parentURL });
 }
 return nextResolve(specifier, context);
} });
