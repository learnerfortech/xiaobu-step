"""Preserve existing precise teacher deadlines through date-only parent edits."""
import copy
import datetime
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lan-server'))
import task_planning as planning


class TeacherDeadlineTests(unittest.TestCase):
    def setUp(self):
        self.task = {'day': '2026-11-14', 'planned_day': '2026-11-14',
                     'due_day': '2026-11-14', 'status': 'todo',
                     'plan': {'deadline': '2026-11-14T23:30:00+00:00'}}

    def test_precise_timestamp_uses_the_family_timezone_date(self):
        self.assertEqual(planning.teacher_due_day(self.task), '2026-11-15')
        self.task['planned_day'] = '2026-11-15'
        self.assertIsNone(planning.planning_warning(self.task))
        self.task['planned_day'] = '2026-11-16'
        self.assertEqual(planning.planning_warning(self.task), 'planned_after_due')

    def test_rescheduling_preserves_the_original_deadline_and_payload(self):
        before = copy.deepcopy(self.task)
        changes = planning.metadata({'planned_day': '2026-11-16'}, self.task)
        self.assertEqual(changes, {'planned_day': '2026-11-16'})
        self.assertEqual(self.task, before)

    def test_date_editor_cannot_override_or_clear_a_precise_deadline(self):
        for day in (None, '2026-11-16'):
            with self.subTest(day=day), self.assertRaises(planning.PlanningError) as error:
                planning.metadata({'due_day': day}, self.task)
            self.assertEqual(error.exception.error, 'exact_deadline_preserved')
            self.assertEqual(error.exception.code, 409)

    def test_legacy_unchanged_date_is_compatible_and_explicit_alignment_is_allowed(self):
        self.assertEqual(planning.metadata({'due_day': '2026-11-14'}, self.task),
                         {'due_day': '2026-11-14'})
        self.assertEqual(planning.metadata({'due_day': '2026-11-15'}, self.task),
                         {'due_day': '2026-11-15'})

    def test_older_timestamp_separators_keep_their_precise_time(self):
        for separator in ('T', 't', ' '):
            with self.subTest(separator=separator):
                raw = '2026-11-14' + separator + '18:30:00+08:00'
                task = dict(self.task, plan={'deadline': raw})
                self.assertEqual(planning.teacher_due_day(task), '2026-11-14')
                self.assertEqual(planning.exact_deadline(task).hour, 18)
                with self.assertRaises(planning.PlanningError):
                    planning.metadata({'due_day': '2026-11-15'}, task)
                self.assertEqual(task['plan']['deadline'], raw)

    def test_date_only_and_unknown_deadlines_do_not_acquire_a_time(self):
        for raw in ('2026-11-15', '2026-11-15T18:00:00', 'unrecognized', None):
            with self.subTest(raw=raw):
                task = dict(self.task, plan={'deadline': raw}, due_day=None)
                self.assertIsNone(planning.exact_deadline(task))
                self.assertIsNone(planning.teacher_due_day(task))
                self.assertFalse(planning.deadline_passed(task))

    def test_exact_time_is_not_treated_as_expired_at_the_start_of_its_day(self):
        zone = datetime.timezone(datetime.timedelta(hours=8))
        self.assertFalse(planning.deadline_passed(self.task, datetime.datetime(2026, 11, 15, 7, 29, tzinfo=zone)))
        self.assertTrue(planning.deadline_passed(self.task, datetime.datetime(2026, 11, 15, 7, 31, tzinfo=zone)))


if __name__ == '__main__':
    unittest.main()
