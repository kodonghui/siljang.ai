// 글꼴: 09 토큰의 첫 글꼴 IBM Plex Sans KR을 같은 출처에서 준다(@fontsource, 토큰이 쓰는 굵기 400·500·600·700만).
// 글자 묶음(unicode-range)마다 파일이 나뉘어 있어 브라우저는 화면에 나온 글자의 파일만 받는다.
// 그 대신 @font-face 선언이 굵기마다 94개라 CSS가 크다(빌드 기준 gzip 약 130KB). 그래서 앱(main.tsx)은 이 모듈을
// 동적 import로 따로 실어 첫 그림을 막지 않게 하고(글꼴이 오기 전에는 토큰의 대체 글꼴, font-display: swap),
// scripts/check-dist.mjs가 첫 CSS에 @font-face가 없는지 본다. 견본 화면은 실제 글꼴로 재려고 바로 싣는다.
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/500.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-sans-kr/700.css";
