/** 입력한 숫자 표기를 임의로 다른 정수로 바꾸지 않는다. */
export const isIntegerText = (value: string): boolean =>
  /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value));
export const numberOrText = (value: string): number | string => (isIntegerText(value) ? Number(value) : value);
export function changedFields<T, K extends keyof T>(base: T, mine: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {};
  for (const key of keys) if (base[key] !== mine[key]) result[key] = mine[key];
  return result;
}
