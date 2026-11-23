import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type UploadedDesign, uploadDesignImage } from "./price-list-api";
import type { DesignForm } from "./price-list-form";
import type { FieldReason } from "./problems";
import { Button, CommandStatus, Field } from "./ui";
import { useObjectUrl } from "./useObjectUrl";
import { usePhotoUpload } from "./usePhotoUpload";

export interface DesignImageProps {
  readonly design: DesignForm;
  readonly pointer: string;
  readonly disabled: boolean;
  readonly errors?: readonly FieldReason[] | undefined;
  readonly discardEpoch: number;
  readonly onSessionExpired: () => void;
  readonly onStart: (key: string) => boolean;
  readonly onBusy: (key: string, busy: boolean) => void;
  readonly onUploaded: (key: string, value: UploadedDesign) => void;
}
export function DesignImage(props: DesignImageProps) {
  const photo = usePhotoUpload(props.onSessionExpired, uploadDesignImage),
    callbacks = useRef(props);
  callbacks.current = props;
  const handled = useRef<UploadedDesign | null>(null),
    previousEpoch = useRef(props.discardEpoch);
  const [acceptedFile, setAcceptedFile] = useState<File | null>(null),
    [rejectedFile, setRejectedFile] = useState<File | null>(null),
    [failedSrc, setFailedSrc] = useState<string | null>(null);
  // 마지막으로 올린 그림은 다음 파일 선택이 실패해도 유지한다. 현재 선택의 미리보기와 수명이 다르다.
  const acceptedPreview = useObjectUrl(acceptedFile);
  const failure = photo.upload.state.kind === "failed" ? photo.upload.state.failure : null;
  const blocked = photo.upload.state.kind === "failed" && photo.upload.state.blockedUntil !== null;
  useLayoutEffect(() => {
    props.onBusy(props.design.key, photo.upload.busy);
    return () => props.onBusy(props.design.key, false);
  }, [props.design.key, props.onBusy, photo.upload.busy]);
  useEffect(() => {
    if (photo.upload.state.kind !== "done" || handled.current === photo.upload.state.data) return;
    handled.current = photo.upload.state.data;
    setAcceptedFile(photo.file);
    setRejectedFile(null);
    callbacks.current.onUploaded(callbacks.current.design.key, photo.upload.state.data);
  }, [photo.upload.state, photo.file]);
  useEffect(() => {
    if (previousEpoch.current === props.discardEpoch) return;
    previousEpoch.current = props.discardEpoch;
    setRejectedFile(photo.file);
    setAcceptedFile(null);
    photo.upload.reset();
  }, [props.discardEpoch, photo.file, photo.upload.reset]);
  const previous = acceptedPreview ?? (props.design.imageUrl || null);
  const rejected = rejectedFile !== null && rejectedFile === photo.file;
  const src = failure || photo.problem || rejected ? previous : (photo.preview ?? previous);
  const previewFailed = src !== null && src === failedSrc;
  const errors = [
    ...(props.errors ?? []),
    ...(failure?.fieldErrors.filter((e) => ["/file", "/purpose"].includes(e.field)).map((e) => e.code) ?? []),
  ];
  return (
    <div className="price-design-image">
      <Field
        pointer={props.pointer}
        label="도안 그림"
        errors={errors}
        note={photo.problem}
        help="JPG·PNG·HEIC 한 장, 10MB까지"
      >
        {(ids) => (
          <input
            {...ids}
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif"
            disabled={props.disabled || blocked}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file || props.disabled || blocked || photo.upload.busy || !props.onStart(props.design.key)) return;
              props.onBusy(props.design.key, photo.select(file));
              event.currentTarget.value = "";
            }}
          />
        )}
      </Field>
      {src && !previewFailed ? (
        <img
          src={src}
          alt={`${props.design.name || "새 도안"} 그림`}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
        />
      ) : null}
      {previewFailed ? <p>이 브라우저에서는 미리보기를 볼 수 없어요. 사진 업로드 결과를 확인해 주세요.</p> : null}
      {photo.file ? <p className="price-file-name">{photo.file.name}</p> : null}
      {photo.upload.busy ? <p role="status">사진을 올리고 있어요</p> : null}
      <CommandStatus
        state={photo.upload.state}
        fields={["/file", "/purpose"]}
        done={() => "사진을 올렸어요. 1시간 안에 저장해 주세요"}
      />
      {rejected ? (
        <p>
          {props.design.sourceDesignId
            ? "새 그림 저장이 거절돼 기존 그림을 유지해요. 원래 파일을 다시 올릴 수 있어요."
            : "새 그림 저장이 거절됐어요. 원래 파일을 다시 올려 주세요."}
        </p>
      ) : null}
      {(failure || photo.problem) && (props.design.sourceDesignId || props.design.uploadId) ? (
        <p>새 그림을 올리지 못해 기존 그림을 유지해요. 다시 올리면 바꿀 수 있어요.</p>
      ) : null}
      {photo.file ? (
        <Button
          disabled={props.disabled || blocked || photo.upload.busy}
          onClick={() => {
            if (props.disabled || blocked || photo.upload.busy || !photo.file || !props.onStart(props.design.key))
              return;
            const started =
              photo.upload.state.kind === "failed" && photo.upload.state.failure.retry !== "none"
                ? photo.upload.retry()
                : photo.upload.submit(photo.file);
            props.onBusy(props.design.key, started);
          }}
        >
          다시 올리기
        </Button>
      ) : null}
    </div>
  );
}
