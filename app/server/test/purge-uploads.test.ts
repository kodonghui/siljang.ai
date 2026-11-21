import { beforeEach, describe, expect, it, vi } from "vitest";
import { purgeUnusedUploads } from "../src/purge-uploads";
import { StorageUnavailableError } from "../src/storage";
import { newUploadId, type UploadPurpose } from "../src/uploads";
import { MemoryStore } from "./support/storage";

const NOW = new Date("2026-11-21T00:00:00Z");
const HOUR = 3_600_000;
const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const CURSOR = "maintenance/purge/tmp-cursor.json";

describe("미사용 임시 업로드 지우기(TASK-158)", () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = new MemoryStore();
  });
  async function upload(age: number, purpose: UploadPurpose = "design_image", owner = OWNER) {
    const key = `tmp/${owner}/${newUploadId(purpose, new Date(NOW.getTime() - age))}`;
    await store.put(key, new Uint8Array([1, 2, 3]), "image/webp");
    return key;
  }
  it("세 용도의 1시간 지난 파일만 지우고 새 파일·영구 사진·알 수 없는 경로는 유지", async () => {
    const expired = await Promise.all([
      upload(HOUR + 1, "license_photo"),
      upload(HOUR, "design_image"),
      upload(HOUR + 2, "completion_photo", OTHER),
    ]);
    const recent = await upload(HOUR - 1);
    const future = await upload(-HOUR);
    const protectedKeys = [
      recent,
      future,
      "shops/a/completion_photo/photo.webp",
      "tmp/unknown/upload.webp",
      `tmp/${OWNER}/old.webp`,
    ];
    for (const key of protectedKeys.slice(2)) await store.put(key, new Uint8Array([4]), "image/webp");
    const result = await purgeUnusedUploads(store, NOW);
    expect(result).toEqual({ scanned: 7, deleted: 3, failed: 0, complete: true });
    for (const key of expired) expect(await store.head(key)).toBeNull();
    for (const key of protectedKeys) expect(await store.head(key)).not.toBeNull();
  });
  it("삭제 실패는 파일을 남기고 다음 날 실행에서 지울 수 있음", async () => {
    const key = await upload(HOUR + 1);
    store.failOn.add("delete");
    expect(await purgeUnusedUploads(store, NOW)).toMatchObject({ deleted: 0, failed: 1, complete: true });
    expect(await store.head(key)).not.toBeNull();
    store.failOn.delete("delete");
    expect(await purgeUnusedUploads(store, new Date(NOW.getTime() + 86_400_000))).toMatchObject({
      deleted: 1,
      failed: 0,
    });
    expect(await store.head(key)).toBeNull();
  });
  it("앞쪽의 새 파일을 반복해 훑지 않고 저장한 다음 위치에서 뒤의 가게 파일로 이어감", async () => {
    const early = await Promise.all([upload(1), upload(2), upload(3), upload(4)]);
    const late = await upload(HOUR + 1, "design_image", OTHER);
    expect(await purgeUnusedUploads(store, NOW, { batch: 2, pages: 1 })).toMatchObject({
      scanned: 2,
      deleted: 0,
      complete: false,
    });
    expect(await purgeUnusedUploads(store, NOW, { batch: 2, pages: 1 })).toMatchObject({
      scanned: 2,
      deleted: 0,
      complete: false,
    });
    expect(await purgeUnusedUploads(store, NOW, { batch: 2, pages: 1 })).toMatchObject({
      scanned: 1,
      deleted: 1,
      complete: true,
    });
    expect(await store.head(late)).toBeNull();
    for (const key of early) expect(await store.head(key)).not.toBeNull();
    // 한 바퀴를 마친 다음에는 앞쪽 파일도 다시 확인한다.
    expect(await purgeUnusedUploads(store, new Date(NOW.getTime() + HOUR))).toMatchObject({
      deleted: 4,
      complete: true,
    });
  });
  it("시간 예산을 쓰면 마지막 확인 위치를 저장하고 나머지는 다음 실행에서 처리", async () => {
    await upload(HOUR + 1);
    await upload(HOUR + 2);
    await upload(HOUR + 3);
    let stopped = false;
    const remove = store.delete.bind(store);
    store.delete = async (key) => {
      await remove(key);
      stopped = true;
    };
    expect(await purgeUnusedUploads(store, NOW, { shouldStop: () => stopped })).toMatchObject({
      scanned: 1,
      deleted: 1,
      complete: false,
    });
    store.delete = remove;
    expect(await purgeUnusedUploads(store, NOW)).toMatchObject({ scanned: 2, deleted: 2, complete: true });
  });
  it("목록 조회가 실패하면 삭제와 진행 위치 변경을 하지 않음", async () => {
    const key = await upload(HOUR + 1);
    store.failOn.add("list");
    await expect(purgeUnusedUploads(store, NOW)).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(await store.head(key)).not.toBeNull();
    expect(await store.head(CURSOR)).toBeNull();
  });
  it("응답 없는 목록 조회를 제한하고 성공한 실행으로 기록하지 않음", async () => {
    store.list = vi.fn(() => new Promise<never>(() => {}));
    await expect(purgeUnusedUploads(store, NOW, { timeoutMs: 20 })).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(store.list).toHaveBeenCalledOnce();
  });
  it("잘못된 저장 위치는 신뢰하지 않고 처음부터 안전하게 다시 훑음", async () => {
    const key = await upload(HOUR + 1);
    await store.put(
      CURSOR,
      new TextEncoder().encode(JSON.stringify({ version: 1, after: "shops/private/file.webp" })),
      "application/json",
    );
    expect(await purgeUnusedUploads(store, NOW)).toMatchObject({ deleted: 1, complete: true });
    expect(await store.head(key)).toBeNull();
  });
});
