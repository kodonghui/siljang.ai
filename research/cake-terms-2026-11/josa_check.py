import re, sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scope, rules
from engine import agree, JOSA_RX
terms = sorted(set(rules.NEW_TERMS) | {"마스킹", "에스컬레이션", "에스컬레이션 건", "가예약", "재제작", "지연 안내", "결제 기한 연장", "영업 캘린더",
              "장부 행", "버전", "체크포인트", "결정 사항", "플로우", "노드", "다이어그램", "테이블", "컬럼", "필드", "API", "액터", "도메인 이벤트",
              "이벤트", "상태 머신", "플레이스홀더", "인도", "만료", "철회", "마감 후 추가 수락", "결제 수단", "환불 결정", "환불 송금", "맞춤 주문 검토",
              "결제 확인 요청 카드", "영업 캘린더 설정", "장부 자동 기록", "구글 권한 요청", "장부 연결 해제", "표시 실행 취소", "상단 배너", "미충족 조건",
              "확인 요청", "확정", "스텝", "분기 노드", "기본 경로", "예외 경로", "사유", "이유", "요구사항 해석", "유효 요구사항", "대안", "검토 도구", "미확인",
              "외부", "형식", "시크릿", "참조", "호출", "수락", "그룹", "프롬프트", "템플릿", "테스트", "포함", "충돌", "중복", "반환", "키", "쌍", "매핑",
              "연결", "케이스 유형", "응답 목록", "헤더", "요금표", "항목", "트랜잭션 경계 후보", "트랜잭션", "디자인"}, key=len, reverse=True)
rx = re.compile(r"(?<![가-힣A-Za-z])(?P<W>" + "|".join(map(re.escape, terms)) + r")(?P<J>" + JOSA_RX + ")")
bad = collections.Counter()
for f in scope.files():
    t = open(f"{scope.ROOT}/{f}", encoding="utf-8").read()
    for m in rx.finditer(t):
        w, j = m.group("W"), m.group("J")
        if agree(w, j) != j:
            # 같은 글자로 끝나는 더 긴 낱말의 일부일 수 있으니 앞 문맥도 보임
            s = t[max(0, m.start() - 20):m.end() + 8].replace("\n", "⏎")
            bad[(f, s, w + j, w + agree(w, j))] += 1
for (f, s, a, b), n in sorted(bad.items()):
    print(f"{f}: …{s}…  {a} → {b}")
print(len(bad))
