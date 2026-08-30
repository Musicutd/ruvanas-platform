export const PAID_RUVANAS_SERVICE = "ruvanas-platform";

export const LAUNCH_OPERATOR_CHECKS = Object.freeze([
  Object.freeze({
    id: "CI_ACCEPTANCE_PASSED",
    label: "Approved merge and acceptance evidence",
    description: "Confirm the release commit passed every required GitHub check, including the final retail and School Radio acceptance gate."
  }),
  Object.freeze({
    id: "PAID_DEPLOYMENT_LIVE",
    label: "Paid service deployment is live",
    description: "Confirm the paid ruvanas-platform service is live on the approved merge commit and completed its controlled migration step."
  }),
  Object.freeze({
    id: "PUBLIC_SMOKE_PASSED",
    label: "Non-destructive live smoke passed",
    description: "Confirm the public home and login paths load and protected routes reject unauthorised access without changing customer content."
  }),
  Object.freeze({
    id: "FREE_STAGING_SUSPENDED",
    label: "Free staging web service remains suspended",
    description: "Confirm no release was sent to the free ruvanas-platform-staging web service."
  }),
  Object.freeze({
    id: "BUSINESS_LAUNCH_APPROVED",
    label: "Business and legal launch approval recorded",
    description: "Confirm licensing, privacy, safeguarding, retention, pricing and customer commitments are approved for the intended launch scope."
  })
]);

function finding(severity, code, message) {
  return Object.freeze({ severity, code, message });
}

function currentWebInstance(operational) {
  return operational?.deployment?.instances?.find((instance) => instance.service === "WEB" && instance.state === "CURRENT")
    || operational?.deployment?.instances?.find((instance) => instance.service === "WEB")
    || null;
}

export function launchReadiness({
  operational,
  recovery,
  expectedEnvironment = PAID_RUVANAS_SERVICE
} = {}) {
  const findings = [];
  const environment = operational?.deployment?.environment || null;
  const webInstance = currentWebInstance(operational);
  const commitSha = webInstance?.commitSha || null;
  const activeVersions = Array.isArray(operational?.deployment?.activeVersions)
    ? [...operational.deployment.activeVersions]
    : [];
  const missingServices = Array.isArray(operational?.deployment?.missingServices)
    ? [...operational.deployment.missingServices]
    : [];

  if (!operational) {
    findings.push(finding("CRITICAL", "OPERATIONAL_EVIDENCE_UNAVAILABLE", "Platform health evidence is unavailable."));
  } else {
    if (environment !== expectedEnvironment) {
      findings.push(finding("CRITICAL", "UNAPPROVED_DEPLOYMENT_ENVIRONMENT", `Launch evidence must come from the paid ${expectedEnvironment} service.`));
    }
    if (!commitSha) {
      findings.push(finding("CRITICAL", "DEPLOYMENT_COMMIT_UNAVAILABLE", "The active paid web release does not expose an attributable commit identifier."));
    }
    if (operational.deployment?.mixedVersions) {
      findings.push(finding("CRITICAL", "MIXED_ACTIVE_RELEASES", "Web and worker processes are not running one consistent release."));
    }
    if (missingServices.length > 0) {
      findings.push(finding("CRITICAL", "EXPECTED_SERVICE_MISSING", "One or more required paid-service processes are not reporting a current heartbeat."));
    }
    if (operational.status === "CRITICAL") {
      findings.push(finding("CRITICAL", "PLATFORM_HEALTH_CRITICAL", "Critical operational findings must be resolved before launch sign-off."));
    } else if (operational.status === "ATTENTION") {
      findings.push(finding("WARNING", "PLATFORM_HEALTH_ATTENTION", "Review current operational warnings before launch sign-off."));
    }
  }

  if (!recovery) {
    findings.push(finding("CRITICAL", "RECOVERY_EVIDENCE_UNAVAILABLE", "Backup and recovery evidence is unavailable."));
  } else if (recovery.status === "NOT_READY") {
    findings.push(finding("CRITICAL", "RECOVERY_NOT_READY", "Required backup or recovery controls are not ready."));
  } else if (recovery.status === "ATTENTION") {
    findings.push(finding("WARNING", "RECOVERY_ATTENTION", "Review recovery warnings and overdue evidence before launch sign-off."));
  }

  const status = findings.some((item) => item.severity === "CRITICAL")
    ? "BLOCKED"
    : findings.some((item) => item.severity === "WARNING")
      ? "ATTENTION"
      : "READY_FOR_OPERATOR_SIGN_OFF";

  return Object.freeze({
    status,
    findings,
    deployment: Object.freeze({ environment, expectedEnvironment, commitSha, activeVersions, missingServices }),
    evidence: Object.freeze({
      operationalStatus: operational?.status || "UNAVAILABLE",
      recoveryStatus: recovery?.status || "UNAVAILABLE"
    }),
    operatorChecks: LAUNCH_OPERATOR_CHECKS
  });
}
