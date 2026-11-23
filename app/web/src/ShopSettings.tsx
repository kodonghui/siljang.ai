import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { ApiFailure } from "./api";
import { classify, type Failure } from "./problems";
import {
  fetchShopSettings,
  type SavedShopSettings,
  type ShopSettings as Shop,
  saveShopSettings,
} from "./shop-settings-api";
import { type ShopSettingsForm, settingsForm, settingsPatch } from "./shop-settings-form";
import {
  Banner,
  Button,
  CommandStatus,
  Field,
  fieldErrorsFor,
  LoadFailure,
  OwnerLayout,
  Skeleton,
  TextField,
} from "./ui";
import { announce } from "./ui/announce";
import { useCommand } from "./useCommand";
import "./shop-settings.css";
export interface ShopSettingsProps {
  readonly shopName: string;
  readonly onNavigate: (href: string) => void;
  readonly onSessionExpired: () => void;
  readonly onRegisterShop: () => void;
  readonly onLogout: () => void;
  readonly logoutPending?: boolean;
  readonly logoutFailure?: Failure | null;
  readonly sessionChecking?: boolean;
  readonly sessionFailed?: boolean;
}

const TEXT = [
  ["name", "가게 이름", 40, "text"],
  ["contactPhone", "연락처", 14, "tel"],
  ["businessAddress", "사업장 주소", 200, "text"],
  ["contactEmail", "전자우편주소", 100, "email"],
  ["pickupAddress", "픽업 장소", 200, "text"],
  ["mailOrderRegNo", "통신판매업 신고번호", 40, "text"],
] as const;
const NUMBERS = [
  ["idleCloseHours", "문의 끊김 시간(시간)", 1, 720, "저장한 때부터 써요"],
  ["ownerWaitMinutes", "사장님 답 기다리는 시간(분)", 10, 1440, "바꾸면 그 뒤 시작되는 기다림부터 써요"],
  ["dailyAiCostLimitKrw", "하루 AI 비용 한도(원)", 0, 1000000, "저장한 때부터 써요"],
  [
    "awaitingPaymentLimit",
    "한 손님의 결제 기다림 주문 한도(건)",
    0,
    10,
    "저장한 때부터 새 주문 요청에 써요. 0이면 한도 없음",
  ],
] as const;
const POINTERS = [
  ...TEXT.map(([key]) => `/${key}`),
  ...NUMBERS.map(([key]) => `/${key}`),
  "/mailOrderAuthority",
  "/mailOrderExemption",
  "/completionPhotoEnabled",
];
const NETWORK: ApiFailure = { ok: false, status: 0, problem: null, retryAfterSeconds: null };

