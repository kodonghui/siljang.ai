# 04단계 기능 명세 도구

- `spec_rows.py`: SPEC-001~069의 원래 값(동작, REQ, FL, 전제, 주 동작, 예외, 수락 기준, AI 호출). `docs/04-functional-spec/spec.md` 4절 표와 부록은 이 파일에서 만듭니다.
- `build_spec.py`: 번호 순서, REQ·FL이 있는지와 제외 여부, 예외의 경우 종류 표시, Given/When/Then 모양, SPEC·G 참조, 기능 필수 요구사항마다 SPEC이 있는지를 검사합니다. `--write`를 주면 spec.md의 `<!-- SPEC-TABLE -->`와 `<!-- REQ-MAP -->` 사이를 새로 씁니다.

돌리는 법(저장소 맨 위에서):

```
python3 -I research/cake-spec-2026-11/build_spec.py .          # 검사만
python3 -I research/cake-spec-2026-11/build_spec.py . --write  # 표도 새로 씀
```

Notion SPEC 표(한 줄에 SPEC 하나)는 이 값을 그대로 옮긴 사람 보기이고, 다르면 저장소가 맞습니다.
