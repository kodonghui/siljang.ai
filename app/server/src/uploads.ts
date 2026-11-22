/**
 * 사진 올리기(TASK-022; 06 API-007·DEC-09·DEC-16·DEC-02, 04 SPEC-002·004·053·SPEC-068 [입력], 설계 재검토 M18·RD-18).
 *
 * 흐름(06 DEC-09): 사장님이 사진 한 장을 먼저 올려 uploadId를 받고, 1시간 안에 그 ID를 명령(가게 등록 API-008, 가격표 도안,
 * 완성 표시 등)에 넣는다. 명령은 checkUploads로 ID들을 보고, promoteUpload로 가게의 영구 위치에 복사한 뒤 자기 기록을 쓰고,
 * 끝나면 discardUpload로 임시 위치를 지운다.
 *
 * 올린 파일은 데이터베이스에 행을 두지 않고 저장소의 임시 위치 tmp/<사장님 ID>/<uploadId>에 둔다(05를 바꾸지 않음,
 * app/README.md 23).
 * - uploadId = upl_ + 올린 시각(밀리초, 16진수 12자리) + 용도 한 글자(l·d·c) + 무작위 16바이트(base64url 22자).
 *   시각이 앞에 있어 키 순서가 올린 순서이고, 용도가 ID에 있어 저장소 메타데이터 없이 용도를 안다(Supabase Storage의 S3
 *   호환 주소는 사용자 메타데이터를 받지 않음). ID를 바꾸면 키가 달라져 없는 파일이 된다.
 * - 없음·1시간 지남·다른 사장님 것은 모두 같은 upload_not_found(06 DEC-02): 키에 부른 사장님의 ID가 들어 있어 다른 사장님이
 *   올린 ID는 없는 파일과 같고, 1시간은 ID의 시각으로 본다.
 * - 한도(06 DEC-16, RD-18): 사장님마다 1분 30번(rate-limit.ts)과, 1시간 안에 올리고 쓰지 않은 파일 50개(그 사장님의 임시
 *   위치를 셈). 둘 다 동시에 온 요청이 겹치면 조금 넘을 수 있는 느슨한 한도다(남용을 막는 목적, app/README.md 24).
 * - 파일 종류는 파일 이름·Content-Type이 아니라 내용의 시그니처로 본다(JPEG·PNG·WEBP, HEIC는 ftyp 상자의 브랜드).
 * - 저장 위치는 응답·로그에 싣지 않는다(06 DEC-09, G6).
 */
import { declaredOver, readBytesLimited } from "./body";
import { toBase64Url } from "./encoding";
import type { OwnerScope } from "./owner-scope";
import { IMAGE_TYPES, type ImageType, sniffImage as sniffPhotoType } from "./photo-metadata";
import { type NormalizedPhoto, PhotoNormalizationError } from "./photo-normalizer";
import { ApiError, type FieldError, fieldError } from "./problem";
import { UPLOAD_RATE } from "./rate-limit";
import type { OwnerRequest } from "./routes";
import { isUuid } from "./shop-scope";
import { type ObjectStore, StorageUnavailableError } from "./storage";
import { toShopIso } from "./time";

export { IMAGE_TYPES, type ImageType, sniffImage } from "./photo-metadata";

