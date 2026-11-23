import { useEffect, useState } from "react";

const previews = new WeakMap<File, { url: string; users: number }>();
/** 현재 선택과 마지막 성공 그림이 같은 파일이면 주소 하나를 공유한다. 마지막 사용자가 해제한다. */
export function useObjectUrl(file: File | null): string | null {
  const [value, setValue] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") {
      setValue(null);
      return;
    }
    const preview = previews.get(file) ?? { url: URL.createObjectURL(file), users: 0 };
    previews.set(file, preview);
    preview.users++;
    setValue({ file, url: preview.url });
    return () => {
      if (--preview.users === 0) {
        if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(preview.url);
        previews.delete(file);
      }
    };
  }, [file]);
  return value?.file === file ? value.url : null;
}
