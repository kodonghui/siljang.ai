# 용어 바꾸기와 Notion 동기화 도구 (2026-11-12)

01~07단계 문서의 용어를 업계 표준 용어로 바꿀 때 쓴 스크립트입니다. 2026-11-12 결정 카드에서 동희님이 '용어집부터 전부 바꿈'(16:23)과 '추천대로 확정'(용어 대조표 82개, 17:30)을 고르셨습니다. 대조표 원문은 Notion 기록 행 `416bf16cc3ec8149a1cacc395e33055c`의 inline DB(`collection://1b1cbfdb-b079-43d8-b22f-663585b0de12`)에 있고, 요약은 `docs/01-domain/domain.md` 3-7절에 있습니다.

처음에는 세션 임시 폴더에만 있던 것을 다른 계정으로 일을 넘기기 전에 저장소에 올렸습니다. 경로만 저장소 기준으로 바꿨고 규칙은 그대로입니다.

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `rules.py` | 대조표 82개를 문맥별 치환 규칙으로 옮긴 것. 동희님 말과 지난 결정 카드 문구 인용, domain.md 3-7절은 보호 구간이라 바꾸지 않음 |
| `engine.py` | 치환 엔진. 바뀐 말의 받침에 맞춰 뒤 조사를 고치고(이/가, 을/를, 은/는, 으로/로 등), 파일 묶음(G01~G07)별로 규칙을 적용 |
| `run.py` | 저장소 전체에 규칙을 돌림. 기본은 미리보기이고 `--write`면 파일을 고침. 규칙별로 바뀐 곳을 `--report=경로`(기본: 임시 폴더의 `terms-report.txt`)에 씀 |
| `scope.py` | 대상 파일(`README.md`, `docs`, `db`, `api`, `research`, `.corthex`)과 제외 목록. 이 폴더 자신은 대상에서 뺌 |
| `josa_check.py` | 바뀐 용어 뒤의 조사가 받침과 맞는지 검사 |
| `notion-sync/gen_all.py` | 저장소 원본에서 Notion DB 13개에 들어갈 속성·본문 값을 만듦: `gen_all.py <저장소> <out.json>` |
| `notion-sync/tdiff.py` | 마크다운 표를 읽는 도우미(gen_all이 씀) |
| `notion-sync/diff2.py` | 두 스냅숏을 비교해 바뀐 행의 속성과 본문 편집 목록을 냄: `diff2.py BASE.json CUR.json REQ,SPEC,...` |

gen_all.py가 만드는 DB 키와 Notion 데이터 소스는 아래와 같습니다.

| 키 | 행 수 | Notion 데이터 소스 |
| --- | --- | --- |
| REQ | 164 | 요구사항 `collection://2423480b-108c-4366-b2dc-f8dba389aeef` |
| HOT | 27 | 핫스팟 답(02) `collection://1d25fc54-a18d-4df3-a7e3-32c383f98479` |
| FLOW | 14 | 플로우(03) `collection://8adbbe2d-640f-49cd-a96c-3ddd880cb267` |
| CAND | 7 | 새 요구사항 후보(03) `collection://880604f6-0fe2-47eb-ab2a-1dc93135c164` |
| READ | 22 | 요구사항 해석 R1~R22(03) `collection://0be2bc5d-4649-4768-bc02-1fe01aa62bae` |
| SPEC | 69 | 기능 명세(04) `collection://0303376d-24b4-435c-b384-9cf3873c5715` |
| E | 14 | 결정 사항(05) `collection://16df8283-90bb-4411-8916-e0322d01d974` |
| TBL | 51 | 테이블(05) `collection://b27ee607-74ae-4df6-b5fa-cd47264ff7b1` |
| API | 72 | API(06) `collection://371fbd11-27c4-4b12-94b5-42177da3755c` |
| ERR | 32 | 오류 코드(06) `collection://80b0c6dd-bde6-4b53-b219-702910782f2f` |
| DEC | 19 | 결정 사항(06) `collection://e1cff7ea-d4d1-4a76-9bee-2066ac46d243` |
| S | 9 | 결정 사항(07) `collection://ccb2cf95-aee8-4015-834f-d84d24ef02e1` |
| SCR | 49 | 화면(07) `collection://96eadb29-9f83-4c16-adb3-296ae419994f` |

## 쓴 기록과 주의할 점

- PR #10(main 4246cae)에서 `run.py --write`로 01~07 원본을 고쳤고, 그 뒤 #11~#14에서 어색해진 문장과 뜻이 바뀐 곳을 손으로 고쳤습니다.
- **main에 `--write`로 다시 돌리지 않습니다.** 2026-11-12 main 91f5209에서 미리보기로 돌리면 파일 3개 37곳이 바뀐다고 나옵니다. 모두 바꾸면 안 되는 곳입니다. domain.md 3-7절 요약 자체(예전 이름까지 새 이름으로 바뀜)와 API-017(가격표 새 버전 저장) 설명의 '도안 그림'(케이크 디자인 이미지라서 '다이어그램'이 아님)입니다. 이 도구는 새 글이나 Miro 보드 글에 대조표를 적용할 때 문맥별 규칙을 참고하는 용도입니다.
- `josa_check.py`는 main 91f5209에서 23건을 내지만 모두 오탐입니다. 동사 '열면·열고·권한다'를 명사 '열·권한'과 조사로 읽은 것입니다.
- 2026-11-12에 Notion 13개 DB(549행)를 main과 맞췄습니다. main 91f5209에서 `gen_all.py`로 만든 값은 Notion에 반영한 값과 같습니다(diff2 결과 바뀐 행 0).

## 쓰는 법

저장소 맨 위에서 `-B`로 실행합니다(`__pycache__`를 만들지 않음).

```
python3 -B research/cake-terms-2026-11/run.py                 # 미리보기
python3 -B research/cake-terms-2026-11/josa_check.py
python3 -B research/cake-terms-2026-11/notion-sync/gen_all.py . /tmp/cur.json
python3 -B research/cake-terms-2026-11/notion-sync/diff2.py /tmp/base.json /tmp/cur.json REQ,SPEC,SCR
```

원본을 바꾼 뒤 Notion을 맞추려면 Notion과 같은 커밋(지금은 main 91f5209)에서 만든 `base.json`과 새 커밋에서 만든 `cur.json`을 비교합니다. 지난 커밋 값은 `git worktree add /tmp/base <커밋>`으로 꺼낸 폴더에서 만듭니다. 나온 편집은 Notion MCP의 `update_content`로 바뀐 부분만 고칩니다(본문의 `~`는 `\~`). FL 행 본문에는 07단계 '화면' 표가 들어가지 않습니다. `yaml` 모듈(PyYAML)이 필요합니다.
