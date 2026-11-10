import json
import sqlite3
import unittest

from tools.assignment_bundles import BundleError, import_assignments, organize_sources


def entry(key="demo-1"):
    return {
        "key": key,
        "subject": "Math",
        "title": "Practice addition",
        "instructions": "Add 2 and 3.",
    }


class OrganizationTests(unittest.TestCase):
    def test_explicit_labels_preserve_order_and_provenance(self):
        result = organize_sources(
            {
                "source-a": "Unlabeled\nM：Add 2 and 3.\nCheck the result.\nOther: Read the text.",
                "source-b": "New source\nMath: Add 1 and 4.",
            },
            {"M": "Math", "Math": "Math"},
        )
        self.assertEqual(
            result["drafts"],
            [{
                "subject": "Math",
                "instructions": "Add 2 and 3.\nCheck the result.\nAdd 1 and 4.",
                "source_ids": ["source-a", "source-b"],
            }],
        )
        self.assertEqual(
            [line["text"] for line in result["review"]],
            ["Unlabeled", "Other: Read the text.", "New source"],
        )

    def test_invalid_source_text_has_a_validation_error(self):
        with self.assertRaises(BundleError):
            organize_sources({"source-a": None}, {"M": "Math"})


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)

    def test_preview_does_not_create_a_table(self):
        self.assertEqual(import_assignments(self.db, [entry()]), {"insert": ["demo-1"], "skip": []})
        self.assertEqual(self.db.execute("SELECT name FROM sqlite_master").fetchall(), [])

    def test_retry_skips_identical_entries_and_keeps_material_pairs(self):
        item = entry()
        item["materials"] = [{
            "name": "Exercise",
            "audio_required": True,
            "items": [
                {"kind": "document", "reference": "sheet-1"},
                {"kind": "audio", "reference": "clip-1"},
            ],
        }]
        self.assertEqual(import_assignments(self.db, [item], apply=True)["insert"], ["demo-1"])
        self.assertEqual(import_assignments(self.db, [item], apply=True)["skip"], ["demo-1"])
        payload, = self.db.execute("SELECT payload FROM assignment_bundle_items").fetchone()
        self.assertEqual(json.loads(payload)["materials"], item["materials"])

    def test_audio_in_another_group_does_not_satisfy_requirement(self):
        item = entry()
        item["materials"] = [
            {"name": "Required", "audio_required": True},
            {"name": "Other", "items": [{"kind": "audio", "reference": "clip-1"}]},
        ]
        with self.assertRaises(BundleError):
            import_assignments(self.db, [item], apply=True)
        self.assertEqual(self.db.execute("SELECT name FROM sqlite_master").fetchall(), [])

    def test_material_references_are_opaque(self):
        item = entry()
        item["materials"] = [{"name": "Exercise", "items": [{"kind": "document", "reference": "../file"}]}]
        with self.assertRaises(BundleError):
            import_assignments(self.db, [item])

    def test_conflict_never_partially_imports(self):
        import_assignments(self.db, [entry()], apply=True)
        conflicting = dict(entry(), title="Changed")
        with self.assertRaises(BundleError):
            import_assignments(self.db, [entry("demo-2"), conflicting], apply=True)
        self.assertEqual(self.db.execute("SELECT item_key FROM assignment_bundle_items").fetchall(), [("demo-1",)])

    def test_database_failure_rolls_back_prior_inserts(self):
        import_assignments(self.db, [entry()], apply=True)
        self.db.execute("""
            CREATE TRIGGER fail_last BEFORE INSERT ON assignment_bundle_items
            WHEN NEW.item_key = 'demo-3'
            BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END
        """)
        with self.assertRaises(sqlite3.IntegrityError):
            import_assignments(self.db, [entry("demo-2"), entry("demo-3")], apply=True)
        self.assertEqual(self.db.execute("SELECT item_key FROM assignment_bundle_items").fetchall(), [("demo-1",)])
