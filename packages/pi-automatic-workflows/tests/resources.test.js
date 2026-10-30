import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRINCIPLE_NAMES, WORKFLOWS, WORKFLOW_FILES } from "../lib/registry.js";

const root = path.resolve(process.env.PI_AUTOMATIC_WORKFLOWS_TEST_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

test("every non-lightweight workflow resolves to a trusted resource", () => {
  for (const route of Object.keys(WORKFLOWS)) {
    const resource = WORKFLOW_FILES[route];
    if (resource === null) continue;
    assert.ok(resource, `missing resource registration for ${route}`);
    const target = path.resolve(root, "workflows", `${resource}.md`);
    assert.ok(target.startsWith(path.resolve(root, "workflows") + path.sep));
    assert.ok(fs.statSync(target).isFile(), `missing workflow resource ${target}`);
  }
});

test("read-only and stop boundaries are present in their workflow guidance", () => {
  const plan = fs.readFileSync(path.join(root, "workflows/plan.md"), "utf8").toLowerCase();
  const investigation = fs.readFileSync(path.join(root, "workflows/investigation.md"), "utf8").toLowerCase();
  const review = fs.readFileSync(path.join(root, "workflows/review.md"), "utf8").toLowerCase();
  assert.match(plan, /stop/);
  assert.match(investigation, /read-only/);
  assert.match(review, /do not fix|without fixing|read-only/);
});

test("all 24 full principle resources exist", () => {
  assert.equal(PRINCIPLE_NAMES.length, 24);
  for (const name of PRINCIPLE_NAMES) assert.ok(fs.statSync(path.join(root, "principles", `${name}.md`)).isFile(), name);
});
