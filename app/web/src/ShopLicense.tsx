import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { ApiFailure } from "./api";
import { LicensePhoto, useLicensePhoto } from "./LicensePhoto";
import { classify, type Failure } from "./problems";
import {
  type BusinessIdentity,
  fetchShopLicense,
  type IdentityResult,
  type LicenseResult,
  type LicenseShop,
  requestIdentityChange,
  resubmitLicense,
} from "./shop-license-api";
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
import { useCommand } from "./useCommand";
import "./shop-license.css";

export interface ShopLicenseProps {
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
const LICENSE_FIELDS = ["/foodLicenseNo", "/foodBusinessType", "/licensePhotoUploadId"];
const IDENTITY_FIELDS = ["/businessName", "/representativeName", "/businessRegNo", "/evidencePhotoUploadId"];
const NETWORK: ApiFailure = { ok: false, status: 0, problem: null, retryAfterSeconds: null };
const BUSINESS_TYPES = [
  ["instant_sale_manufacturing", "즉석판매제조·가공업"],
  ["bakery", "제과점영업"],
] as const;
const BUSINESS_FIELDS = [
  ["businessName", "새 상호", 60],
  ["representativeName", "새 대표자", 30],
  ["businessRegNo", "새 사업자등록번호", 10],
] as const;
const clock = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );

