import datetime
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'lan-server'))
import task_planning as p

class WeeklyWindowTests(unittest.TestCase):
 def test_explicit_cutoff_does_not_expire_at_start_of_day(self):
  t={'due_day':'2026-01-10','plan':{'deadline':'2026-01-10T13:00:00+08:00'}}
  self.assertFalse(p.deadline_passed(t,datetime.datetime.fromisoformat('2026-01-10T12:59:00+08:00')))
  self.assertTrue(p.deadline_passed(t,datetime.datetime.fromisoformat('2026-01-10T13:01:00+08:00')))
 def test_weekly_history_includes_group_even_when_all_portions_planned_later(self):
  t={'id':'synthetic','assignment_id':'synthetic-group','status':'todo','planned_day':'2026-01-09','plan':{'start':'2026-01-05','end':'2026-01-10'}}
  self.assertEqual(p.weekly_overview([t],'2026-01-06',True),[t])
