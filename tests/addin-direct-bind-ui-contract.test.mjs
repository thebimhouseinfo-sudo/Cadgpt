import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const xaml = await fs.readFile(
  new URL(
    "../addins/cadgpt-autocad/ChatView.xaml",
    import.meta.url
  ),
  "utf8"
);
const code = await fs.readFile(
  new URL(
    "../addins/cadgpt-autocad/ChatView.xaml.cs",
    import.meta.url
  ),
  "utf8"
);
const serverFactory = await fs.readFile(
  new URL(
    "../src/cadgpt/server-factory.ts",
    import.meta.url
  ),
  "utf8"
);
const toolPolicy = await fs.readFile(
  new URL(
    "../src/cadgpt/lib/tool-policy.ts",
    import.meta.url
  ),
  "utf8"
);

test("panel has only toolbar plus WebView and no legacy footer/retry controls", () => {
  assert.equal(
    (xaml.match(/<RowDefinition/g) ?? []).length,
    2
  );
  assert.match(xaml, /Connect this drawing/);
  assert.match(xaml, />\s*Refresh\s*</);
  assert.match(xaml, />\s*Dark\s*</);
  assert.doesNotMatch(xaml, /RetryButton/);
  assert.doesNotMatch(xaml, /RecreateButton/);
  assert.doesNotMatch(xaml, /Stage 0 shell only/);
});

test("drawing connect goes through local control, not through a ChatGPT turn", () => {
  const start = code.indexOf(
    "private async void ConnectButton_Click"
  );
  const end = code.indexOf(
    "private static string? ActiveDrawingSelector",
    start
  );
  assert.ok(start >= 0 && end > start);

  const handler = code.slice(start, end);
  assert.match(handler, /ConnectDrawingAsync/);
  assert.doesNotMatch(handler, /InvokeCadGptAsync/);
  assert.doesNotMatch(
    handler,
    /connect drawing:|@cg/
  );
});

test("panel never auto-types or auto-sends @cg", async () => {
  assert.doesNotMatch(
    code,
    /InvokeCadGptAsync|CallDevToolsProtocolMethodAsync|Input\.insertText|Input\.dispatchKeyEvent/
  );
  assert.match(
    code,
    /CadGPT — invoke @cg to connect/
  );

  for (const relative of [
    "../addins/cadgpt-autocad/Stage0/ChatConnectorScript.cs",
    "../addins/cadgpt-autocad/Stage0/ChatConnectorAdapter.cs",
  ]) {
    await assert.rejects(
      fs.access(new URL(relative, import.meta.url))
    );
  }
});

test("panel pairing creates one reusable drawing workspace handle without adding an MCP connect command", () => {
  assert.match(
    serverFactory,
    /const addinPairingLaunch = hasPendingAddinPair\(\)/
  );
  assert.match(
    serverFactory,
    /ownerId: "drawing-workspace"/
  );
  assert.match(
    serverFactory,
    /work_handle:\s*\{[\s\S]*execution_id: work\.executionId/
  );
  assert.match(
    serverFactory,
    /replaceDrawingForExecution\(work\.executionId, selector\)/
  );
  assert.doesNotMatch(
    serverFactory,
    /cadgpt_connect_drawing/
  );
  assert.doesNotMatch(
    toolPolicy,
    /cadgpt_connect_drawing/
  );
});


test("add-in managed workspace keeps one work handle and tells the model to recheck binding", () => {
  assert.match(
    serverFactory,
    /addin_managed_workspace:\s*true/
  );
  assert.match(
    serverFactory,
    /AUTO-CAD ADD-IN MANAGED WORKSPACE/
  );
  assert.match(
    serverFactory,
    /call drawing_status with the current work_handle/
  );
  assert.match(
    serverFactory,
    /Do not call cg\/list, cadgpt_cad_confirm/
  );
});


test("paired panel auto-binds the active drawing and uses 90 percent WebView zoom", () => {
  assert.match(
    code,
    /Browser\.ZoomFactor\s*=\s*0\.90/
  );
  assert.match(
    code,
    /if \(await EnsurePairedAsync\([\s\S]*?TryInitialDrawingBindAsync/
  );
  assert.match(
    code,
    /ConnectDrawingSelectorAsync\([\s\S]*?ensurePair:\s*false/
  );
});

test("manual Connect this drawing shares the same hidden bind path and exposes failures", async () => {
  const client = await fs.readFile(
    new URL(
      "../addins/cadgpt-autocad/Stage0/AddinControlClient.cs",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    code,
    /ConnectDrawingSelectorAsync\([\s\S]*?ensurePair:\s*true/
  );
  assert.match(
    client,
    /\/addin-control\/drawing\/connect/
  );
  assert.match(
    client,
    /45000/
  );
  assert.match(
    client,
    /ADDIN_CONTROL_TIMEOUT/
  );
});
