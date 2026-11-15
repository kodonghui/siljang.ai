import { describe, expect, it } from "vitest";
import { API_BASE, apiUrl, normalizeBase } from "./api";

describe("API 주소", () => {
  it("설정이 없으면 같은 출처의 /api", () => {
    expect(API_BASE).toBe(normalizeBase(import.meta.env.VITE_API_BASE));
    expect(normalizeBase(undefined)).toBe("/api");
    expect(normalizeBase("  ")).toBe("/api");
  });

  it("끝의 /는 떼고 계약 경로를 붙인다", () => {
    expect(normalizeBase("https://api.example.test/api/")).toBe("https://api.example.test/api");
    expect(apiUrl("/owner/session", "/api")).toBe("/api/owner/session");
    expect(apiUrl("/owner/orders", "https://api.example.test/api")).toBe("https://api.example.test/api/owner/orders");
  });

  it("계약 경로는 /로 시작해야 한다", () => {
    expect(() => apiUrl("owner/session", "/api")).toThrow();
  });
});
