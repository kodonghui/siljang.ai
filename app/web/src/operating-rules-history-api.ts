import { isOperatingRules, type OperatingRules } from "./operating-rules-api";
import { createVersionHistoryApi } from "./version-history-api";

const api = createVersionHistoryApi(
  "/owner/operating-rules/versions",
  (value: unknown): value is OperatingRules => isOperatingRules(value) && !value.isTemplate,
);
export const fetchOperatingRulesVersions = api.list;
export const fetchOperatingRulesVersion = api.detail;
