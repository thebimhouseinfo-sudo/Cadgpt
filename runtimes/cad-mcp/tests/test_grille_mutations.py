"""Real-service regression tests using a deterministic fake AutoCAD COM host."""
from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.block_service import get_block, list_blocks
from services.entity_service import list_entities, _find_entity
from services.grille_service import (
    GrilleServiceError, update_grille_attributes, delete_grille_tags,
)


class FakeSpace:
    ObjectID = 100


class FakeAttr:
    def __init__(self, tag, value, fail_update=False):
        self.TagString = tag
        self.TextString = value
        self.fail_update = fail_update
        self.update_calls = 0

    def Update(self):
        self.update_calls += 1
        if self.fail_update:
            self.fail_update = False
            # COM failure after the TextString write went through.
            raise RuntimeError("RPC disconnected after attribute update")


class FakeBlock:
    ObjectName = "AcDbBlockReference"

    def __init__(self, host, handle, layer, name, attrs=None, owner=100):
        self.host = host
        self.Handle = handle
        self.OwnerID = owner
        self.Layer = layer
        self.Name = name
        self.attrs = attrs or []
        self.delete_calls = 0
        self.fail_after_delete = False

    def GetAttributes(self):
        return self.attrs

    def Delete(self):
        self.delete_calls += 1
        self.host.entities.pop(self.Handle, None)
        if self.fail_after_delete:
            self.fail_after_delete = False
            raise RuntimeError("COM lost connection after delete")


class FakeDoc:
    Name = "Bound-Test.dwg"

    def __init__(self):
        self.entities = {}
        self.ModelSpace = FakeSpace()
        self.Layouts = []
        self.lookup_count = 0

    def HandleToObject(self, handle):
        self.lookup_count += 1
        if handle not in self.entities:
            raise ValueError("No entity")
        return self.entities[handle]


