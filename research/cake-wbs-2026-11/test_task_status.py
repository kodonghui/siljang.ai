import unittest

from task_status import dependency_is_complete, implemented_task_ids


class TaskStatusTests(unittest.TestCase):
    def test_only_current_complete_table_is_read(self):
        text = """| TASK-099 | 옛 확인 | 옛 원인 | 옛 행동 |
## 구현 완료 · 실환경 확인 남음

설명

| 작업 ID | 남은 확인 | 막는 것 | 풀리면 할 행동 |
| --- | --- | --- | --- |
| TASK-020 | 실제 로그인 | 잠금 | 다시 확인 |
| TASK-028 | 실제 쓰기 | 권한 | 다시 확인 |

### 과거 기록
| TASK-099 | 옛 확인 | 옛 원인 | 옛 행동 |
"""
        self.assertEqual(implemented_task_ids(text), {"TASK-020", "TASK-028"})

    def test_missing_section_or_wrong_table_does_not_relax_check(self):
        self.assertEqual(implemented_task_ids("| TASK-020 | 확인 | 잠금 | 행동 |"), set())
        self.assertEqual(implemented_task_ids("## 구현 완료 · 실환경 확인 남음\n| 다른 표 |\n"), set())

    def test_empty_blocker_or_action_is_not_complete(self):
        text = """## 구현 완료 · 실환경 확인 남음
| 작업 ID | 남은 확인 | 막는 것 | 풀리면 할 행동 |
| --- | --- | --- | --- |
| TASK-020 | 실제 로그인 | 잠금 | |
| TASK-028 | 실제 쓰기 | | 다시 확인 |
"""
        self.assertEqual(implemented_task_ids(text), set())

    def test_dependency_accepts_finished_or_recorded_implementation(self):
        active = {"TASK-019": {"finished": "2026-11-16"}, "TASK-020": {}, "TASK-027": {}}
        self.assertTrue(dependency_is_complete("TASK-019", active, {"TASK-020"}))
        self.assertTrue(dependency_is_complete("TASK-020", active, {"TASK-020"}))
        self.assertFalse(dependency_is_complete("TASK-027", active, {"TASK-020"}))
        self.assertFalse(dependency_is_complete("TASK-999", active, {"TASK-999"}))


if __name__ == "__main__":
    unittest.main()
