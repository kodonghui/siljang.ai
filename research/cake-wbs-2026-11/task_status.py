"""진행 기록의 현재 구현 완료 표만 WBS의 앞선 작업 검사에 쓴다."""

import re


def implemented_task_ids(progress):
    heading = "## 구현 완료 · 실환경 확인 남음"
    header = "| 작업 ID | 남은 확인 | 막는 것 | 풀리면 할 행동 |"
    lines = progress.splitlines()
    if heading not in lines:
        return set()
    section = []
    for line in lines[lines.index(heading) + 1:]:
        if line.startswith("## ") or line.startswith("### "):
            break
        section.append(line)
    if header not in section:
        return set()
    found = set()
    for line in section[section.index(header) + 1:]:
        if not line.startswith("|"):
            break
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) == 4 and re.fullmatch(r"TASK-\d{3}", cells[0]) and all(cells[1:]):
            found.add(cells[0])
    return found


def dependency_is_complete(task_id, active, implemented):
    return task_id in active and (bool(active[task_id].get("finished")) or task_id in implemented)
