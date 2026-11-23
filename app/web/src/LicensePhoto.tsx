import { useCallback, useEffect, useRef, useState } from "react";
import type { FieldReason } from "./problems";
import { LICENSE_PHOTO_MAX_BYTES, type UploadedLicensePhoto, uploadLicensePhoto } from "./registration";
import { Button, CommandStatus, Field } from "./ui";
import { useCommand } from "./useCommand";

/** 신고증 재제출과 사업자 증빙은 파일/명령을 각각 보관한다. 저장소·브라우저 영구 저장에는 남기지 않는다. */
export function useLicensePhoto(onSessionExpired: () => void) {
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | undefined>();
  const [preview, setPreview] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const callback = useRef(onSessionExpired);
  callback.current = onSessionExpired;
  const upload = useCommand<File, UploadedLicensePhoto>((input) => uploadLicensePhoto(input));
  const failure = upload.state.kind === "failed" ? upload.state.failure : null;
  useEffect(() => {
    if (failure?.outcome === "login") callback.current();
  }, [failure]);
  useEffect(() => {
    setPreviewFailed(false);
    if (!file || typeof URL.createObjectURL !== "function") {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function select(input: File | undefined) {
    if (!input || upload.busy) return;
    upload.reset();
    setFile(null);
    setProblem(undefined);
    if (input.size > LICENSE_PHOTO_MAX_BYTES) {
      setProblem("사진이 너무 커요. 10MB(완성 사진은 20MB)까지 올릴 수 있어요");
      return;
    }
    if (input.size === 0) {
      setProblem("사진 파일을 확인해 주세요");
      return;
    }
    setFile(input);
    upload.submit(input);
  }
  const resetUpload = upload.reset;
  const clear = useCallback(() => {
    resetUpload();
    setFile(null);
    setProblem(undefined);
  }, [resetUpload]);
  function needPhoto() {
    setProblem("사진을 먼저 올려 주세요");
  }
  return {
    upload,
    file,
    problem,
    preview,
    previewFailed,
    setPreviewFailed,
    select,
    clear,
    needPhoto,
    uploaded: upload.state.kind === "done" ? upload.state.data : null,
  };
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
  return (
    <div className="license-photo">
      <Field pointer={pointer} label={label} errors={reasons} help="JPG·PNG·HEIC, 10MB까지" note={photo.problem}>
        {(ids) => (
          <input
            {...ids}
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
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
      {photo.file ? <p className="license-photo__filename">선택한 파일: {photo.file.name}</p> : null}
      {photo.preview && !photo.previewFailed ? (
        <img
          className="license-photo__preview"
          src={photo.preview}
          alt={`${label} 미리보기`}
          onError={() => photo.setPreviewFailed(true)}
        />
      ) : null}
      {photo.previewFailed ? <p>이 브라우저에서는 미리보기를 볼 수 없어요. 사진 업로드 결과를 확인해 주세요.</p> : null}
      {photo.upload.busy ? <p role="status">사진을 올리고 있어요</p> : null}
      <CommandStatus
        state={photo.upload.state}
        fields={["/file", "/purpose"]}
        done={() => "사진을 올렸어요. 1시간 안에 저장해 주세요"}
      />
      {photo.file && !photo.uploaded && !photo.upload.busy ? (
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
