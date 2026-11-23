import { type FormEvent, useEffect, useRef, useState } from "react";
import type { FieldReason } from "./problems";
import {
  ENTRUSTMENT_TERMS_VERSION,
  LICENSE_PHOTO_MAX_BYTES,
  type RegisteredShop,
  registerShop,
  registrationPayload,
  type UploadedLicensePhoto,
  uploadLicensePhoto,
} from "./registration";
import {
  clearRegistrationDraft,
  EMPTY_REGISTRATION,
  type RegistrationField,
  type RegistrationValues,
  readRegistrationDraft,
  saveRegistrationDraft,
} from "./registration-draft";
import { Banner, Button, CommandStatus, Field, fieldErrorsFor, SetupLayout, TextField } from "./ui";
import { useCommand } from "./useCommand";
import "./registration.css";

const TEXT_FIELDS = [
  ["name", "가게 이름", 40, "text"],
  ["contactPhone", "연락처", 14, "tel"],
  ["businessAddress", "사업장 주소", 200, "text"],
  ["contactEmail", "전자우편주소", 100, "email"],
  ["businessName", "상호", 60, "text"],
  ["representativeName", "대표자", 30, "text"],
  ["businessRegNo", "사업자등록번호", 10, "text"],
  ["mailOrderRegNo", "통신판매업 신고번호", 40, "text"],
  ["foodLicenseNo", "영업 신고 번호", 30, "text"],
] as const;
const POINTERS = [
  ...TEXT_FIELDS.map(([key]) => `/${key}`),
  "/mailOrderAuthority",
  "/mailOrderExemption",
  "/foodBusinessType",
  "/licensePhotoUploadId",
  "/entrustmentConsent",
  "/entrustmentTermsVersion",
];
interface Props {
  readonly ownerId: string;
  readonly onRegistered: () => void;
  readonly onSessionExpired: () => void;
  readonly onHome: () => void;
  readonly onLogout: () => void;
  readonly logoutFailed?: boolean;
}

