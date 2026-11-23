import type { FieldReason } from "./problems";
import { LICENSE_PHOTO_MAX_BYTES, uploadLicensePhoto } from "./registration";
import { Button, CommandStatus, Field } from "./ui";
import { usePhotoUpload } from "./usePhotoUpload";

/** 신고증 재제출·증빙·등록은 같은 사진 처리와 서로 다른 명령 상태를 쓴다. */
export function useLicensePhoto(onSessionExpired: () => void, context: "save" | "registration" = "save") {
  const photo = usePhotoUpload(onSessionExpired, uploadLicensePhoto, {
    maxBytes: LICENSE_PHOTO_MAX_BYTES,
    tooLargeText:
      context === "registration"
        ? "사진이 너무 커요. 10MB까지 올릴 수 있어요"
        : "사진이 너무 커요. 10MB(완성 사진은 20MB)까지 올릴 수 있어요",
    missingText: context === "registration" ? "신고증 사진을 먼저 올려 주세요" : "사진을 먼저 올려 주세요",
  });
  return { ...photo, context };
}
export function LicensePhoto({
  photo,
  label,
  pointer,
  errors = [],
  disabled,
  onSelect,
}: {
  readonly photo: ReturnType<typeof useLicensePhoto>;
  readonly label: string;
  readonly pointer: string;
  readonly errors?: readonly FieldReason[] | undefined;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}) {
  const failure = photo.upload.state.kind === "failed" ? photo.upload.state.failure : null;
  const reasons = [
    ...errors,
    ...(failure?.fieldErrors.filter((e) => e.field === "/file" || e.field === "/purpose").map((e) => e.code) ?? []),
  ];
  const blocked = photo.upload.state.kind === "failed" && photo.upload.state.blockedUntil !== null;
  const registering = photo.context === "registration";
  return (
    <div className={registering ? "registration-photo" : "license-photo"}>
      <Field
        pointer={pointer}
        label={label}
        errors={reasons}
        help={registering ? "JPG·PNG·HEIC 한 장, 10MB까지. 이 가게 사장님과 운영자만 봐요." : "JPG·PNG·HEIC, 10MB까지"}
        note={photo.problem}
      >
        {(ids) => (
          <input
            {...ids}
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif"
            disabled={disabled || blocked}
            onChange={(event) => {
              if (disabled || blocked) return;
              onSelect();
              photo.select(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        )}
      </Field>
      {photo.file ? (
        <p className="license-photo__filename">{registering ? photo.file.name : `선택한 파일: ${photo.file.name}`}</p>
      ) : null}
      {photo.preview && !photo.previewFailed ? (
        <img
          className={registering ? undefined : "license-photo__preview"}
          src={photo.preview}
          alt={registering ? "선택한 신고증 사진 미리보기" : `${label} 미리보기`}
          onError={() => photo.setPreviewFailed(true)}
        />
      ) : null}
      {photo.previewFailed ? <p>이 브라우저에서는 미리보기를 볼 수 없어요. 사진 업로드 결과를 확인해 주세요.</p> : null}
      {photo.upload.busy ? <p role="status">사진을 올리고 있어요</p> : null}
      <CommandStatus
        state={photo.upload.state}
        fields={["/file", "/purpose"]}
        done={() =>
          registering ? "사진을 올렸어요. 1시간 안에 등록해 주세요" : "사진을 올렸어요. 1시간 안에 저장해 주세요"
        }
      />
      {photo.file && (registering || !photo.uploaded) && !photo.upload.busy ? (
        <Button
          kind="secondary"
          disabled={disabled || blocked}
          onClick={() => {
            if (disabled || blocked || !photo.file) return;
            onSelect();
            if (photo.upload.state.kind === "failed" && photo.upload.state.failure.retry !== "none")
              photo.upload.retry();
            else photo.upload.submit(photo.file);
          }}
        >
          다시 올리기
        </Button>
      ) : null}
    </div>
  );
}
