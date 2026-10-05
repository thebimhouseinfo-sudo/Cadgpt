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
const palette = await fs.readFile(
  new URL(
    "../addins/cadgpt-autocad/PaletteController.cs",
    import.meta.url
  ),
  "utf8"
);
const client = await fs.readFile(
  new URL(
    "../addins/cadgpt-autocad/Stage0/AddinControlClient.cs",
    import.meta.url
  ),
  "utf8"
);
const commands = await fs.readFile(
  new URL(
    "../addins/cadgpt-autocad/Commands.cs",
    import.meta.url
  ),
  "utf8"
);
const entryPoint = await fs.readFile(
  new URL(
    "../addins/cadgpt-autocad/EntryPoint.cs",
    import.meta.url
  ),
  "utf8"
);
const packageManifest = await fs.readFile(
  new URL(
    "../addins/cadgpt-autocad/bundle/PackageContents.xml",
    import.meta.url
  ),
  "utf8"
);
const buildScript = await fs.readFile(
  new URL(
    "../scripts/build-autocad-addin.ps1",
    import.meta.url
  ),
  "utf8"
);
const installScript = await fs.readFile(
  new URL(
    "../scripts/install-autocad-addin.ps1",
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
const indexSource = await fs.readFile(
  new URL(
    "../src/index.ts",
    import.meta.url
  ),
  "utf8"
);

test("CADGPT panel keeps one header, one background Job ticker row and the browser", () => {
  assert.equal(
    (xaml.match(/<RowDefinition/g) ?? []).length,
    3
  );
  assert.match(
    xaml,
    /x:Name="BoundDrawingText"/
  );
  assert.match(
    xaml,
    /x:Name="ThemeButton"/
  );
  assert.match(
    xaml,
    /x:Name="JobTickerBorder"/
  );
  assert.match(
    xaml,
    /x:Name="JobTickerText"/
  );
  assert.doesNotMatch(
    xaml,
    /ConnectButton|RefreshButton|RetryButton|RecreateButton/
  );
  assert.doesNotMatch(
    xaml,
    /Connect this drawing|Refresh|Retry/
  );
});


test("background Job status is a single-row ticker and only successful polls update it", () => {
  assert.match(
    client,
    /DataMember\(Name = "background_jobs"\)/
  );
  assert.match(
    code,
    /RefreshBackgroundJobs\(\s*status\.BackgroundJobs\s*\)/
  );
  assert.match(
    code,
    /" — Processing"/
  );
  assert.match(
    code,
    /" — Done"/
  );
  assert.match(
    code,
    /RepeatBehavior\.Forever/
  );
  assert.match(
    code,
    /labels\.Count > 1/
  );
  assert.doesNotMatch(
    code,
    /catch \(AddinControlException\)[\s\S]{0,500}RefreshBackgroundJobs/
  );
});

test("panel title and visual tab are CadGPT", () => {
  assert.match(
    palette,
    /new PaletteSet\("CadGPT"/
  );
  assert.match(
    palette,
    /AddVisual\("CadGPT"/
  );
});

test("panel is observation-only and exposes no drawing connect action", () => {
  assert.doesNotMatch(
    code,
    /ConnectDrawingAsync|ConnectButton_Click|RefreshButton_Click/
  );
  assert.doesNotMatch(
    client,
    /drawing\/connect|ConnectDrawingAsync/
  );
  assert.doesNotMatch(
    indexSource,
    /addin-control\/drawing\/connect/
  );
  assert.match(
    indexSource,
    /addin-control\/binding\/:pairId/
  );
});

test("normal CadGPT browser binding flow is preserved", () => {
  assert.doesNotMatch(
    serverFactory,
    /hasPendingAddinPair|addin_managed_workspace|replaceDrawingForExecution/
  );
  assert.match(
    serverFactory,
    /prepareCadLaunch\(sessionKey,\s*\{\s*autoBindSingle:\s*true/
  );
  assert.match(
    serverFactory,
    /registerAddinSessionObserver/
  );
  assert.match(
    serverFactory,
    /getBoundDrawingsForExecution/
  );
});

test("Human Power header derives directly from work state and does not keep a bridge flag", () => {
  assert.match(
    serverFactory,
    /human_power:\s*Boolean\(work\.humanPower\)/
  );
  assert.match(
    client,
    /DataMember\(Name = "human_power"\)/
  );
  assert.match(
    code,
    /status\.SessionReady\s*&&\s*status\.HumanPower/
  );
  assert.match(
    code,
    /"HUMAN POWER ON"/
  );
  assert.match(
    code,
    /Color\.FromRgb\(\s*34, 211, 238\)/
  );
  assert.doesNotMatch(
    code,
    /_humanPower|_human_power|humanPowerMode/
  );
});

test("header is a drawing-context indicator with debounced local-state warnings", () => {
  assert.match(
    code,
    /DispatcherTimer/
  );
  assert.match(
    code,
    /GetBindingStatusAsync/
  );
  assert.match(
    code,
    /_lastConfirmedBoundDrawing/
  );
  assert.match(
    code,
    /if \(status\.SessionReady\)[\s\S]*SetConfirmedBoundDrawing\(\s*status\.Drawing\s*\)/
  );
  assert.match(
    code,
    /TryDrawingSnapshot\(/
  );
  assert.match(
    code,
    /_boundMissingPolls\s*>=\s*3/
  );
  assert.match(
    code,
    /_bindingMismatchPolls\s*>=\s*2/
  );
  assert.match(
    code,
    /UNKNOWN local AutoCAD state/
  );
  assert.match(
    code,
    /DrawingIdentityMatcher\.NormalizePath/
  );
  assert.match(
    code,
    /Color\.FromRgb\(\s*250, 204, 21\)/
  );
  assert.match(
    code,
    /Color\.FromRgb\(\s*245, 158, 11\)/
  );
  assert.match(
    code,
    /Header has no timeout semantics/
  );
  assert.doesNotMatch(
    code,
    /catch \(AddinControlException\)[\s\S]{0,600}_lastConfirmedBoundDrawing\s*=\s*null/
  );
  assert.match(
    code,
    /BoundDrawingText\.Text/
  );
});


test("panel self-recovers WebView lifecycle without restarting AutoCAD", () => {
  assert.match(
    code,
    /CoreWebView2\.ProcessFailed/
  );
  assert.match(
    code,
    /RecoverAfterSuspensionAsync/
  );
  assert.match(
    code,
    /TimeSpan\.FromSeconds\(15\)/
  );
  assert.match(
    code,
    /Browser\.CoreWebView2\.Reload\(\)/
  );
  assert.match(
    code,
    /PaletteController\.Recreate\(\)/
  );
  assert.match(
    palette,
    /PreservePairForRecreate\(\)/
  );
});

test("panel releases its pair only on real disposal, not recovery recreation", () => {
  assert.match(
    client,
    /ReleasePairAsync/
  );
  assert.match(
    code,
    /_preservePairOnDispose/
  );
  assert.match(
    code,
    /ReleasePairAsync/
  );
  assert.match(
    palette,
    /_view\?\.PreservePairForRecreate\(\)/
  );
});

test("add-in control async requests are cancellation-bound across sleep", () => {
  assert.match(
    client,
    /CreateLinkedTokenSource/
  );
  assert.match(
    client,
    /CancelAfter\(\s*TimeSpan\.FromSeconds\(5\)\s*\)/
  );
  assert.match(
    client,
    /request\.Abort\(\)/
  );
});

test("panel keeps 90 percent ChatGPT zoom and no auto CadGPT input automation", () => {
  assert.match(
    code,
    /Browser\.ZoomFactor\s*=\s*0\.90/
  );
  assert.doesNotMatch(
    code,
    /InvokeCadGptAsync|CallDevToolsProtocolMethodAsync|Input\.insertText|Input\.dispatchKeyEvent/
  );
});

test("binding status remains read-only and never exposes work authority", () => {
  assert.match(
    client,
    /GetBindingStatusAsync/
  );
  assert.doesNotMatch(
    client,
    /authority_token|execution_id/
  );
  assert.doesNotMatch(
    indexSource,
    /drawing_selector/
  );
});

test("CADGPT command opens the CadGPT panel and legacy Stage 0 commands are gone", () => {
  assert.match(
    commands,
    /CommandMethod\("CADGPT",\s*CommandFlags\.Session\)/
  );
  assert.match(
    commands,
    /PaletteController\.Show\(\)/
  );
  assert.doesNotMatch(
    commands,
    /CGSTAGE0|CGSTAGE0RECREATE/
  );
  assert.match(
    entryPoint,
    /ExtensionApplication\(typeof\(CadGpt\.AutoCad\.EntryPoint\)\)/
  );
});

test("production bundle autoloads at AutoCAD startup", () => {
  assert.match(packageManifest, /Name="CadGPT"/);
  assert.match(packageManifest, /AppName="CadGPT"/);
  assert.match(packageManifest, /LoadOnAutoCADStartup="True"/);
  assert.match(buildScript, /bin\\bundle\\CadGPT\.bundle/);
});

test("installer deploys CadGPT.bundle into Autodesk ApplicationPlugins", () => {
  assert.match(installScript, /Autodesk\\ApplicationPlugins/);
  assert.match(installScript, /CadGPT\.bundle/);
  assert.match(installScript, /LoadOnAutoCADStartup="True"/);
  assert.match(installScript, /Command : CADGPT/);
});

test("production CadGPT palette never reuses the Stage 0 palette GUID", () => {
  assert.doesNotMatch(
    palette,
    /34F319C7-C59A-46A4-83A1-33B1B919BEE6/
  );
  assert.match(
    palette,
    /new PaletteSet\("CadGPT", PaletteId\)/
  );
});

test("panel startup is not pinned to a persisted ChatGPT conversation", () => {
  assert.match(
    code,
    /Browser\.CoreWebView2\.Navigate\(\s*WebViewProfile\.StartupUrl\s*\)/
  );
  assert.doesNotMatch(
    code,
    /ReadLastConversationUrl|TrySaveConversationUrl/
  );
});