/** 용도(06 UploadForm.purpose). */
export const UPLOAD_PURPOSES = ["license_photo", "design_image", "completion_photo"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

const MIB = 1024 * 1024;

export interface UploadRule {
  /** 가장 큰 크기(바이트). 06의 10MB·20MB는 MiB(05 byte_size의 20971520과 같음). */
  readonly maxBytes: number;
  readonly types: readonly ImageType[];
  /** uploadId에 넣는 한 글자. */
  readonly code: "l" | "d" | "c";
}

/** 용도별 한도(06 API-007·UploadForm, SPEC-002 신고증, SPEC-004 도안, SPEC-053 완성 사진). */
export const UPLOAD_RULES: { readonly [P in UploadPurpose]: UploadRule } = {
  license_photo: { maxBytes: 10 * MIB, types: ["image/jpeg", "image/png", "image/heic"], code: "l" },
  design_image: { maxBytes: 10 * MIB, types: IMAGE_TYPES, code: "d" },
  completion_photo: { maxBytes: 20 * MIB, types: IMAGE_TYPES, code: "c" },
};

/** 올린 파일을 쓸 수 있는 시간(06 DEC-09). */
export const UPLOAD_TTL_MS = 60 * 60 * 1000;

/** 1시간 안에 올리고 아직 쓰지 않은 파일의 한도(06 DEC-16, RD-18). */
export const UNUSED_UPLOAD_LIMIT = 50;

/** 요청 본문의 가장 큰 크기: 가장 큰 용도(20MB)와 multipart 머리·경계의 여유 64KiB. 읽으면서 센다. */
export const MAX_UPLOAD_BODY = 20 * MIB + 64 * 1024;

/** 06 계약의 uploadId 꼴(Upload.uploadId). 이 꼴이 아니면 bad_format, 이 꼴이지만 우리가 낸 ID가 아니면 upload_not_found. */
export const CONTRACT_UPLOAD_ID = /^upl_[A-Za-z0-9_-]{20,200}$/;

const UPLOAD_ID = /^upl_([0-9a-f]{12})([ldc])([A-Za-z0-9_-]{22})$/;
const PURPOSE_OF_CODE: { readonly [code: string]: UploadPurpose } = {
  l: "license_photo",
  d: "design_image",
  c: "completion_photo",
};
const TIME_DIGITS = 12;

export interface ParsedUploadId {
  readonly id: string;
  /** 올린 시각(밀리초). */
  readonly createdAt: number;
  readonly purpose: UploadPurpose;
}

/** 우리가 낸 꼴의 uploadId를 읽는다. 아니면 null. */
export function parseUploadId(id: unknown): ParsedUploadId | null {
  if (typeof id !== "string") return null;
  const m = UPLOAD_ID.exec(id);
  if (m === null) return null;
  const purpose = PURPOSE_OF_CODE[m[2] as string];
  if (purpose === undefined) return null;
  return { id, createdAt: Number.parseInt(m[1] as string, 16), purpose };
}

function timePart(ms: number): string {
  return Math.max(0, Math.floor(ms)).toString(16).padStart(TIME_DIGITS, "0");
}

export function newUploadId(purpose: UploadPurpose, now: Date): string {
  const random = crypto.getRandomValues(new Uint8Array(16));
  return `upl_${timePart(now.getTime())}${UPLOAD_RULES[purpose].code}${toBase64Url(random)}`;
}

function ownerPrefix(owner: OwnerScope): string {
  return `tmp/${owner.ownerId}/`;
}

/** 사장님이 올린 파일의 임시 위치. */
export function tempKey(owner: OwnerScope, uploadId: string): string {
  return `${ownerPrefix(owner)}${uploadId}`;
}

/** 가게의 영구 위치(명령이 가게·사진 행의 저장 위치 컬럼에 씀). */
export function permanentKey(shopId: string, purpose: UploadPurpose, uploadId: string, versionId?: string): string {
  if (!isUuid(shopId)) throw new TypeError("shop id must be a uuid");
  if (versionId !== undefined && !isUuid(versionId)) throw new TypeError("version id must be a uuid");
  return `shops/${shopId.toLowerCase()}/${purpose}/${versionId === undefined ? "" : `${versionId.toLowerCase()}/`}${uploadId}`;
}

export interface UnusedUploads {
  /** 1시간 안에 올리고 아직 쓰지 않은(임시 위치에 남은) 파일 수. */
  readonly count: number;
  /** 한도에 닿았으면 하나가 1시간을 넘길 때까지의 초(1~3600), 아니면 null. */
  readonly retryAfterSeconds: number | null;
}

const LIST_MAX = 1000;

/** 사장님의 쓰지 않은 올린 파일을 센다(06 DEC-16의 50개). 저장소가 답하지 않으면 StorageUnavailableError. */
export async function unusedUploads(store: ObjectStore, owner: OwnerScope, now: Date): Promise<UnusedUploads> {
  const prefix = ownerPrefix(owner);
  const since = now.getTime() - UPLOAD_TTL_MS;
  // 키가 올린 시각 순이라, 1시간 전 시각 뒤의 키만 받는다(지난 파일은 세지 않음).
  const list = await store.list(prefix, `${prefix}upl_${timePart(since)}`, LIST_MAX);
  const times: number[] = [];
  for (const key of list.keys) {
    const parsed = key.startsWith(prefix) ? parseUploadId(key.slice(prefix.length)) : null;
    if (parsed !== null && parsed.createdAt > since) times.push(parsed.createdAt);
  }
  times.sort((a, b) => a - b);
  const count = list.truncated ? Math.max(times.length, LIST_MAX + 1) : times.length;
  if (count < UNUSED_UPLOAD_LIMIT) return { count, retryAfterSeconds: null };
  // 오래된 것부터 지나가므로, 남는 수가 한도 밑이 되는 때: (count - 한도)번째로 오래된 파일이 1시간을 넘길 때
  const oldest = list.truncated ? undefined : times[count - UNUSED_UPLOAD_LIMIT];
  const wait = oldest === undefined ? 3600 : Math.ceil((oldest + UPLOAD_TTL_MS - now.getTime()) / 1000);
  return { count, retryAfterSeconds: Math.min(3600, Math.max(1, wait)) };
}

/** 받은 본문을 multipart로 읽는다. multipart가 아니거나 읽지 못하면 본문 전체(/)의 bad_format. */
async function readForm(req: Request): Promise<FormData> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) throw fieldError("/", "bad_format");
  const bytes = await readBytesLimited(req, MAX_UPLOAD_BODY, () => new ApiError("file_too_large"));
  try {
    return await new Response(bytes, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw fieldError("/", "bad_format");
  }
}