class GrilleToolsTests(unittest.TestCase):
    def setUp(self):
        self.doc = FakeDoc()
        self.grille = FakeBlock(self.doc, "A10", "Hvac-SAGrille", "SAG-450", [
            FakeAttr("TAG_NUMBER", "FCU-1-S1"),
            FakeAttr("AIR_FLOW", "300"),
            FakeAttr("SIZE", "450x450"),
        ])
        self.tag = FakeBlock(self.doc, "B10", "Hvac-GrilleTag", "GR-SA-123", [
            FakeAttr("TAG_NUMBER", "FCU-1-S1"),
        ])
        self.doc.entities = {"A10": self.grille, "B10": self.tag}
        self.p1 = patch("services.handle_service.get_active_document", return_value=self.doc)
        self.p2 = patch("services.entity_service._doc", return_value=self.doc)
        self.p3 = patch("services.block_service._doc", return_value=self.doc)
        self.p1.start()
        self.p2.start()
        self.p3.start()
        self.addCleanup(self.p1.stop)
        self.addCleanup(self.p2.stop)
        self.addCleanup(self.p3.stop)

    def test_update_multiple_atts_in_one_handle_lookup_then_idempotent_retry(self):
        first = update_grille_attributes("a10", {"AIR_FLOW": "400", "SIZE": "500x500"},
                                          {"AIR_FLOW": "300", "SIZE": "450x450"})
        self.assertTrue(first["verified"])
        self.assertEqual(first["changed_count"], 2)
        again = update_grille_attributes("A10", {"AIR_FLOW": "400", "SIZE": "500x500"},
                                          {"AIR_FLOW": "300", "SIZE": "450x450"})
        self.assertTrue(again["verified"])
        self.assertEqual(again["changed_count"], 0)
        self.assertEqual(again["already_correct_count"], 2)
        self.assertEqual([a.TextString for a in self.grille.attrs], ["FCU-1-S1", "400", "500x500"])
        self.assertLessEqual(self.doc.lookup_count, 3)

    def test_write_succeeds_then_com_update_reports_error_but_readback_confirms(self):
        self.grille.attrs[1].fail_update = True
        result = update_grille_attributes("A10", {"AIR_FLOW": "555"})
        self.assertTrue(result["verified"])
        self.assertEqual(result["after"]["AIR_FLOW"], "555")
        self.assertEqual(result["errors"], [])

    def test_compare_and_swap_conflict_prevents_any_mutation(self):
        with self.assertRaisesRegex(GrilleServiceError, "ATT_CONFLICT"):
            update_grille_attributes("A10", {"AIR_FLOW": "400", "SIZE": "600"},
                                      {"AIR_FLOW": "200"})
        self.assertEqual(self.grille.attrs[1].TextString, "300")
        self.assertEqual(self.grille.attrs[2].TextString, "450x450")

    def test_reject_unknown_tag_and_wrong_grille_layer(self):
        with self.assertRaisesRegex(GrilleServiceError, "missing ATT"):
            update_grille_attributes("A10", {"OTHER": "anything"})
        with self.assertRaisesRegex(GrilleServiceError, "grille layer"):
            update_grille_attributes("B10", {"TAG_NUMBER": "FORBIDDEN"})

    def test_delete_requires_confirmation_and_all_targets_preflight(self):
        with self.assertRaisesRegex(GrilleServiceError, "confirmed=true"):
            delete_grille_tags(["B10"])
        with self.assertRaisesRegex(GrilleServiceError, "DELETE_BLOCKED"):
            delete_grille_tags(["B10", "A10"], confirmed=True)
        self.assertIn("B10", self.doc.entities)
        self.assertEqual(self.tag.delete_calls, 0)

    def test_delete_idempotent_after_response_lost_after_real_deletion(self):
        self.tag.fail_after_delete = True
        result = delete_grille_tags(["B10"], confirmed=True, expected_tag_numbers={"B10": "FCU-1-S1"})
        self.assertTrue(result["verified"])
        self.assertEqual(result["deleted_count"], 1)
        self.assertEqual(result["errors"], [])
        self.assertEqual(self.tag.delete_calls, 1)
        again = delete_grille_tags(["b10"], confirmed=True, expected_tag_numbers={"B10": "FCU-1-S1"})
        self.assertTrue(again["verified"])
        self.assertEqual(again["already_absent_count"], 1)
        self.assertEqual(self.tag.delete_calls, 1)

    def test_tag_number_guard_prevents_deleting_changed_tag(self):
        with self.assertRaisesRegex(GrilleServiceError, "DELETE_CONFLICT"):
            delete_grille_tags(["B10"], confirmed=True, expected_tag_numbers={"B10": "FCU-99-S9"})
        self.assertEqual(self.tag.delete_calls, 0)

    def test_nested_entities_are_not_mutated(self):
        nested = FakeBlock(self.doc, "C10", "Hvac-GrilleTag", "GR-RA-1", owner=900)
        self.doc.entities["C10"] = nested
        outcome = delete_grille_tags(["C10"], confirmed=True)
        self.assertEqual(outcome["already_absent_count"], 1)
        self.assertEqual(nested.delete_calls, 0)

    def test_ambiguous_com_error_never_reports_grille_tag_already_deleted(self):
        import pywintypes
        failure = pywintypes.com_error(-2147352567, "Exception occurred.", None, None)
        with patch.object(self.doc, "HandleToObject", side_effect=failure):
            with self.assertRaisesRegex(Exception, "reliably"):
                delete_grille_tags(["B10"], confirmed=True)
        self.assertEqual(self.tag.delete_calls, 0)

    def test_get_block_and_entity_filter_use_direct_handle_lookup(self):
        block = get_block("A10")
        self.assertEqual(block["handle"], "A10")
        self.assertEqual(block["attributes"][1]["value"], "300")
        block_list = list_blocks({"handle": "A10", "layer": "Hvac-SAGrille"})
        self.assertEqual(len(block_list), 1)
        result = list_entities({"handle": "B10", "types": ["block"]})
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["handle"], "B10")
        doc, space, entity = _find_entity("A10")
        self.assertEqual(space, "ModelSpace")
        self.assertIs(entity, self.grille)
        self.assertLessEqual(self.doc.lookup_count, 5)


if __name__ == "__main__":
    unittest.main()
