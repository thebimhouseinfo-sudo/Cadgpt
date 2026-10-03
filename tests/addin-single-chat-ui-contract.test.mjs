import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const xamlPath = new URL(
  "../addins/cadgpt-autocad/ChatView.xaml",
  import.meta.url
);
const codePath = new URL(
  "../addins/cadgpt-autocad/ChatView.xaml.cs",
  import.meta.url
);

test("CadGPT panel uses one-chat toolbar without bottom footer or retry/recreate buttons", async () => {
  const [xaml, code] = await Promise.all([
    fs.readFile(xamlPath, "utf8"),
    fs.readFile(codePath, "utf8"),
  ]);

  assert.match(xaml, /Connect this drawing/);
  assert.match(xaml, />\s*Refresh\s*</);
  assert.match(xaml, />\s*Dark\s*</);
  assert.doesNotMatch(xaml, /RetryButton/);
  assert.doesNotMatch(xaml, /RecreateButton/);
  assert.doesNotMatch(xaml, /Stage 0 shell only/);
  assert.equal(
    (xaml.match(/<RowDefinition/g) ?? []).length,
    2,
    "panel should contain only toolbar + WebView rows"
  );

  assert.match(code, /MdiActiveDocument/);
  assert.match(code, /"connect drawing: " \+ selector/);
  assert.match(code, /SendCadGptTurnAsync\(\s*string\.Empty/);
  assert.doesNotMatch(code, /NewChat|new chat|new conversation/i);
});

test("Refresh is the only panel recovery button while clean recreate stays internal", async () => {
  const [xaml, code] = await Promise.all([
    fs.readFile(xamlPath, "utf8"),
    fs.readFile(codePath, "utf8"),
  ]);

  assert.match(xaml, /x:Name="RefreshButton"/);
  assert.equal(
    (xaml.match(/Click="RefreshButton_Click"/g) ?? []).length,
    1
  );
  assert.match(code, /Browser\.Reload\(\)/);
  assert.match(code, /RequestCleanRecreate\(\)/);
});