interface UploadInput {
  readonly purpose: UploadPurpose;
  readonly file: File;
}

/** UploadForm(06)을 본다: purpose·file 하나씩, 다른 필드 없음. 어긴 것을 모두 모아 422. */
function uploadInput(form: FormData): UploadInput {
  const errors: FieldError[] = [];
  const add = (field: string, code: FieldError["code"]) => {
    if (!errors.some((e) => e.field === field && e.code === code)) errors.push({ field, code });
  };
  for (const name of new Set(form.keys())) {
    if (name !== "purpose" && name !== "file")
      add(/^[A-Za-z0-9_]{1,100}$/.test(name) ? `/${name}` : "/", "unknown_field");
  }
  let purpose: UploadPurpose | undefined;
  const purposes = form.getAll("purpose");
  const p = purposes[0];
  if (p === undefined) add("/purpose", "required");
  else if (purposes.length > 1) add("/purpose", "too_many");
  else if (typeof p !== "string") add("/purpose", "bad_format");
  else if (!(UPLOAD_PURPOSES as readonly string[]).includes(p)) add("/purpose", "not_allowed");
  else purpose = p as UploadPurpose;
  let file: File | undefined;
  const files = form.getAll("file");
  const f = files[0];
  if (f === undefined) add("/file", "required");
  else if (files.length > 1) add("/file", "too_many");
  else if (typeof f === "string") add("/file", "bad_format");
  else if (f.size === 0) add("/file", "required");
  else file = f;
  if (errors.length > 0 || purpose === undefined || file === undefined) {
    throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  }
  return { purpose, file };
}

/**
 * POST /api/owner/uploads(06 API-007). 차례: 1분 30번(429) → 선언한 길이(413) → 쓰지 않은 파일 50개(429) → 본문을 한도까지
 * 읽고 multipart로(413·422) → UploadForm(422) → 용도별 크기(413) → G10 사진 정리와 용도별 종류 확인(422 /file not_allowed) → 저장(503) → 201.
 * 요청 키는 받지 않는다(다시 올리면 새 uploadId가 하나 더 생길 뿐, 06 DEC-04 밖).
 */
export async function createUpload(r: OwnerRequest): Promise<Response> {
  const { owner, services } = r;
  if (!(await services.limiter(UPLOAD_RATE).limit(`upload:${owner.ownerId}`))) {
    throw new ApiError("rate_limited", { retryAfterSeconds: UPLOAD_RATE.periodSeconds });
  }
  const raw = r.req.raw;
  if (declaredOver(raw, MAX_UPLOAD_BODY)) throw new ApiError("file_too_large");
  const store = services.storage();
  const unused = await unusedUploads(store, owner, services.now());
  if (unused.retryAfterSeconds !== null) {
    throw new ApiError("rate_limited", { retryAfterSeconds: unused.retryAfterSeconds });
  }
  const { purpose, file } = uploadInput(await readForm(raw));
  const rule = UPLOAD_RULES[purpose];
  if (file.size > rule.maxBytes) throw new ApiError("file_too_large");
  const input = new Uint8Array(await file.arrayBuffer());
  const inputType = sniffPhotoType(input);
  if (inputType === null || !rule.types.includes(inputType)) throw fieldError("/file", "not_allowed");
  let photo: NormalizedPhoto | null;
  try {
    photo = await services.photos().fromBytes(input);
  } catch (error) {
    if (!(error instanceof PhotoNormalizationError)) throw error;
    throw new ApiError(error.kind === "too_large" ? "file_too_large" : "storage_unavailable");
  }
  if (photo === null) throw fieldError("/file", "not_allowed");
  if (photo.bytes.byteLength > rule.maxBytes) throw new ApiError("file_too_large");
  const { bytes, contentType } = photo;
  const now = services.now();
  const uploadId = newUploadId(purpose, now);
  await store.put(tempKey(owner, uploadId), bytes, contentType);
  return r.json(
    {
      uploadId,
      purpose,
      contentType,
      byteSize: bytes.byteLength,
      expiresAt: toShopIso(new Date(now.getTime() + UPLOAD_TTL_MS), owner.timeZone),
    },
    201,
  );
}