export function ShopLicense(props: ShopLicenseProps) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const [shop, setShop] = useState<LicenseShop | null>(null);
  const [loading, setLoading] = useState(true),
    [loadFailure, setLoadFailure] = useState<ApiFailure | null>(null);
  const [foodLicenseNo, setFoodLicenseNo] = useState("");
  const [foodBusinessType, setFoodBusinessType] =
    useState<LicenseShop["foodBusinessType"]>("instant_sale_manufacturing");
  const [identityOpen, setIdentityOpen] = useState(false);
  const [identityValues, setIdentityValues] = useState<BusinessIdentity>({
    businessName: "",
    representativeName: "",
    businessRegNo: "",
  });
  const licensePhoto = useLicensePhoto(props.onSessionExpired),
    evidencePhoto = useLicensePhoto(props.onSessionExpired);
  const license = useCommand<Record<string, unknown>, LicenseResult>((body, key) => resubmitLicense(body, key));
  const identity = useCommand<Record<string, unknown>, IdentityResult>((body, key) => requestIdentityChange(body, key));
  const activeLoad = useRef<AbortController | null>(null);
  const licenseForm = useRef<HTMLFormElement>(null),
    identityForm = useRef<HTMLFormElement>(null);
  const handledLicense = useRef<LicenseResult | null>(null),
    handledIdentity = useRef<IdentityResult | null>(null);
  const handledFailure = useRef<Failure | null>(null);
  const licenseFailure = license.state.kind === "failed" ? license.state.failure : null;
  const identityFailure = identity.state.kind === "failed" ? identity.state.failure : null;
  const licenseErrors = fieldErrorsFor(licenseFailure?.fieldErrors ?? [], LICENSE_FIELDS).byField;
  const identityErrors = fieldErrorsFor(identityFailure?.fieldErrors ?? [], IDENTITY_FIELDS).byField;
  const actionPending =
    loading ||
    license.busy ||
    identity.busy ||
    licensePhoto.upload.busy ||
    evidencePhoto.upload.busy ||
    Boolean(props.logoutPending || props.sessionChecking);
  const busy = actionPending || Boolean(props.sessionFailed);

  const reload = useCallback(() => {
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    setLoading(true);
    setLoadFailure(null);
    void fetchShopLicense(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setShop(result.data);
          setFoodLicenseNo(result.data.foodLicenseNo);
          setFoodBusinessType(result.data.foodBusinessType);
          setIdentityOpen(false);
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
    reload();
    return () => activeLoad.current?.abort();
  }, [reload]);
  useEffect(() => {
    if (license.state.kind !== "done" || handledLicense.current === license.state.data) return;
    handledLicense.current = license.state.data;
    setShop(license.state.data.shop);
    setFoodLicenseNo(license.state.data.shop.foodLicenseNo);
    setFoodBusinessType(license.state.data.shop.foodBusinessType);
    licensePhoto.clear();
  }, [license.state, licensePhoto.clear]);
  useEffect(() => {
    if (identity.state.kind !== "done" || handledIdentity.current === identity.state.data) return;
    handledIdentity.current = identity.state.data;
    setShop(identity.state.data.shop);
    setIdentityOpen(false);
    evidencePhoto.clear();
  }, [identity.state, evidencePhoto.clear]);
  useEffect(() => {
    const failure = licenseFailure ?? identityFailure;
    if (!failure || handledFailure.current === failure) return;
    handledFailure.current = failure;
    if (failure.outcome === "login") callbacks.current.onSessionExpired();
    else if (failure.outcome === "no_shop") callbacks.current.onRegisterShop();
    else if (["version_conflict", "invalid_state", "identity_change_pending"].includes(failure.code ?? "")) reload();
    if (failure.code === "storage_unavailable" || failure.fieldErrors.some((e) => e.code === "upload_not_found")) {
      if (failure === licenseFailure) licensePhoto.upload.reset();
      else evidencePhoto.upload.reset();
    }
    if (failure.outcome === "field")
      (failure === licenseFailure ? licenseForm : identityForm).current
        ?.querySelector<HTMLElement>('input[aria-invalid="true"], [role="radiogroup"][aria-invalid="true"] input')
        ?.focus();
  }, [licenseFailure, identityFailure, reload, licensePhoto.upload.reset, evidencePhoto.upload.reset]);

  function submitLicense(event: FormEvent) {
    event.preventDefault();
    if (busy || !shop || shop.licenseStatus !== "on_hold") return;
    if (!licensePhoto.uploaded) {
      licensePhoto.needPhoto();
      return;
    }
    identity.reset();
    license.submit({
      baseRevision: shop.revision,
      foodLicenseNo,
      foodBusinessType,
      licensePhotoUploadId: licensePhoto.uploaded.uploadId,
    });
  }
  function submitIdentity(event: FormEvent) {
    event.preventDefault();
    if (busy || !shop || shop.identityChange?.status === "pending") return;
    if (!evidencePhoto.uploaded) {
      evidencePhoto.needPhoto();
      return;
    }
    license.reset();
    identity.submit({
      baseRevision: shop.revision,
      ...identityValues,
      evidencePhotoUploadId: evidencePhoto.uploaded.uploadId,
    });
  }
  function openIdentity() {
    if (busy || !shop || shop.identityChange?.status === "pending") return;
    const previous = shop.identityChange?.status === "on_hold" ? shop.identityChange : shop;
    setIdentityValues({
      businessName: previous.businessName,
      representativeName: previous.representativeName,
      businessRegNo: previous.businessRegNo,
    });
    license.reset();
    identity.reset();
    evidencePhoto.clear();
    setIdentityOpen(true);
  }
  const status = shop ? { pending: "확인 중", verified: "확인됨", on_hold: "보류" }[shop.licenseStatus] : "";
  const identityChange = shop?.identityChange;
  return (
    <OwnerLayout
      screen="SCR-035"
      title="영업 신고"
      shopName={props.shopName}
      back="/owner/shop"
      busy={busy}
      onNavigate={(href, event) => {
        event.preventDefault();
        if (!busy) props.onNavigate(href);
      }}
    >
      <div className="shop-license">
        {loading ? (
          <>
            <Skeleton label="영업 신고를 불러오고 있어요" />
            <div className="license-photo__skeleton" aria-hidden="true" />
          </>
        ) : null}
        {loadFailure ? (
          <LoadFailure
            failure={classify(loadFailure.status, loadFailure.problem, loadFailure.retryAfterSeconds)}
            onRetry={reload}
            onLogin={props.onSessionExpired}
            onRegisterShop={props.onRegisterShop}
          />
        ) : null}
        {!loading && shop ? (
          <>
            <section aria-label="영업 신고 상태" className="license-section">
              <dl className="license-data">
                <div>
                  <dt>상태</dt>
                  <dd>{status}</dd>
                </div>
                {shop.licenseStatus === "verified" && shop.licenseReviewedAt ? (
                  <div>
                    <dt>확인 시각</dt>
                    <dd>
                      <time dateTime={shop.licenseReviewedAt}>{clock(shop.licenseReviewedAt)}</time>
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>영업 신고 번호</dt>
                  <dd>{shop.foodLicenseNo}</dd>
                </div>
                <div>
                  <dt>영업 종류</dt>
                  <dd>{BUSINESS_TYPES.find(([type]) => type === shop.foodBusinessType)?.[1]}</dd>
                </div>
              </dl>
              {shop.licenseStatus === "pending" ? (
                <p>운영자가 확인하고 있어요. 확인되면 우리 서비스 채널로 알려 드려요</p>
              ) : null}
              {shop.licenseStatus === "on_hold" ? <Banner tone="warning">{shop.licenseHoldReason}</Banner> : null}
              <a
                className="license-document"
                aria-label="신고증 사진 크게 보기"
                href={shop.licensePhotoUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={busy}
                tabIndex={busy ? -1 : undefined}
                onClick={(event) => {
                  if (busy) event.preventDefault();
                }}
              >
                <img src={shop.licensePhotoUrl} alt="신고증 사진" />
                <span>신고증 사진 크게 보기</span>
              </a>
            </section>
            <CommandStatus
              state={license.state}
              fields={LICENSE_FIELDS}
              done={() => "신고증을 다시 올렸어요. 운영자가 다시 확인해요"}
              onRetry={license.retry}
              onReload={reload}
            />
            {shop.licenseStatus === "on_hold" ? (
              <form aria-label="영업 신고 재제출" ref={licenseForm} onSubmit={submitLicense} noValidate>
                <fieldset className="license-form" disabled={busy}>
                  <legend>영업 신고 다시 올리기</legend>
                  <TextField
                    disabled={busy}
                    pointer="/foodLicenseNo"
                    label="영업 신고 번호"
                    value={foodLicenseNo}
                    maxLength={30}
                    errors={licenseErrors.get("/foodLicenseNo")}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      if (!busy) {
                        setFoodLicenseNo(value);
                        license.reset();
                      }
                    }}
                  />
                  <Field pointer="/foodBusinessType" label="영업 종류" errors={licenseErrors.get("/foodBusinessType")}>
                    {(ids) => (
                      <div {...ids} role="radiogroup" aria-label="영업 종류" className="license-business-types">
                        {BUSINESS_TYPES.map(([type, name]) => (
                          <label key={type}>
                            <input
                              type="radio"
                              disabled={busy}
                              name="foodBusinessType"
                              value={type}
                              checked={foodBusinessType === type}
                              onChange={() => {
                                if (!busy) {
                                  setFoodBusinessType(type);
                                  license.reset();
                                }
                              }}
                            />
                            <span>{name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </Field>
                  <LicensePhoto
                    photo={licensePhoto}
                    label="새 신고증 사진"
                    pointer="/licensePhotoUploadId"
                    errors={licenseErrors.get("/licensePhotoUploadId")}
                    disabled={busy}
                    onSelect={license.reset}
                  />
                  <Button kind="primary" type="submit" busy={license.busy} disabled={busy}>
                    신고증 다시 올리기
                  </Button>
                </fieldset>
                <a
                  href="/owner/payment-destination"
                  className="license-link"
                  aria-disabled={busy}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!busy) props.onNavigate("/owner/payment-destination");
                  }}
                >
                  예금주 때문에 보류됐나요? 결제 수단에서 계좌를 바꿔 주세요
                </a>
              </form>
            ) : null}
            <section aria-label="사업자 정보" className="license-section">
              <div className="license-section__title">
                <h2>사업자 정보</h2>
                {!identityOpen ? (
                  <Button
                    kind="secondary"
                    disabled={busy || identityChange?.status === "pending"}
                    onClick={openIdentity}
                  >
                    {identityChange?.status === "on_hold" ? "다시 요청" : "변경 요청"}
                  </Button>
                ) : null}
              </div>
              <p>운영자가 확인한 지금 값입니다. 변경이 반영되기 전까지 이 값을 사용해요.</p>
              <IdentityData value={shop} />
            </section>
            {identityChange ? (
              <section className="license-section" aria-label="최근 사업자 정보 변경 요청">
                <h2>
                  {identityChange.status === "pending"
                    ? "변경 확인 기다림"
                    : identityChange.status === "on_hold"
                      ? "변경 요청 보류"
                      : "변경 반영됨"}
                </h2>
                <IdentityData value={identityChange} />
                <p>
                  요청 시각 <time dateTime={identityChange.requestedAt}>{clock(identityChange.requestedAt)}</time>
                </p>
                {identityChange.holdReason ? <Banner tone="warning">{identityChange.holdReason}</Banner> : null}
              </section>
            ) : null}
            <CommandStatus
              state={identity.state}
              fields={IDENTITY_FIELDS}
              done={(data) =>
                data.outcome === "unchanged" ? "바뀐 것이 없어요" : "변경을 요청했어요. 운영자가 확인하면 바뀌어요"
              }
              onRetry={identity.retry}
              onReload={reload}
            />
            {identityOpen ? (
              <form aria-label="사업자 정보 변경 요청" ref={identityForm} onSubmit={submitIdentity} noValidate>
                <fieldset className="license-form" disabled={busy}>
                  <legend>사업자 정보 변경 요청</legend>
                  {BUSINESS_FIELDS.map(([key, label, max]) => (
                    <TextField
                      disabled={busy}
                      key={key}
                      pointer={`/${key}`}
                      label={label}
                      value={identityValues[key]}
                      maxLength={max}
                      inputMode={key === "businessRegNo" ? "numeric" : undefined}
                      errors={identityErrors.get(`/${key}`)}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        if (!busy) {
                          setIdentityValues((old) => ({
                            ...old,
                            [key]: key === "businessRegNo" ? value.replace(/\D/g, "").slice(0, 10) : value,
                          }));
                          identity.reset();
                        }
                      }}
                    />
                  ))}
                  <LicensePhoto
                    photo={evidencePhoto}
                    label="증빙 사진"
                    pointer="/evidencePhotoUploadId"
                    errors={identityErrors.get("/evidencePhotoUploadId")}
                    disabled={busy}
                    onSelect={identity.reset}
                  />
                  <Button kind="primary" type="submit" busy={identity.busy} disabled={busy}>
                    변경 요청
                  </Button>
                  <Button
                    kind="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (!busy) {
                        setIdentityOpen(false);
                        identity.reset();
                        evidencePhoto.clear();
                      }
                    }}
                  >
                    돌아가기
                  </Button>
                </fieldset>
              </form>
            ) : null}
          </>
        ) : null}
        {props.logoutFailure ? (
          <Banner
            tone="danger"
            detail={props.logoutFailure.traceId ? `추적 ID: ${props.logoutFailure.traceId}` : undefined}
          >
            {props.logoutFailure.message}
          </Banner>
        ) : null}
        <Button
          kind="secondary"
          busy={Boolean(props.logoutPending)}
          disabled={actionPending}
          onClick={() => {
            if (!actionPending) props.onLogout();
          }}
        >
          로그아웃
        </Button>
      </div>
    </OwnerLayout>
  );
}
function IdentityData({ value }: { readonly value: BusinessIdentity }) {
  return (
    <dl className="license-data">
      <div>
        <dt>상호</dt>
        <dd>{value.businessName}</dd>
      </div>
      <div>
        <dt>대표자</dt>
        <dd>{value.representativeName}</dd>
      </div>
      <div>
        <dt>사업자등록번호</dt>
        <dd>{value.businessRegNo.replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3")}</dd>
      </div>
    </dl>
  );
}
