import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Python CAD MCP: simulate managed Job Lisp load, sentinel timeout, late queue, and rejection", () => {
  const simulation = String.raw`
import os, sys, re, types, tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.getcwd(), "runtimes", "cad-mcp"))
sys.modules["pywintypes"] = types.SimpleNamespace(com_error=Exception)
connection = types.ModuleType("connection")
connection.__path__ = []
acad = types.ModuleType("connection.acad")
acad.get_active_document = lambda: None
sys.modules["connection"] = connection
sys.modules["connection.acad"] = acad

from services import lisp_service as s

class FakeDocument:
    def __init__(self, reject_pending=False):
        self.values = {"USERS5": "previous", "LOGFILEMODE": 0, "LOGFILENAME": ""}
        self.reject_pending = reject_pending
    def GetVariable(self, name):
        return self.values[name]
    def SetVariable(self, name, value):
        if self.reject_pending and name == "USERS5" and str(value).startswith("CADGPT_PENDING:"):
            raise ValueError("read-only sentinel")
        self.values[name] = value

with tempfile.TemporaryDirectory(prefix="cadgpt-lisp-simulation-") as tmp:
    os.environ["CADGPT_APPDATA_ROOT"] = tmp
    helper = Path(tmp) / "libraries" / "jobs" / "fixture" / "grille-tag" / "lisp" / "collector.lsp"
    helper.parent.mkdir(parents=True)
    helper.write_text("(princ)\n", encoding="utf-8")
    resolved, virtual = s._resolve_lisp_path(str(helper))
    assert resolved == os.path.realpath(str(helper))
    assert virtual.replace("\\", "/").endswith("/lisp/collector.lsp")

    expr = s._verified_load_expression(str(helper), "abc123")
    assert expr.startswith('(if (= (getvar "USERS5") "CADGPT_PENDING:abc123") (progn ')
    assert expr.endswith("(princ)))")

    # Simulate SendCommand enqueued but AutoCAD has not consumed it in time.
    doc = FakeDocument()
    queued = []
    with patch.object(s, "_send", side_effect=lambda code, document=None: queued.append(code)), \
         patch.object(s, "_LOAD_TIMEOUT_SECONDS", 0), \
         patch.object(s.time, "sleep", side_effect=lambda _: None):
        result = s.load_lisp_file(str(helper), doc)
    assert result["loaded"] is False and "timeout" in result["error"].lower()
    assert doc.values["USERS5"] == "previous"
    assert len(queued) == 1
    # A deferred AutoCAD evaluation now sees restored USERS5, so the guard skips load.
    assert '(if (= (getvar "USERS5") "CADGPT_PENDING:' in queued[0]

    # Simulate successful sentinel acknowledgement without real CAD.
    doc2 = FakeDocument()
    def acknowledge(code, document=None):
        token = re.search(r"CADGPT_OK:([0-9a-f]+)", code).group(1)
        document.SetVariable("USERS5", "CADGPT_OK:" + token)
    with patch.object(s, "_send", side_effect=acknowledge), \
         patch.object(s.time, "sleep", side_effect=lambda _: None):
        success = s.load_lisp_file(str(helper), doc2)
    assert success["loaded"] is True
    assert doc2.values["USERS5"] == "previous"

    # A denied sentinel must not enqueue any load at all.
    doc3 = FakeDocument(reject_pending=True)
    queued_denied = []
    with patch.object(s, "_send", side_effect=lambda code, document=None: queued_denied.append(code)):
        try:
            s.load_lisp_file(str(helper), doc3)
            assert False, "Expected sentinel rejection"
        except s.LispServiceError as exc:
            assert "CADGPT_LISP_SENTINEL_UNAVAILABLE" in str(exc)
    assert not queued_denied

    # Strict path scope remains unchanged: outside Job/AppData is denied.
    unrelated = Path(tmp).parent / ("cadgpt-outside-" + helper.parent.name + ".lsp")
    try:
        unrelated.write_text("(princ)", encoding="utf-8")
        try:
            s._resolve_lisp_path(str(unrelated))
            assert False, "Outside AppData incorrectly accepted"
        except s.LispServiceError:
            pass
    finally:
        unrelated.unlink(missing_ok=True)
print("CAD MCP Lisp bridge simulation PASS")
`;
  const run = spawnSync("python", ["-c", simulation], {
    cwd: root, encoding: "utf8", timeout: 20000
  });
  assert.equal(run.status, 0, [run.error?.message, run.stdout, run.stderr].filter(Boolean).join("\n"));
  assert.match(run.stdout, /simulation PASS/);
});