/** 명령이 받은 올린 파일 ID 하나: 필드(JSON Pointer), 받은 값, 그 필드가 받는 용도. */
export interface UploadRef {
  readonly field: string;
  readonly id: unknown;
  readonly purpose: UploadPurpose;
}

/** 명령이 쓸 올린 파일. 저장 위치(tempKey)는 서버 안에서만 쓴다(응답·로그에 싣지 않음). */
export interface TakenUpload {
  readonly field: string;
  readonly uploadId: string;
  readonly purpose: UploadPurpose;
  readonly contentType: ImageType;
  readonly byteSize: number;
  readonly tempKey: string;
}

/**
 * 명령이 받은 올린 파일 ID들을 한 번에 본다(06 DEC-02·DEC-09, SPEC-068 [입력], 설계 재검토 M18). 쓰기 전에 부른다.
 * - 계약의 꼴(upl_…)이 아님: bad_format. 같은 ID를 두 번 넣음: 뒤의 필드에 duplicate.
 * - 없음·1시간 지남·다른 사장님 것·우리가 내지 않은 ID: 모두 upload_not_found(가리지 않음).
 * - 다른 용도로 올린 것: upload_wrong_purpose.
 * 하나라도 있으면 필드마다 사유를 담은 422 validation_failed. 저장소가 답하지 않으면 StorageUnavailableError(503).
 */
export async function checkUploads(
  store: ObjectStore,
  owner: OwnerScope,
  refs: readonly UploadRef[],
  now: Date,
): Promise<TakenUpload[]> {
  const errors: FieldError[] = [];
  const taken: TakenUpload[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (typeof ref.id !== "string" || !CONTRACT_UPLOAD_ID.test(ref.id)) {
      errors.push({ field: ref.field, code: "bad_format" });
      continue;
    }
    if (seen.has(ref.id)) {
      errors.push({ field: ref.field, code: "duplicate" });
      continue;
    }
    seen.add(ref.id);
    const parsed = parseUploadId(ref.id);
    if (parsed === null || now.getTime() >= parsed.createdAt + UPLOAD_TTL_MS) {
      errors.push({ field: ref.field, code: "upload_not_found" });
      continue;
    }
    const key = tempKey(owner, parsed.id);
    const info = await store.head(key);
    const contentType = IMAGE_TYPES.find((t) => t === info?.contentType);
    if (info === null || contentType === undefined || info.size < 1 || info.size > 20 * MIB) {
      errors.push({ field: ref.field, code: "upload_not_found" });
      continue;
    }
    if (parsed.purpose !== ref.purpose) {
      errors.push({ field: ref.field, code: "upload_wrong_purpose" });
      continue;
    }
    taken.push({
      field: ref.field,
      uploadId: parsed.id,
      purpose: parsed.purpose,
      contentType,
      byteSize: info.size,
      tempKey: key,
    });
  }
  if (errors.length > 0) throw new ApiError("validation_failed", { errors: errors.slice(0, 50) });
  return taken;
}

/**
 * 올린 파일을 가게의 영구 위치(permanentKey)로 복사하고 그 저장 위치를 돌려준다. 명령은 이 값을 자기 행에 쓴다.
 * 그 사이 임시 파일이 없어졌으면 그 필드의 upload_not_found, 저장소가 답하지 않으면 StorageUnavailableError(503).
 * 둘 다 명령이 기록을 쓰기 전이라 아무것도 남지 않는다(06 API-008). 기록을 쓰다 실패하면 명령이 복사본을 지운다.
 */
export async function promoteUpload(
  store: ObjectStore,
  upload: TakenUpload,
  shopId: string,
  versionId?: string,
): Promise<string> {
  const key = permanentKey(shopId, upload.purpose, upload.uploadId, versionId);
  if (!(await store.copy(upload.tempKey, key))) throw fieldError(upload.field, "upload_not_found");
  return key;
}

/**
 * 명령이 기록을 쓴 뒤 임시 파일을 지운다(쓴 파일은 '쓰지 않은 파일'로 세지 않게). 저장소가 답하지 않아도 명령은 성공이다:
 * 남은 임시 파일은 1시간 뒤 세지 않고, 지난 임시 파일은 지난 기록 지우기(TASK-158)가 지운다.
 */
export async function discardUpload(store: ObjectStore, upload: TakenUpload): Promise<void> {
  try {
    await store.delete(upload.tempKey);
  } catch (e) {
    if (!(e instanceof StorageUnavailableError)) throw e;
  }
}
