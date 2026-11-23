import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResult } from "./api";
import type { Failure } from "./problems";
import { useCommand } from "./useCommand";
import { useObjectUrl } from "./useObjectUrl";

export interface UploadedPhoto {
  readonly uploadId: string;
  readonly expiresAt: string;
}
export function photoRejected(failure: Failure | null, pointer: string): boolean {
  return (
    failure?.code === "storage_unavailable" ||
    Boolean(failure?.fieldErrors.some((e) => e.field === pointer && e.code === "upload_not_found"))
  );
}
/** 사진은 메모리에서만 다루고, 명령이 끝나도 사용자가 다시 올릴 원래 파일을 남긴다. */
export function usePhotoUpload<T extends UploadedPhoto>(
  onSessionExpired: () => void,
  send: (file: File) => Promise<ApiResult<T>>,
  options: { readonly maxBytes?: number; readonly tooLargeText?: string; readonly missingText?: string } = {},
) {
  const [file, setFile] = useState<File | null>(null),
    [problem, setProblem] = useState<string | undefined>();
  const preview = useObjectUrl(file);
  const [previewFailed, setPreviewFailed] = useState(false);
  const callback = useRef(onSessionExpired);
  callback.current = onSessionExpired;
  const upload = useCommand<File, T>((input) => send(input));
  const failure = upload.state.kind === "failed" ? upload.state.failure : null;
  useEffect(() => {
    if (upload.state.kind === "done") setProblem(undefined);
  }, [upload.state]);
  useEffect(() => {
    if (failure?.outcome === "login") callback.current();
  }, [failure]);
  function select(input: File | undefined): boolean {
    if (!input || upload.busy) return false;
    upload.reset();
    setFile(null);
    setPreviewFailed(false);
    setProblem(undefined);
    if (input.size > (options.maxBytes ?? 10 * 1024 * 1024)) {
      setProblem(options.tooLargeText ?? "사진이 너무 커요. 10MB(완성 사진은 20MB)까지 올릴 수 있어요");
      return false;
    }
    if (input.size === 0) {
      setProblem("사진 파일을 확인해 주세요");
      return false;
    }
    setFile(input);
    return upload.submit(input);
  }
  const resetUpload = upload.reset;
  const clear = useCallback(() => {
    resetUpload();
    setFile(null);
    setPreviewFailed(false);
    setProblem(undefined);
  }, [resetUpload]);
  const discardIfRejected = useCallback(
    (error: Failure | null, pointer: string) => {
      if (photoRejected(error, pointer)) resetUpload();
    },
    [resetUpload],
  );
  return {
    upload,
    file,
    problem,
    preview,
    previewFailed,
    setPreviewFailed,
    select,
    clear,
    discardIfRejected,
    needPhoto: () => setProblem(options.missingText ?? "사진을 먼저 올려 주세요"),
    uploaded: upload.state.kind === "done" ? upload.state.data : null,
  };
}
