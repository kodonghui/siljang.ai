import { isPriceList } from "./price-list-api";
import { createVersionHistoryApi } from "./version-history-api";

const api = createVersionHistoryApi("/owner/price-list/versions", isPriceList);
export const fetchPriceListVersions = api.list;
export const fetchPriceListVersion = api.detail;