export function ShopSettings(props: ShopSettingsProps) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [values, setValues] = useState<ShopSettingsForm | null>(null);
  const [loading, setLoading] = useState(true),
    [loadFailure, setLoadFailure] = useState<ApiFailure | null>(null);
  const [unchanged, setUnchanged] = useState(false);
  const activeLoad = useRef<AbortController | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const formRef = useRef<HTMLFormElement>(null);
  const save = useCommand<Record<string, unknown>, SavedShopSettings>((body, key) => saveShopSettings(body, key));
  const handledDone = useRef<SavedShopSettings | null>(null),
    handledConflict = useRef<Failure | null>(null);
  const actionPending = loading || save.busy || Boolean(props.logoutPending || props.sessionChecking);
  const busy = actionPending || Boolean(props.sessionFailed);
  const failure = save.state.kind === "failed" ? save.state.failure : null;
  const errors = fieldErrorsFor(failure?.fieldErrors ?? [], POINTERS).byField;

  const reloadShop = useCallback(() => {
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    setLoading(true);
    setLoadFailure(null);
    void fetchShopSettings(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setShop(result.data);
          setValues(settingsForm(result.data));
        } else {
          setLoadFailure(result);
          if (result.status === 401) callbacks.current.onSessionExpired();
          if (result.status === 404) callbacks.current.onRegisterShop();
        }
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadFailure(NETWORK);
          setLoading(false);
        }
      });
  }, []);
  useEffect(() => {
    reloadShop();
    return () => activeLoad.current?.abort();
  }, [reloadShop]);
  useEffect(() => {
    if (save.state.kind !== "done" || handledDone.current === save.state.data) return;
    handledDone.current = save.state.data;
    setShop(save.state.data.shop);
    setValues(settingsForm(save.state.data.shop));
  }, [save.state]);
  useEffect(() => {
    if (!failure) return;
    if (failure.outcome === "login") callbacks.current.onSessionExpired();
    else if (failure.outcome === "no_shop") callbacks.current.onRegisterShop();
    else if (failure.code === "version_conflict" && handledConflict.current !== failure) {
      handledConflict.current = failure;
      reloadShop();
    }
    if (failure.outcome === "field")
      formRef.current?.querySelector<HTMLElement>('input[aria-invalid="true"],textarea[aria-invalid="true"]')?.focus();
  }, [failure, reloadShop]);

  function navigate(href: string) {
    if (!busy) props.onNavigate(href);
  }
  function change<Key extends keyof ShopSettingsForm>(key: Key, value: ShopSettingsForm[Key]) {
    if (busy) return;
    setValues((old) => (old === null ? old : { ...old, [key]: value }));
    setUnchanged(false);
    save.reset();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !shop || !values) return;
    const body = settingsPatch(shop, values);
    if (body === null) {
      save.reset();
      setUnchanged(true);
      announce("바뀐 것이 없어요", "polite");
      return;
    }
    setUnchanged(false);
    save.submit(body);
  }
  const result = loadFailure ? classify(loadFailure.status, loadFailure.problem, loadFailure.retryAfterSeconds) : null;
  const summary = shop?.settingsSummary;
  const unknown = "상태를 확인할 수 없어요";
  const version = (n: number | null | undefined) =>
    n === undefined ? unknown : n === null ? "아직 정하지 않았어요" : `버전 ${n}`;
  const cards = shop
    ? ([
        [
          "영업 신고",
          "/owner/shop/license",
          { pending: "확인 중", on_hold: "보류", verified: "확인됨" }[shop.licenseStatus],
        ],
        ["가격표와 도안", "/owner/price-list", version(summary?.priceListVersion)],
        ["운영규정", "/owner/operating-rules", version(summary?.operatingRulesVersion)],
        [
          "결제 수단",
          "/owner/payment-destination",
          summary ? (summary.paymentConfigured ? "설정됨" : "아직 정하지 않았어요") : unknown,
        ],
        [
          "카카오톡 채널 연결",
          "/owner/kakao-channel",
          summary
            ? summary.kakaoChannelStatus === "linked"
              ? "연결됨"
              : summary.kakaoChannelStatus === "pending"
                ? "확인 중"
                : summary.kakaoChannelStatus === "not_started"
                  ? "확인 시작 전"
                  : summary.kakaoChannelStatus === "failed"
                    ? "확인 실패, 다시 확인해 주세요"
                    : "연결 안 됨"
            : unknown,
        ],
        [
          "장부 연결",
          "/owner/ledger",
          summary
            ? summary.ledgerStatus === "linked"
              ? "연결됨"
              : summary.ledgerStatus === "auth_lost"
                ? "다시 연결해 주세요"
                : "연결 안 됨"
            : unknown,
        ],
        ["예약 링크", "/owner/booking-link", shop.bookingUrl ? "발급됨" : "발급 전"],
        [
          "포트폴리오",
          "/owner/portfolio",
          summary ? (summary.hasPortfolio ? "게시한 사진 있음" : "게시한 사진 없음") : unknown,
        ],
        ["후기", "/owner/reviews", summary ? (summary.hasReviews ? "후기 있음" : "후기 없음") : unknown],
      ] as const)
    : [];
  const link = (href: string, label: string) => (
    <a
      href={href}
      aria-disabled={busy || undefined}
      tabIndex={busy ? -1 : undefined}
      onClick={(event) => {
        event.preventDefault();
        navigate(href);
      }}
    >
      {label}
    </a>
  );

  return (
    <OwnerLayout
      screen="SCR-034"
      title="가게 설정"
      shopName={shop?.name ?? props.shopName}
      busy={busy}
      onNavigate={(href, event) => {
        event.preventDefault();
        navigate(href);
      }}
    >
      <div className="shop-settings">
        {result ? (
          <LoadFailure
            failure={result}
            onRetry={reloadShop}
            onLogin={props.onSessionExpired}
            onRegisterShop={props.onRegisterShop}
          />
        ) : null}
        {!shop || !values ? (
          <>
            {loading ? <Skeleton rows={9} label="가게 설정을 불러오고 있어요" /> : null}
            <Button disabled>저장</Button>
          </>
        ) : (
          <>
            <nav aria-label="설정 목록" className="settings-cards">
              {cards.map(([label, href, state]) => (
                <a
                  key={href}
                  href={href}
                  className="settings-card"
                  aria-disabled={busy || undefined}
                  tabIndex={busy ? -1 : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(href);
                  }}
                >
                  <strong>{label}</strong>
                  <span>{state}</span>
                </a>
              ))}
            </nav>
            {shop.licenseStatus === "on_hold" ? (
              <Banner tone="warning">{shop.licenseHoldReason ?? "영업 신고가 보류됐어요"}</Banner>
            ) : null}
            <section aria-labelledby="settings-identity-title">
              <h2 id="settings-identity-title">사업자 정보</h2>
              <dl className="settings-identity">
                {[
                  ["상호", shop.businessName],
                  ["대표자", shop.representativeName],
                  ["사업자등록번호", shop.businessRegNo],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {shop.identityChange?.status === "pending" ? (
                <p>변경 확인 기다림</p>
              ) : shop.identityChange?.status === "on_hold" ? (
                <p>변경 요청 보류</p>
              ) : null}
              {link("/owner/shop/license", "변경 요청")}
              <p>영업 신고 번호·종류·신고증은 영업 신고 화면에서 확인해요.</p>
            </section>
            <form ref={formRef} onSubmit={submit} noValidate className="settings-form" aria-busy={busy}>
              <CommandStatus
                state={save.state}
                fields={POINTERS}
                done={(data) => (data.outcome === "unchanged" ? "바뀐 것이 없어요" : "저장했어요")}
                onRetry={() => {
                  if (!busy) save.retry();
                }}
                onReload={() => {
                  if (!busy) reloadShop();
                }}
                onLogin={props.onSessionExpired}
                onRegisterShop={props.onRegisterShop}
              />
              {unchanged ? <Banner tone="success">바뀐 것이 없어요</Banner> : null}
              <fieldset disabled={busy} className="settings-fields">
                <legend>가게 정보와 기능</legend>
                <div className="settings-grid">
                  {TEXT.map(([key, label, max, type]) =>
                    key === "businessAddress" || key === "pickupAddress" ? (
                      <Field
                        key={key}
                        pointer={`/${key}`}
                        label={label}
                        errors={errors.get(`/${key}`)}
                        help={key === "pickupAddress" ? "비어 있으면 전날 안내에 연락처만 나가요" : undefined}
                      >
                        {(ids) => (
                          <span className="ui-field__box">
                            <textarea
                              {...ids}
                              rows={2}
                              className="ui-field__input settings-address"
                              value={values[key]}
                              onChange={(event) => change(key, [...event.target.value].slice(0, max).join(""))}
                            />
                          </span>
                        )}
                      </Field>
                    ) : (
                      <TextField
                        key={key}
                        pointer={`/${key}`}
                        label={label}
                        type={type}
                        errors={errors.get(`/${key}`)}
                        value={values[key]}
                        help={key === "name" ? `남은 글자 수 ${40 - [...values.name].length}` : undefined}
                        onChange={(event) => change(key, [...event.target.value].slice(0, max).join(""))}
                      />
                    ),
                  )}
                  {values.mailOrderRegNo.trim() !== "" ? (
                    <TextField
                      pointer="/mailOrderAuthority"
                      label="통신판매업 신고 기관"
                      value={values.mailOrderAuthority}
                      errors={errors.get("/mailOrderAuthority")}
                      onChange={(event) => change("mailOrderAuthority", [...event.target.value].slice(0, 40).join(""))}
                    />
                  ) : (
                    <TextField
                      pointer="/mailOrderExemption"
                      label="통신판매업 신고 면제 사유"
                      value={values.mailOrderExemption}
                      errors={errors.get("/mailOrderExemption")}
                      onChange={(event) => change("mailOrderExemption", [...event.target.value].slice(0, 200).join(""))}
                    />
                  )}
                  {NUMBERS.map(([key, label, min, max, help]) => (
                    <TextField
                      key={key}
                      pointer={`/${key}`}
                      label={label}
                      type="number"
                      inputMode="numeric"
                      min={min}
                      max={max}
                      step={1}
                      value={values[key]}
                      errors={errors.get(`/${key}`)}
                      help={help}
                      onChange={(event) => change(key, event.target.value)}
                    />
                  ))}
                  <Field
                    pointer="/completionPhotoEnabled"
                    label="완성 사진 보내기"
                    errors={errors.get("/completionPhotoEnabled")}
                  >
                    {(ids) => (
                      <label className="settings-toggle">
                        <input
                          {...ids}
                          type="checkbox"
                          checked={values.completionPhotoEnabled}
                          onChange={(event) => change("completionPhotoEnabled", event.target.checked)}
                        />
                        <span aria-hidden="true">사용</span>
                      </label>
                    )}
                  </Field>
                </div>
              </fieldset>
              <div className="settings-actions">
                <Button type="submit" disabled={busy}>
                  {save.busy ? "처리하고 있어요" : "저장"}
                </Button>
              </div>
            </form>
          </>
        )}
        {props.logoutFailure ? (
          <section aria-label="로그아웃 결과">
            <Banner
              tone="danger"
              detail={props.logoutFailure.traceId ? `추적 ID: ${props.logoutFailure.traceId}` : undefined}
              actions={
                <Button kind="secondary" disabled={actionPending} onClick={props.onLogout}>
                  다시 시도
                </Button>
              }
            >
              {props.logoutFailure.message}
            </Banner>
          </section>
        ) : null}
        <Button kind="secondary" disabled={actionPending} onClick={props.onLogout}>
          로그아웃
        </Button>
      </div>
    </OwnerLayout>
  );
}
