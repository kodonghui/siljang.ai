import { isPriceList } from "./price-list-api";
import { createVersionHistoryApi } from "./version-history-api";

export type { VersionEntry as PriceVersion, VersionList as PriceVersions } from "./version-history-api";
export { parseVersion as priceVersion } from "./version-history-api";

const api = createVersionHistoryApi("/owner/price-list/versions", isPriceList);
export const fetchPriceListVersions = api.list;
export const fetchPriceListVersion = api.detail;
