import { it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestSession, HERDR_BIN, integrationPrereqs } from "./harness.ts";

const prereqs = integrationPrereqs();

it("keeps the parent left and stacks parallel children on the right in real Herdr", {
  skip: !prereqs.ok ? prereqs.reason : false,
  timeout: 60_000,
}, async () => {
  const ts = await createTestSession();
  try {
    const parent = (await ts.client.paneList())[0];
    assert.ok(parent, "isolated session has a root pane");
    const layout = () => JSON.parse(execFileSync(HERDR_BIN,
      ["pane", "layout", "--pane", parent.pane_id],
      { env: ts.herdrEnv, encoding: "utf8" })).result.layout;
    const script = join(ts.tmpDir, "hold-layout.sh");
    writeFileSync(script, "#!/bin/sh\nexec sleep 120\n", { mode: 0o700 });
    const start = () => ts.client.paneStart({
      name: "layout-test", cwd: ts.tmpDir, targetPaneId: parent.pane_id,
      launchScriptFile: script,
    });
    const originalFocus = layout().focused_pane_id;
    const first = await start();
    const afterFirst = layout();
    const parentRect = afterFirst.panes.find((p: any) => p.pane_id === parent.pane_id).rect;
    const rest = await Promise.all([start(), start(), start()]);
    const final = layout();
    assert.deepEqual(final.panes.find((p: any) => p.pane_id === parent.pane_id).rect, parentRect);
    assert.equal(final.focused_pane_id, originalFocus);
    for (const child of [first, ...rest]) {
      const pane = final.panes.find((p: any) => p.pane_id === child.paneId);
      assert.ok(pane.rect.x >= parentRect.x + parentRect.width);
      assert.ok(pane.rect.width >= parentRect.width - 2);
      assert.ok(pane.rect.height > 5);
    }
    assert.equal(new Set(final.panes.filter((p: any) => p.pane_id !== parent.pane_id)
      .map((p: any) => p.rect.x)).size, 1, "children share a single right column");
    await ts.client.paneClose(first.paneId);
    await start();
    assert.deepEqual(layout().panes.find((p: any) => p.pane_id === parent.pane_id).rect, parentRect);
  } finally {
    await ts.teardown();
  }
});
