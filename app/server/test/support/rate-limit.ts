import type { RateLimiter } from "../../src/rate-limit";

/** 시험용 메모리 한도: 키마다 limit번까지 true. reset()으로 다음 기간(Workers 바인딩의 기간은 Cloudflare가 셈). */
export class MemoryLimiter implements RateLimiter {
  readonly #limit: number;
  readonly counts = new Map<string, number>();

  constructor(limit: number) {
    this.#limit = limit;
  }

  async limit(key: string): Promise<boolean> {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n <= this.#limit;
  }

  reset(): void {
    this.counts.clear();
  }
}