export function ShopRegistration({ ownerId, onRegistered, onSessionExpired, onHome, onLogout, logoutFailed }: Props) {
  const [values, setValues] = useState<RegistrationValues>(
    () => readRegistrationDraft(ownerId) ?? { ...EMPTY_REGISTRATION },
  );
  const [consent, setConsent] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<string | null>(null);
  const [photoProblem, setPhotoProblem] = useState<string | undefined>();
  const upload = useCommand<File, UploadedLicensePhoto>((input) => uploadLicensePhoto(input));
  const registration = useCommand<Record<string, unknown>, RegisteredShop>((input, key) => registerShop(input, key));
  const busy = upload.busy || registration.busy;
  const formRef = useRef<HTMLFormElement>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const expiredHandled = useRef(false),
    successHandled = useRef(false);
  const uploadFailure = upload.state.kind === "failed" ? upload.state.failure : null;
  const failure = registration.state.kind === "failed" ? registration.state.failure : null;
  const errors = fieldErrorsFor(failure?.fieldErrors ?? [], POINTERS).byField;
  const uploaded = upload.state.kind === "done" ? upload.state.data : null;
  const photoErrors: FieldReason[] = [
    ...(errors.get("/licensePhotoUploadId") ?? []),
    ...(uploadFailure?.fieldErrors.filter((e) => e.field === "/file" || e.field === "/purpose").map((e) => e.code) ??
      []),
  ];
  const uploadBlocked = upload.state.kind === "failed" && upload.state.blockedUntil !== null;

  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (expiredHandled.current || ![uploadFailure, failure].some((f) => f?.outcome === "login")) return;
    expiredHandled.current = true;
    saveRegistrationDraft(ownerId, valuesRef.current);
    onSessionExpired();
  }, [uploadFailure, failure, ownerId, onSessionExpired]);
  useEffect(() => {
    if (registration.state.kind !== "done" || successHandled.current) return;
    successHandled.current = true;
    clearRegistrationDraft();
    onRegistered();
  }, [registration.state, onRegistered]);

  useEffect(() => {
    if (failure?.outcome !== "field" && !photoProblem) return;
    formRef.current
      ?.querySelector<HTMLElement>(
        'input[aria-invalid="true"], textarea[aria-invalid="true"], [role="radiogroup"][aria-invalid="true"] input',
      )
      ?.focus();
  }, [failure, photoProblem]);

  function change(key: RegistrationField, value: string) {
    if (busy) return;
    setValues((previous) => ({ ...previous, [key]: value }));
    registration.reset();
  }
  function selectPhoto(input: File | undefined) {
    if (busy || uploadBlocked || !input) return;
    registration.reset();
    upload.reset();
    setPhotoProblem(undefined);
    setFile(null);
    if (input.size > LICENSE_PHOTO_MAX_BYTES) {
      setPhotoProblem("사진이 너무 커요. 10MB까지 올릴 수 있어요");
      return;
    }
    if (input.size === 0) {
      setPhotoProblem("사진 파일을 확인해 주세요");
      return;
    }
    setFile(input);
    upload.submit(input);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (uploaded === null) {
      setPhotoProblem("신고증 사진을 먼저 올려 주세요");
      return;
    }
    if (Date.parse(uploaded.expiresAt) <= Date.now()) {
      setPhotoProblem("사진의 사용 기한이 지났어요. 다시 올려 주세요");
      upload.reset();
      return;
    }
    setPhotoProblem(undefined);
    registration.submit(registrationPayload(values, uploaded.uploadId, consent));
  }
  const photoNote = photoProblem ?? (uploadFailure ? uploadFailure.message : undefined);
  const reasons = (key: string) => errors.get(`/${key}`);
  return (
    <SetupLayout title="가게 등록">
      <p>가게 정보와 영업 신고증을 등록해 주세요. 운영자가 영업 신고를 확인해요.</p>
      <form ref={formRef} className="registration-form" onSubmit={submit} noValidate>
        <fieldset className="registration-fields" disabled={busy}>
          <legend className="registration-legend">가게와 사업자 정보</legend>
          {TEXT_FIELDS.map(([key, label, max, type]) => (
            <TextField
              key={key}
              pointer={`/${key}`}
              label={label}
              maxLength={max}
              type={type}
              value={values[key]}
              errors={reasons(key)}
              onChange={(e) => change(key, e.currentTarget.value)}
              autoComplete="off"
              help={
                key === "businessRegNo"
                  ? "숫자 10자리를 넣어 주세요"
                  : key === "name"
                    ? `남은 글자 수 ${Math.max(0, 40 - [...values.name].length)}`
                    : ["businessName", "representativeName"].includes(key)
                      ? "등록 뒤에 바꾸려면 증빙 사진과 함께 변경을 요청해요(운영자가 확인한 뒤 바뀜)"
                      : undefined
              }
            />
          ))}
          {values.mailOrderRegNo.trim() ? (
            <TextField
              pointer="/mailOrderAuthority"
              label="통신판매업 신고를 받은 기관"
              value={values.mailOrderAuthority}
              maxLength={40}
              errors={reasons("mailOrderAuthority")}
              onChange={(e) => change("mailOrderAuthority", e.currentTarget.value)}
            />
          ) : (
            <TextField
              pointer="/mailOrderExemption"
              label="통신판매업 신고 면제 사유"
              value={values.mailOrderExemption}
              maxLength={200}
              errors={reasons("mailOrderExemption")}
              onChange={(e) => change("mailOrderExemption", e.currentTarget.value)}
            />
          )}
          <Field
            pointer="/foodBusinessType"
            label="영업 종류"
            errors={reasons("foodBusinessType")}
            help="첫 버전은 영업 신고한 가게만 받아요"
          >
            {(ids) => (
              <div
                id={ids.id}
                role="radiogroup"
                aria-label="영업 종류"
                aria-invalid={ids["aria-invalid"]}
                aria-describedby={ids["aria-describedby"]}
                className="registration-choices"
              >
                <label>
                  <input
                    type="radio"
                    name="foodBusinessType"
                    value="instant_sale_manufacturing"
                    checked={values.foodBusinessType === "instant_sale_manufacturing"}
                    onChange={() => change("foodBusinessType", "instant_sale_manufacturing")}
                  />{" "}
                  즉석판매제조·가공업
                </label>
                <label>
                  <input
                    type="radio"
                    name="foodBusinessType"
                    value="bakery"
                    checked={values.foodBusinessType === "bakery"}
                    onChange={() => change("foodBusinessType", "bakery")}
                  />{" "}
                  제과점영업
                </label>
              </div>
            )}
          </Field>
          <Field
            pointer="/licensePhotoUploadId"
            label="신고증 사진"
            errors={photoErrors}
            note={photoNote}
            help="JPG·PNG·HEIC 한 장, 10MB까지. 이 가게 사장님과 운영자만 봐요."
          >
            {(ids) => (
              <div className="registration-photo">
                <input
                  {...ids}
                  type="file"
                  accept="image/jpeg,image/png,image/heic,.jpg,.jpeg,.png,.heic"
                  disabled={busy || uploadBlocked}
                  onChange={(e) => selectPhoto(e.currentTarget.files?.[0])}
                />
                {file ? <p>{file.name}</p> : null}
                {preview ? <img src={preview} alt="선택한 신고증 사진 미리보기" /> : null}
                {file ? (
                  <Button
                    kind="secondary"
                    disabled={busy || uploadBlocked}
                    onClick={() => {
                      setPhotoProblem(undefined);
                      upload.submit(file);
                    }}
                  >
                    다시 올리기
                  </Button>
                ) : null}
              </div>
            )}
          </Field>
          <Field
            pointer="/entrustmentTermsVersion"
            label="개인정보 처리 위탁·재위탁 조건"
            errors={reasons("entrustmentTermsVersion")}
          >
            {(ids) => (
              <details
                id={ids.id}
                aria-invalid={ids["aria-invalid"]}
                aria-describedby={ids["aria-describedby"]}
                className="registration-terms"
              >
                <summary>조건 펼쳐 읽기 · {ENTRUSTMENT_TERMS_VERSION}</summary>
                <p>현재 서비스는 합성 자료로 시험합니다. 실제 손님 개인정보를 넣지 마세요.</p>
                <p>
                  가게는 상담·견적·주문 관리에 필요한 개인정보 처리를 실장님에 위탁합니다. 실장님은 이 목적 안에서만
                  처리하며, 다른 목적으로 이용하거나 제공하지 않습니다.
                </p>
                <p>
                  AI 처리는 Anthropic 또는 OpenAI, 서버 처리는 Supabase와 Cloudflare에 재위탁할 수 있습니다. 실제
                  사용하는 회사·국가·이전 항목과 보유 기간은 예약 링크를 내기 전 가게 개인정보 처리방침에 표시합니다.
                  주문자 이름·연락처·입금자 이름과 알레르기 정보는 AI에 보내지 않습니다.
                </p>
                <p>
                  실장님은 접근 통제 등 안전 조치를 적용하고, 재위탁 변경과 개인정보 사고를 가게에 알립니다. 가게는 처리
                  현황의 확인과 점검을 요청할 수 있습니다. 계약이 끝나면 법령상 보관이 필요한 기록을 제외한 위탁 자료를
                  반환하거나 지웁니다.
                </p>
              </details>
            )}
          </Field>
          <Field
            pointer="/entrustmentConsent"
            label="위탁 조건 동의"
            errors={reasons("entrustmentConsent")}
            note={
              failure?.code === "consent_required"
                ? "개인정보 처리 위탁 조건에 동의해야 가게를 등록할 수 있어요"
                : undefined
            }
          >
            {(ids) => (
              <label className="registration-consent">
                <input
                  {...ids}
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => {
                    setConsent(e.currentTarget.checked);
                    registration.reset();
                  }}
                />{" "}
                개인정보 처리 위탁·재위탁 조건을 읽고 동의합니다.
              </label>
            )}
          </Field>
        </fieldset>
        <CommandStatus
          state={upload.state}
          fields={["/file", "/purpose"]}
          done={() => "사진을 올렸어요. 1시간 안에 등록해 주세요"}
          onRetry={() => upload.retry()}
        />
        {failure?.code === "already_registered" ? (
          <Banner tone="warning" actions={<Button onClick={onHome}>할 일 목록으로 이동</Button>}>
            이미 등록한 가게가 있어요
          </Banner>
        ) : (
          <CommandStatus
            state={registration.state}
            fields={POINTERS}
            fieldCodes={["consent_required"]}
            done={() => "가게를 등록했어요. 운영자가 영업 신고를 확인하고 있어요"}
            onRetry={() => registration.retry()}
          />
        )}
        <div className="registration-actions">
          <Button type="submit" busy={busy}>
            등록
          </Button>
          <Button kind="secondary" disabled={busy} onClick={onLogout}>
            로그아웃
          </Button>
        </div>
      </form>
      {logoutFailed ? <p role="alert">로그아웃하지 못했어요. 다시 시도해 주세요</p> : null}
    </SetupLayout>
  );
}
