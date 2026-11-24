import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { formatKoreanDate, formatSeoulTime } from "./format-date";
import { classify } from "./problems";
import { fetchPublicBooking, type PublicBookingPage, type PublicPriceOption } from "./public-booking-api";
import { announce, Banner, Button, ConfirmDialog, EmptyState, LoadFailure, Skeleton, StateBox } from "./ui";
import { useVersionedRead } from "./useVersionedRead";
import "./public-booking.css";

const money = (n: number) => n.toLocaleString("ko-KR");
function price(option: PublicPriceOption) {
  if (option.priceKind === "from") return `${money(option.amount)}원부터`;
  if (option.priceKind === "range") return `${money(option.amount)}~${money(option.amountMax ?? option.amount)}원`;
  return `${money(option.amount)}원`;
}
const groupNames = { size: "크기", flavor: "맛", design: "디자인", extra: "추가 옵션" } as const;
function useWide() {
  const [wide, setWide] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1260px)").matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 1260px)"),
      change = () => setWide(query.matches);
    query.addEventListener("change", change);
    change();
    return () => query.removeEventListener("change", change);
  }, []);
  return wide;
}
export function PublicBookingScreen() {
  const { slug = "" } = useParams();
  return <BookingDetails key={slug} slug={slug} />;
}
function BookingDetails({ slug }: { readonly slug: string }) {
  const wide = useWide();
  const pending = useRef(true),
    photoRetried = useRef(false),
    cooldownUntil = useRef(0);
  const [cooldown, setCooldown] = useState<number | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null),
    [stale, setStale] = useState(false);
  const [badPhotos, setBadPhotos] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<{ url: string; name: string } | null>(null);
  const [copyResult, setCopyResult] = useState("");
  const load = useVersionedRead(
    async (signal) => {
      try {
        return await fetchPublicBooking(slug, signal);
      } finally {
        if (!signal.aborted) pending.current = false;
      }
    },
    {
      onLoaded: () => {
        setAsOf(Date.now());
        setBadPhotos(new Set());
        setStale(false);
      },
    },
  );
  const reload = useCallback(
    (manual = true) => {
      if (pending.current || performance.now() < cooldownUntil.current) return;
      if (manual) photoRetried.current = false;
      setSelected(null);
      pending.current = true;
      if (!load.read("stale")) pending.current = false;
    },
    [load.read],
  );
  useEffect(() => {
    const response = load.result?.response;
    if (!response) return;
    if (!response.ok && response.status === 429) {
      const until = performance.now() + (response.retryAfterSeconds ?? 60) * 1000;
      cooldownUntil.current = until;
      const tick = () => {
        const remaining = Math.ceil((until - performance.now()) / 1000);
        if (remaining <= 0) {
          setCooldown(null);
          reload(false);
        } else setCooldown(remaining);
      };
      tick();
      const timer = setInterval(tick, 1000);
      document.addEventListener("visibilitychange", tick);
      return () => {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", tick);
      };
    }
    cooldownUntil.current = 0;
    setCooldown(null);
  }, [load.result, reload]);
  useEffect(() => {
    // 열어 둔 페이지에도 게시 철회를 반영한다. API의 최대60초 캐시를 포함해5분 안에 갱신한다.
    const timer = setInterval(() => {
      setStale(true);
      if (document.visibilityState !== "hidden") reload(false);
    }, 60_000);
    const restore = () => {
      if (document.visibilityState !== "hidden") {
        setStale(true);
        reload(false);
      }
    };
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", restore);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", restore);
    };
  }, [reload]);
  const page = load.result?.response.ok ? load.result.response.data : null;
  const failedPhoto = (url: string) => {
    if (pending.current) return;
    setSelected(null);
    setStale(true);
    if (!photoRetried.current) {
      photoRetried.current = true;
      reload(false);
    } else {
      setBadPhotos((old) => new Set([...old, url]));
      announce("사진을 불러오지 못했어요", "assertive");
    }
  };
  const photo = (url: string, name: string) =>
    badPhotos.has(url) ? (
      <span className="public-booking-photo-failed" role="status">
        사진을 불러오지 못했어요
      </span>
    ) : (
      <button
        type="button"
        className="public-booking-photo"
        aria-label={`${name} 크게 보기`}
        onClick={() => setSelected({ url, name })}
      >
        <img src={url} alt={name} onError={() => failedPhoto(url)} loading="lazy" />
      </button>
    );
  const copy = async () => {
    if (!page?.inquiryUrl) return;
    try {
      await navigator.clipboard.writeText(page.inquiryUrl);
      setCopyResult("복사했어요");
      announce("채널 주소를 복사했어요");
    } catch {
      setCopyResult("복사하지 못했어요. 아래 주소를 직접 복사해 주세요");
    }
  };
  const failure = load.failure;
  return (
    <main className="public-booking">
      <header>
        <h1>{page?.shop.name ?? "예약 링크 페이지"}</h1>
        {page?.shop.pickupAddress ? <p>픽업 장소 · {page.shop.pickupAddress}</p> : null}
      </header>
      {load.loading ? (
        <BookingLoading />
      ) : failure?.status === 404 ? (
        <StateBox tone="error" title="찾을 수 없어요">
          가게 주소를 다시 확인해 주세요
        </StateBox>
      ) : failure?.status === 429 ? (
        <StateBox title="잠시 뒤 다시 시도해 주세요">
          <span aria-live="off">{cooldown ?? failure.retryAfterSeconds ?? 60}초 뒤 자동으로 다시 불러와요</span>
        </StateBox>
      ) : failure ? (
        <LoadFailure
          failure={classify(failure.status, failure.problem, failure.retryAfterSeconds)}
          onRetry={() => reload()}
        />
      ) : page ? (
        <>
          <section aria-labelledby="booking-portfolio">
            <h2 id="booking-portfolio">포트폴리오</h2>
            {page.portfolio.length ? (
              <ul className="public-booking-photos">
                {page.portfolio.map((p, index) => (
                  <li key={p.imageUrl}>{photo(p.imageUrl, `포트폴리오 사진 ${index + 1}`)}</li>
                ))}
              </ul>
            ) : (
              <EmptyState>아직 사진이 없어요</EmptyState>
            )}
          </section>
          <div className="public-booking-columns">
            <div className="public-booking-content">
              <section aria-labelledby="booking-prices">
                <h2 id="booking-prices">가격표</h2>
                <p>버전 {page.priceList.version}</p>
                {(Object.keys(groupNames) as (keyof typeof groupNames)[]).map((group) => (
                  <details open key={group} className="public-booking-options">
                    <summary>{groupNames[group]}</summary>
                    <dl>
                      {page.priceList.options
                        .filter((o) => o.group === group)
                        .map((o) => (
                          <div key={`${o.group}:${o.name}`}>
                            <dt>
                              {o.name}
                              {o.inStandard ? <span> · 기본 범위</span> : null}
                            </dt>
                            <dd>{price(o)}</dd>
                          </div>
                        ))}
                    </dl>
                  </details>
                ))}
                {page.priceList.designs.length ? (
                  <>
                    <h3>도안</h3>
                    <ul className="public-booking-designs">
                      {page.priceList.designs.map((d) => (
                        <li key={d.name}>
                          {photo(d.imageUrl, d.name)}
                          <p>
                            {d.name}
                            {d.inStandard ? " · 기본 디자인" : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </section>
              <section aria-labelledby="booking-calendar">
                <h2 id="booking-calendar">빈 날짜</h2>
                <p>오늘부터 60일 · 받음·마감·휴무</p>
                {asOf !== null ? (
                  <Banner
                    tone={stale ? "warning" : "accent"}
                    actions={<Button onClick={() => reload()}>다시 불러오기</Button>}
                  >
                    {formatSeoulTime(asOf)} 기준이에요
                  </Banner>
                ) : null}
                <p>빈 날짜는 문의할 때 가게 규칙으로 다시 확인해요. 이 페이지에서 자리를 잡지 않아요.</p>
                <BookingCalendar days={page.days} wide={wide} />
              </section>
            </div>
            <aside className="public-booking-aside">
              <div className="public-booking-inquiry">
                {page.inquiryUrl ? (
                  <a
                    className="public-booking-primary"
                    href={page.inquiryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    문의하기
                  </a>
                ) : (
                  <Button disabled>문의하기</Button>
                )}
              </div>
              {page.inquiryUrl ? (
                <>
                  <p>카카오톡을 열 수 없으면 채널 주소를 복사해 주세요.</p>
                  <p className="public-booking-channel">{page.inquiryUrl}</p>
                  <Button onClick={() => void copy()}>채널 주소 복사</Button>
                  <p role="status">{copyResult}</p>
                </>
              ) : (
                <p>가게 채널 주소를 준비하고 있어요</p>
              )}
              <details className="public-booking-identity" open={wide}>
                <summary>가게 정보</summary>
                <dl>
                  {[
                    ["상호", page.shop.businessName],
                    ["대표자", page.shop.representativeName],
                    ["사업장 주소", page.shop.businessAddress],
                    ["연락처", page.shop.contactPhone],
                    ["전자우편주소", page.shop.contactEmail],
                    ["사업자등록번호", page.shop.businessRegNo],
                    ["통신판매업 신고번호", page.shop.mailOrderRegNo],
                    ["신고 기관", page.shop.mailOrderAuthority],
                    ["면제 사유", page.shop.mailOrderExemption],
                  ]
                    .filter(([, value]) => value !== null)
                    .map(([name, value]) => (
                      <div key={name}>
                        <dt>{name}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                </dl>
              </details>
              <Link className="public-booking-link" to={`/s/${encodeURIComponent(slug)}/privacy`}>
                개인정보 처리방침 보기
              </Link>
            </aside>
          </div>
        </>
      ) : null}
      <ConfirmDialog
        open={selected !== null}
        title={selected?.name ?? "사진 보기"}
        confirmLabel="사진 보기 마치기"
        onCancel={() => setSelected(null)}
        onConfirm={() => setSelected(null)}
      >
        {selected ? (
          <img
            className="public-booking-large-photo"
            src={selected.url}
            alt={selected.name}
            onError={() => failedPhoto(selected.url)}
          />
        ) : null}
      </ConfirmDialog>
    </main>
  );
}
function BookingLoading() {
  return (
    <div className="public-booking-loading">
      <Skeleton label="예약 링크 페이지를 불러오고 있어요" rows={3} />
      <h2>가격표</h2>
      <Skeleton rows={4} />
      <h2>빈 날짜</h2>
      <Skeleton rows={6} />
      <Button disabled>문의하기</Button>
    </div>
  );
}
function BookingCalendar({ days, wide }: { readonly days: PublicBookingPage["days"]; readonly wide: boolean }) {
  const months = [...new Set(days.map((day) => day.day.slice(0, 7)))];
  const [index, setIndex] = useState(0);
  const count = wide ? 2 : 1,
    start = Math.min(index, Math.max(0, months.length - count));
  const label = (month: string) => `${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월`;
  return (
    <>
      <nav aria-label="캘린더 월 이동">
        <Button disabled={start === 0} onClick={() => setIndex(start - 1)}>
          이전 달
        </Button>
        <span>{label(months[start] ?? "")}</span>
        <Button disabled={start + count >= months.length} onClick={() => setIndex(start + 1)}>
          다음 달
        </Button>
      </nav>
      <div className="public-booking-months">
        {months.slice(start, start + count).map((month) => {
          const offset = new Date(`${month}-01T00:00:00Z`).getUTCDay();
          const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
          const entries = new Map(days.map((d) => [d.day, d.status]));
          const cells = Array.from({ length: Math.ceil((offset + last) / 7) * 7 }, (_, i) => i - offset + 1);
          return (
            <table key={month} className="public-booking-calendar">
              <caption>{label(month)}</caption>
              <thead>
                <tr>
                  {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
                    <th key={d} scope="col">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7)).map(
                  (week) => (
                    <tr key={week.join(":")}>
                      {week.map((day) => {
                        const key = `${month}-${String(day).padStart(2, "0")}`,
                          status = entries.get(key),
                          outside = day < 1 || day > last;
                        const text =
                          status === "open"
                            ? "받음"
                            : status === "closed"
                              ? "마감"
                              : status === "day_off"
                                ? "휴무"
                                : "기간 밖";
                        return (
                          <td
                            key={day}
                            data-status={status ?? "outside"}
                            aria-label={outside ? undefined : `${formatKoreanDate(key)} ${text}`}
                          >
                            {outside ? null : (
                              <>
                                <time dateTime={key}>{day}</time>
                                <span>{text}</span>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          );
        })}
      </div>
    </>
  );
}
