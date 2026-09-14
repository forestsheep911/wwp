import path from "node:path";

const HUMAN_REVIEW_REASON = /(ambiguous|conflict|collision|mismatch|multiple_candidates|identity_review)/i;

export function classifyPersonReportAuthorization({
  identityIssues = [],
  danglingPersonIds = [],
  unresolved = [],
  verifiedProfileQualityIssues = []
} = {}) {
  const humanIdentityIssues = identityIssues.filter((item) => HUMAN_REVIEW_REASON.test(String(item?.reason ?? "")));
  const hardIdentityIssues = identityIssues.filter((item) => !humanIdentityIssues.includes(item));
  const humanUnresolved = unresolved.filter((item) => HUMAN_REVIEW_REASON.test(String(item?.reason ?? "")));
  const humanReviewItems = [...humanIdentityIssues, ...humanUnresolved];
  const deferredUnresolved = unresolved.filter((item) => !humanUnresolved.includes(item));
  const hardBlockerCount = hardIdentityIssues.length
    + danglingPersonIds.length
    + verifiedProfileQualityIssues.length;

  return {
    status: hardBlockerCount > 0
      ? "blocked"
      : humanReviewItems.length > 0
        ? "waiting_user"
        : "ready_for_authorized_apply",
    hardBlockerCount,
    hardIdentityIssues,
    humanReviewItems,
    deferredUnresolved,
    explicitTaskAuthorizationRequired: true,
    humanReviewRequired: humanReviewItems.length > 0
  };
}

export function assertAuthorizedPersonPreflight(preflight, reportPath) {
  if (preflight?.status !== "ready_for_authorized_apply") {
    throw new Error(`Person preflight is not ready for authorized apply: ${preflight?.status ?? "missing_status"}.`);
  }
  if (!preflight.reportPath || path.resolve(preflight.reportPath) !== path.resolve(reportPath)) {
    throw new Error("Person preflight does not match the report selected for apply.");
  }
  return true;
}
