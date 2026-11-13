import json, pathlib, sys
def col(h, desc, alpha=None):
    h=h.lstrip('#'); comps=[round(int(h[i:i+2],16)/255,4) for i in (0,2,4)]
    v={"colorSpace":"srgb","components":comps}
    if alpha is not None: v["alpha"]=alpha
    v["hex"]="#"+h.upper()
    return {"$type":"color","$value":v,"$description":desc}
def dim(n, desc): return {"$type":"dimension","$value":{"value":n,"unit":"px"},"$description":desc}
def fam(lst, desc): return {"$type":"fontFamily","$value":lst,"$description":desc}
def fw(n, desc): return {"$type":"fontWeight","$value":n,"$description":desc}
def num(n, desc): return {"$type":"number","$value":n,"$description":desc}
def shadow(h, a, x, y, b, s, desc):
    c=col(h,"")["$value"]; c["alpha"]=a
    return {"$type":"shadow","$value":{"color":c,"offsetX":{"value":x,"unit":"px"},"offsetY":{"value":y,"unit":"px"},"blur":{"value":b,"unit":"px"},"spread":{"value":s,"unit":"px"}},"$description":desc}

FALLBACK=["Apple SD Gothic Neo","Malgun Gothic","sans-serif"]
A={
 "$description":"09단계 후보 A '주문서': 작업대 위 종이 주문서처럼 얇은 선으로 칸을 나누고 글과 숫자를 촘촘히 보이는 도구형. 방향을 고르기 전 후보이며 고른 뒤 design/base.tokens.json으로 옮긴다.",
 "color":{
  "paper":col("#F5F3EE","화면 바탕. 종이 주문서의 흰색"),
  "surface":col("#FFFFFF","카드·표·위쪽 막대의 바탕"),
  "surface-sunken":col("#ECE9E2","사진 자리, 마감 칸, 비활성 버튼, 불러오는 동안의 회색 막대"),
  "ink":col("#1D1C1A","본문과 제목 글자. 지연 할 일의 굵은 테두리"),
  "ink-muted":col("#5B574F","보조 글자(시각·주문번호·단위). 흰 바탕과 종이 바탕 모두 4.5:1 넘음"),
  "line":col("#D6D1C6","칸을 나누는 얇은 선(장식용)"),
  "line-control":col("#8A8478","입력칸과 바깥선 버튼의 테두리. 이웃 색과 3:1 넘음"),
  "accent":col("#2B4BA6","볼펜 남색. 주요 버튼, 고른 탭·메뉴, 받음 칸 글자에만 씀"),
  "accent-pressed":col("#1F3A85","주요 버튼을 누른 동안"),
  "accent-soft":col("#E7ECF8","고른 메뉴·행의 바탕, 받음 칸 바탕"),
  "on-accent":col("#FFFFFF","남색 위 글자"),
  "danger":col("#B42318","거절·오류. 도장 빨강"),
  "danger-soft":col("#FBEAE8","오류 안내의 바탕"),
  "warning":col("#8A4A00","지연·남은 자리 0 같은 주의 글자"),
  "warning-soft":col("#FFF1DC","주의 안내(배너)의 바탕"),
  "success":col("#26663A","마친 일의 글자"),
  "success-soft":col("#E5F2E8","마친 일 안내의 바탕"),
  "scrim":col("#1D1C1A","확인 창 뒤를 덮는 막",alpha=0.48)},
 "font":{
  "family":{"base":fam(["IBM Plex Sans KR"]+FALLBACK,"모든 글자. 숫자는 고정폭(tabular-nums)으로 씀")},
  "size":{"caption":dim(12,"캘린더 칸 상태, 표 머리"),"small":dim(13,"보조 정보"),"body":dim(15,"본문·버튼"),
          "title":dim(17,"구역 제목, 위쪽 막대 제목"),"heading":dim(21,"화면 제목, 360의 가게 이름"),"display":dim(26,"1280의 가게 이름, 픽업 일시 같은 큰 숫자")},
  "weight":{"regular":fw(400,"본문"),"medium":fw(500,"표 값"),"semibold":fw(600,"구역 제목·버튼"),"bold":fw(700,"화면 제목·강조 숫자")},
  "line-height":{"tight":num(1.3,"제목·한 줄 값"),"body":num(1.55,"본문")}},
 "space":{"xxs":dim(2,"글자와 밑줄 사이"),"xs":dim(4,"아주 가까운 것"),"sm":dim(8,"같은 묶음 안"),"md":dim(12,"카드 안 여백"),
          "lg":dim(16,"화면 옆 여백(360), 묶음 사이"),"xl":dim(24,"구역 사이"),"xxl":dim(32,"큰 구역 사이(1280)")},
 "radius":{"sm":dim(4,"상태 표시·입력칸"),"md":dim(6,"버튼·카드"),"lg":dim(8,"확인 창")},
 "border-width":{"hairline":dim(1,"칸 나눔 선"),"strong":dim(2,"지연 할 일·포커스 테두리")},
 "size":{"target":dim(44,"누르는 곳의 최소 크기(가로·세로). 캘린더 칸 최소 크기"),"control":dim(44,"버튼·입력칸 높이"),
         "control-lg":dim(48,"360에서 아래 고정 버튼 높이"),"bar":dim(52,"위쪽 막대 높이"),"menu":dim(220,"1280 왼쪽 메뉴 너비"),
         "aside":dim(336,"1280 오른쪽 열 너비"),"thumb":dim(104,"360 사진 한 장(한 줄 세 장)"),"content":dim(1040,"1280 손님 화면 가운데 열 최대 너비")}
}
B={
 "$description":"09단계 후보 B '쇼케이스': 진열장처럼 사진이 먼저 보이고, 넓은 여백과 둥근 카드에 진한 청록 한 색을 넓게(위쪽 띠·메뉴·주요 버튼) 쓰는 가게형. 방향을 고르기 전 후보이며 고른 뒤 design/base.tokens.json으로 옮긴다.",
 "color":{
  "bg":col("#F2F5F4","화면 바탕. 청록 쪽으로 기운 흰색"),
  "surface":col("#FFFFFF","카드의 바탕"),
  "surface-sunken":col("#E6ECEB","사진 자리, 마감 칸, 비활성 버튼, 불러오는 동안의 회색 막대"),
  "ink":col("#14201F","본문과 제목 글자. 지연 할 일의 굵은 테두리"),
  "ink-muted":col("#4F5E5D","보조 글자(시각·주문번호·단위). 흰 바탕과 화면 바탕 모두 4.5:1 넘음"),
  "line":col("#DCE4E3","칸을 나누는 얇은 선(장식용)"),
  "line-control":col("#7F8F8D","입력칸과 바깥선 버튼의 테두리. 이웃 색과 3:1 넘음"),
  "accent":col("#0E5A5C","진한 청록. 위쪽 띠, 1280 왼쪽 메뉴, 주요 버튼, 받음 칸 글자"),
  "accent-pressed":col("#0A4446","주요 버튼을 누른 동안"),
  "accent-soft":col("#DDEDEC","고른 행·탭의 바탕, 받음 칸 바탕"),
  "on-accent":col("#FFFFFF","청록 위 글자"),
  "on-accent-muted":col("#CFE6E4","청록 위 보조 글자(고르지 않은 메뉴)"),
  "danger":col("#B42318","거절·오류"),
  "danger-soft":col("#FBEAE8","오류 안내의 바탕"),
  "warning":col("#8A4A00","지연·남은 자리 0 같은 주의 글자"),
  "warning-soft":col("#FFF1DC","주의 안내(배너)의 바탕"),
  "success":col("#26663A","마친 일의 글자"),
  "success-soft":col("#E5F2E8","마친 일 안내의 바탕"),
  "scrim":col("#14201F","확인 창 뒤를 덮는 막",alpha=0.52)},
 "shadow":{"card":shadow("#14201F",0.08,0,2,8,0,"카드를 바탕에서 띄움"),
           "raised":shadow("#14201F",0.16,0,8,24,0,"아래 고정 막대·확인 창")},
 "font":{
  "family":{"display":fam(["Gothic A1"]+FALLBACK,"가게 이름·화면 제목·구역 제목"),
            "base":fam(["Noto Sans KR"]+FALLBACK,"본문·버튼·표. 숫자는 고정폭(tabular-nums)으로 씀")},
  "size":{"caption":dim(13,"캘린더 칸 상태, 표 머리"),"small":dim(14,"보조 정보"),"body":dim(16,"본문·버튼"),
          "title":dim(19,"구역 제목, 위쪽 막대 제목"),"heading":dim(24,"화면 제목, 360의 가게 이름"),"display":dim(32,"1280의 가게 이름")},
  "weight":{"regular":fw(400,"본문"),"medium":fw(500,"표 값·버튼"),"bold":fw(700,"강조 숫자·구역 제목"),"heavy":fw(800,"가게 이름·화면 제목(Gothic A1)")},
  "line-height":{"tight":num(1.25,"제목·한 줄 값"),"body":num(1.6,"본문")}},
 "space":{"xs":dim(4,"아주 가까운 것"),"sm":dim(8,"같은 묶음 안"),"md":dim(12,"작은 카드 안"),"lg":dim(16,"화면 옆 여백(360), 카드 안 여백"),
          "xl":dim(24,"카드 사이, 1280 카드 안 여백"),"xxl":dim(32,"구역 사이"),"xxxl":dim(48,"큰 구역 사이(1280)")},
 "radius":{"sm":dim(8,"상태 표시·입력칸·캘린더 칸"),"md":dim(12,"사진·작은 카드"),"lg":dim(16,"카드·확인 창"),"pill":dim(999,"버튼·탭")},
 "border-width":{"hairline":dim(1,"칸 나눔 선"),"strong":dim(2,"지연 할 일·포커스 테두리")},
 "size":{"target":dim(44,"누르는 곳의 최소 크기(가로·세로). 캘린더 칸 최소 크기"),"control":dim(52,"버튼·입력칸 높이"),
         "bar":dim(60,"위쪽 막대 높이"),"menu":dim(248,"1280 왼쪽 메뉴 너비"),"aside":dim(380,"1280 오른쪽 열 너비"),
         "thumb":dim(152,"360 참고 사진 한 장(가로 스크롤 행)"),"content":dim(1120,"1280 손님 화면 가운데 열 최대 너비")}
}
# usage (repository root): python3 -B research/cake-mockup-2026-11/make_tokens.py [out_dir]   default out_dir: design/candidates
out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else "design/candidates")
out.mkdir(parents=True,exist_ok=True)
for name,d in (("a",A),("b",B)):
    with open(out/("%s.tokens.json"%name),"w",encoding="utf-8") as f:
        json.dump(d,f,ensure_ascii=False,indent=2); f.write("\n")
print("ok", out)
