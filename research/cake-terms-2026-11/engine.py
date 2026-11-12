"""용어 치환 엔진: 조사 맞춤, 보호 구간, 파일 묶음별 규칙."""
import re, collections

H = "[가-힣]"
NH = "(?![가-힣])"


def batchim(s):
    """s의 끝 글자 받침: None(없음), 'ㄹ', 'o'(그 밖). 괄호·따옴표·별표는 건너뜀."""
    i = len(s) - 1
    while i >= 0:
        ch = s[i]
        if ch == ")":
            depth = 0
            while i >= 0:
                if s[i] == ")":
                    depth += 1
                elif s[i] == "(":
                    depth -= 1
                    if depth == 0:
                        break
                i -= 1
            i -= 1
            continue
        if ch in "'\"’”`*_ ":
            i -= 1
            continue
        break
    if i < 0:
        return None
    ch = s[i]
    code = ord(ch)
    if 0xAC00 <= code <= 0xD7A3:
        j = (code - 0xAC00) % 28
        return None if j == 0 else ("ㄹ" if j == 8 else "o")
    if ch.isdigit():
        k = i
        while k >= 0 and s[k].isdigit():
            k -= 1
        num = s[k + 1:i + 1]
        if len(num) >= 2 and num.endswith("0"):
            return "o"
        return {"0": "o", "1": "ㄹ", "2": None, "3": "o", "4": None, "5": None,
                "6": "o", "7": "ㄹ", "8": "ㄹ", "9": None}[num[-1]]
    if ch.isalpha() and ch.isascii():
        c = ch.lower()
        if c in "lr":
            return "ㄹ"
        if c in "mn":
            return "o"
        return None
    return None


STRICT = [("이어야", "여야"), ("이어서", "여서"), ("이어도", "여도"), ("이라고", "라고"), ("이라는", "라는"), ("이라서", "라서"), ("이라면", "라면"), ("이라도", "라도"),
          ("이에요", "예요"), ("이었", "였"), ("이라", "라"), ("이란", "란"), ("이나", "나"), ("이랑", "랑"),
          ("이든", "든"), ("이야", "야"), ("은", "는"), ("이", "가"), ("을", "를"), ("과", "와")]
RO = ["부터", "서", "써", "는", "만", "도", "의", ""]
OPT = [("이므로", "므로"), ("이지만", "지만"), ("이다", "다"), ("이고", "고"), ("이며", "며"), ("이면", "면"),
       ("이자", "자"), ("이니", "니")]

_alts = []
for a, b in STRICT + OPT:
    _alts += [a, b]
for r in RO:
    _alts += ["으로" + r, "로" + r]
_alts = sorted(set(_alts), key=len, reverse=True)
PREFIX_FORMS = {"이었", "였"}
JOSA_RX = "(?:" + "|".join(
    (re.escape(a) if a in PREFIX_FORMS else re.escape(a) + NH) for a in _alts) + ")"
PART = ("(?:[^가-힣]|$|의|에|도|만|까지|부터|마다|처럼|보다|하고|대로|별|씩|들|조차|마저|밖에|께|뿐|쯤|끼리|째|"
        "인|일|임|입|이어|여|이므|이니|이지|이자|이든)")
J = "(?:(?P<J>" + JOSA_RX + ")|(?=" + PART + "))"


def agree(word, josa):
    """word 뒤에 오는 josa를 받침에 맞게 고친다."""
    if not josa:
        return ""
    b = batchim(word)
    for a, v in STRICT:
        if josa in (a, v):
            return a if b else v
    for r in RO:
        if josa in ("으로" + r, "로" + r):
            return ("으로" + r) if b == "o" else ("로" + r)
    for a, v in OPT:
        if josa in (a, v):
            return a if b else josa
    return josa


SENT = "\u0000J\u0000"


class Rule:
    def __init__(self, name, pat, repl, only=None, skip=None, flags=0, files=None):
        self.name = name
        self.files = files
        self.src = pat
        self.rx = re.compile(pat.replace("{J}", J), flags)
        self.repl = repl
        self.only = only
        self.skip = skip

    def applies(self, group):
        if self.only and group not in self.only:
            return False
        if self.skip and group in self.skip:
            return False
        return True

    def sub(self, text, log, fname):
        def f(m):
            jj = m.group("J") if "J" in m.re.groupindex else None
            if jj:
                old = m.group(0)[: m.end("J") - m.start(0) - len(jj)]
                if agree(old, jj) != jj and not any(jj in (a, v) for a, v in OPT):
                    log[self.name + " !SKIP"][(text[max(0, m.start() - 14):m.end() + 6], "")] += 1
                    return m.group(0)
            if callable(self.repl):
                out = self.repl(m)
            else:
                out = m.expand(self.repl.replace("{J}", SENT))
            if SENT in out:
                k = out.index(SENT)
                out = out[:k] + agree(out[:k], m.group("J") or "") + out[k + len(SENT):]
            if out != m.group(0):
                s, e = m.start(), m.end()
                pre = text[max(0, s - 14):s].split("\n")[-1]
                post = text[e:e + 6].split("\n")[0]
                log[self.name][(pre + "[" + m.group(0) + "]" + post, out)] += 1
            return out
        return self.rx.sub(f, text)


def group_of(path):
    if path.startswith("docs/01-") :
        return "G01"
    if path.startswith("docs/02-") or "cake-prd" in path:
        return "G02"
    if path.startswith("docs/03-") or "cake-flow" in path:
        return "G03"
    if path.startswith("docs/04-") or "cake-spec" in path:
        return "G04"
    if path.startswith("db/") or path.startswith("docs/05-") or "cake-erd" in path:
        return "G05"
    if path.startswith("api/") or path.startswith("docs/06-") or "cake-api" in path:
        return "G06"
    if path.startswith("docs/07-") or "cake-sitemap" in path:
        return "G07"
    return "GM"
