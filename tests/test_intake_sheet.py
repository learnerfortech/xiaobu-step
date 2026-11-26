"""Synthetic regression coverage for the LAN homework sheet."""
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lan-server'))
from intake import Intake, Invalid, mark_locations, organize_sources


class IntakeSheetTests(unittest.TestCase):
    def test_keep_subject_continuations_and_page_order(self):
        sources = [
            {'id': 'first', 'name': '测试来源一', 'kind': 'text', 'text': '语文：朗读第12页\n另：圈出生字。\n数学：P？第3题\n先估算；再计算。\n英语：读两遍。'},
            {'id': 'second', 'name': '测试来源二', 'kind': 'text', 'text': '数学：写出计算过程。\n科学：以下内容归属待确认。'},
        ]
        result = organize_sources(sources, {}, 'child_a', sheet=True)
        chinese, math, english = result['drafts']
        self.assertEqual(chinese['first_step'], '朗读第12页\n另：圈出生字。')
        self.assertEqual(math['first_step'], 'P？〔页码待核对〕第3题\n先估算； 再计算。\n写出计算过程。')
        self.assertEqual(math['source_ids'], ['first', 'second'])
        self.assertEqual(english['first_step'], '读两遍。')
        self.assertEqual(len(result['review']), 1)

    def test_mark_only_explicit_location_gaps(self):
        self.assertEqual(mark_locations('第8?页第?题？'), '第8?页〔页码待核对〕第?题〔题号待核对〕？')
        self.assertEqual(mark_locations('第23页第6题？'), '第23页第6题？')

    def test_publish_does_not_accept_visible_placeholders(self):
        with TemporaryDirectory() as root:
            parent = Path(root)
            intake = Intake(SimpleNamespace(db=parent/'tasks.sqlite3'), parent, validate_fields=lambda _: {})
            payload = {'confirmed': True, 'child_id': 'child_a', 'sheet': True, 'operation_id': 'case-one',
                       'review_resolved': True, 'sources': [],
                       'drafts': [{'day': '2026-01-23', 'subject': '数学', 'title': '练习题',
                                   'first_step': '第?题〔题号待核对〕', 'task_kind': 'paper',
                                   'home_group': '学校作业', 'photo_required': False}]}
            with self.assertRaisesRegex(Invalid, '补全'):
                intake.prepare(payload)
            payload['drafts'][0]['first_step'] = '第3题'
            self.assertTrue(intake.prepare(payload)[0]['intake_sheet'])


if __name__ == '__main__':
    unittest.main()
