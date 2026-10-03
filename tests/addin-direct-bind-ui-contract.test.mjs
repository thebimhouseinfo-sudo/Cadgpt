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
const connector = await fs.readFile(
  new URL(
    "../addins/cadgpt-autocad/Stage0/ChatConnectorScript.cs",
    import.meta.url
  ),
  "utf8"
);

const connectorAdapter = await fs.readFile(
  new URL(
    "../addins/cadgpt-autocad/Stage0/ChatConnectorAdapter.cs",
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

test("pairing automation is staged and never creates a new chat", () => {
  assert.match(
    connector,
    /COMPOSER_NOT_EMPTY/
  );
  assert.match(
    connector,
    /CG_CONNECTOR_NOT_FOUND/
  );
  assert.match(
    connector,
    /CG_CONNECTOR_AMBIGUOUS/
  );
  assert.doesNotMatch(
    connector,
    /new chat|new conversation/i
  );
  assert.doesNotMatch(
    connector,
    /document\.cookie|localStorage|sessionStorage|indexedDB|XMLHttpRequest|fetch\(/
  );
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


test("auto @cg uses browser-native input rather than synthetic React value mutation", () => {
  assert.match(
    connectorAdapter,
    /CallDevToolsProtocolMethodAsync\(\s*"Input\.insertText"/
  );
  assert.match(
    connectorAdapter,
    /CallDevToolsProtocolMethodAsync\(\s*"Input\.dispatchKeyEvent"/
  );
  assert.doesNotMatch(
    connectorAdapter,
    /setter\.call\(|dispatchEvent\(new InputEvent/
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
