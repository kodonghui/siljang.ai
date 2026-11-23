import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { formatSeoulDate } from "./format-date";
import { classify } from "./problems";
import { fetchPublicPrivacy, type OverseasTransfer } from "./public-privacy-api";
import { type ListColumn, ListView, LoadFailure, Skeleton, StateBox } from "./ui";
import { useVersionedRead } from "./useVersionedRead";
import "./public-privacy.css";

interface TransferRow extends OverseasTransfer {
  readonly key: string;
}
const columns: readonly ListColumn<TransferRow>[] = [
  { label: "이전받는 자", card: "title", cell: (row) => row.recipient },
  { label: "이전하는 개인정보 항목", card: "meta", cell: (row) => row.personalData },
  {
    label: "국가·이전 시기와 방법",
    card: "meta",
    cell: (row) => (
      <>
        {row.country}
        <br />
        {row.whenAndHow}
      </>
    ),
  },
  { label: "목적과 보유 기간", card: "meta", cell: (row) => row.purposeAndRetention },
  { label: "이전을 거부하는 방법", card: "meta", cell: (row) => row.howToRefuse },
];
function jump(id: string) {
  const heading = document.getElementById(id);
  heading?.focus();
  heading?.scrollIntoView?.({ block: "start" });
}
export function PublicPrivacyScreen() {
  const { slug = "" } = useParams();
  return <PrivacyDetails key={slug} slug={slug} />;
}
function PrivacyDetails({ slug }: { readonly slug: string }) {
  const load = useVersionedRead((signal) => fetchPublicPrivacy(slug, signal), {});
  const handled = useRef<unknown>(null),
    deadline = useRef<number | null>(null);
  const [cooldown, setCooldown] = useState<{ until: number; remaining: number } | null>(null);
  useEffect(() => {
    if (!load.result || handled.current === load.result) return;
    handled.current = load.result;
    const response = load.result.response;
    if (!response.ok && response.status === 429) {
      const seconds = response.retryAfterSeconds ?? 60;
      const until = performance.now() + seconds * 1000;
      deadline.current = until;
      setCooldown({ until, remaining: seconds });
    } else {
      deadline.current = null;
      setCooldown(null);
    }
  }, [load.result]);
  useEffect(() => {
    const until = cooldown?.until;
    if (until === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (deadline.current !== until) return;
      const milliseconds = until - performance.now();
      if (milliseconds <= 0) {
        deadline.current = null;
        setCooldown(null);
        load.read("stale");
        return;
      }
      setCooldown({ until, remaining: Math.ceil(milliseconds / 1000) });
      timer = setTimeout(tick, Math.min(1000, milliseconds));
    };
    const wake = () => {
      clearTimeout(timer);
      tick();
    };
    tick();
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [cooldown?.until, load.read]);
  const reload = useCallback(() => {
    if (deadline.current !== null && deadline.current > performance.now()) return;
    load.read("stale");
  }, [load.read]);
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) reload();
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, [reload]);
  const failure = load.failure;
  const response = load.result?.response;
  const policy = response?.ok ? response.data : null;
  return (
    <main className="public-privacy">
      <h1>개인정보 처리방침</h1>
      {load.loading ? (
        <Skeleton label="개인정보 처리방침을 불러오고 있어요" />
      ) : failure?.status === 404 ? (
        <StateBox tone="error" title="찾을 수 없어요">
          가게 주소를 다시 확인해 주세요
        </StateBox>
      ) : failure?.status === 429 ? (
        <StateBox title="잠시 뒤 다시 시도해 주세요">
          <span role="status">
            {cooldown?.remaining ?? failure.retryAfterSeconds ?? 60}초 뒤 자동으로 다시 불러와요
          </span>
        </StateBox>
      ) : failure ? (
        <LoadFailure failure={classify(failure.status, failure.problem, failure.retryAfterSeconds)} onRetry={reload} />
      ) : policy ? (
        <>
          <header>
            <p>{policy.shopName}</p>
            <p>
              버전 {policy.version} · <time dateTime={policy.publishedAt}>{formatSeoulDate(policy.publishedAt)}</time>{" "}
              게시
            </p>
            <Link className="public-privacy-link" to={`/s/${slug}`}>
              예약 링크 페이지로
            </Link>
          </header>
          <nav aria-label="처리방침 목차">
            <Link className="public-privacy-link" to="#privacy-body" onClick={() => jump("privacy-body")}>
              처리방침 본문
            </Link>
            <Link className="public-privacy-link" to="#privacy-transfers" onClick={() => jump("privacy-transfers")}>
              국외 이전
            </Link>
          </nav>
          <section aria-labelledby="privacy-body" className="public-privacy-body">
            <h2 id="privacy-body" tabIndex={-1}>
              처리방침 본문
            </h2>
            {policy.body.split(/\n{2,}/).map((paragraph, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 게시된 한 버전의 고정된 문단이며 편집하지 않음
              <p key={index}>{paragraph}</p>
            ))}
          </section>
          <section aria-labelledby="privacy-transfers">
            <h2 id="privacy-transfers" tabIndex={-1}>
              국외 이전
            </h2>
            <ListView
              label="개인정보 국외 이전 항목"
              columns={columns}
              rows={policy.overseasTransfers.map((row, index) => ({ ...row, key: `transfer-${index}` }))}
              rowKey={(row) => row.key}
              empty="국외 이전 항목이 없어요"
            />
          </section>
        </>
      ) : null}
    </main>
  );
}
