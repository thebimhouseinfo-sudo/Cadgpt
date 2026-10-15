"""Pure-Python regression checks for the existing AutoCAD Lisp result bridge.

No AutoCAD installation required. A real bound-drawing smoke test is separate.
"""
import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.modules.setdefault("pywintypes", types.SimpleNamespace(com_error=RuntimeError))
sys.modules.setdefault("config", types.SimpleNamespace(get_cadgpt_appdata_root=lambda: "/tmp/cadgpt"))
sys.modules.setdefault("connection", types.ModuleType("connection"))
sys.modules.setdefault("connection.acad", types.SimpleNamespace(get_active_document=lambda: None))
spec = importlib.util.spec_from_file_location(
    "cadgpt_test_lisp_service", ROOT / "runtimes/cad-mcp/services/lisp_service.py"
)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class FakeDocument:
    def __init__(self, final="", fail_read=False):
        self.vars = {"USERS5": "", "LOGFILEMODE": 0, "LOGFILENAME": ""}
        self.final = final
        self.fail_read = fail_read

    def GetVariable(self, key):
        if self.fail_read and key == "USERS5":
            raise RuntimeError("real COM read failure")
        if key == "USERS5" and self.final and self.vars[key].startswith("CADGPT_PENDING:"):
            token = self.vars[key].split(":", 1)[1]
            return self.final.replace("{token}", token)
        return self.vars[key]

    def SetVariable(self, key, value):
        self.vars[key] = value


class LispResultTests(unittest.TestCase):
    def test_real_success_without_wall_clock_limit(self):
        doc = FakeDocument(final="CADGPT_OK:{token}")
        with patch.object(bridge, "_resolve_lisp_path", return_value=("/safe/a.lsp", "resources/cad/a.lsp")), \
             patch.object(bridge, "_send"), patch.object(bridge.time, "sleep"):
            result = bridge.load_lisp_file("resources/cad/a.lsp", document=doc)
        self.assertTrue(result["loaded"])
        self.assertIsNone(result["error"])
        self.assertEqual(doc.vars["USERS5"], "")

    def test_real_autolisp_error_not_a_timeout(self):
        doc = FakeDocument(final="CADGPT_ERR:{token}:bad source")
        with patch.object(bridge, "_resolve_lisp_path", return_value=("/safe/a.lsp", "resources/cad/a.lsp")), \
             patch.object(bridge, "_send"), patch.object(bridge.time, "sleep"):
            result = bridge.load_lisp_file("resources/cad/a.lsp", document=doc)
        self.assertFalse(result["loaded"])
        self.assertEqual(result["error"], "bad source")

    def test_unreadable_result_is_real_tool_error(self):
        doc = FakeDocument(fail_read=True)
        with patch.object(bridge.time, "sleep"):
            with self.assertRaisesRegex(bridge.LispServiceError, "RESULT_READ_FAILED"):
                bridge._await_lisp_result(doc, "pending", "ok", "err")

    def test_changed_pending_signal_is_error_not_fake_success(self):
        doc = FakeDocument()
        with patch.object(bridge.time, "sleep"):
            with self.assertRaisesRegex(bridge.LispServiceError, "SENTINEL_CHANGED"):
                bridge._await_lisp_result(doc, "pending", "ok", "err")

    def test_missing_lisp_source_is_reported_without_queueing(self):
        with self.assertRaisesRegex(bridge.LispServiceError, "file was not found"):
            bridge._resolve_lisp_path("resources/cad/not-an-existing-cadgpt-test-file.lsp")


if __name__ == "__main__":
    unittest.main()
