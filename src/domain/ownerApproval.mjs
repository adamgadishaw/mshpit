const HEAD_ROLES = new Set(["moderator", "admin"]);

const cleanText = (value, max = 180) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

const CHECK_LABELS = Object.freeze({
  tests: "Automated tests",
  syntax: "Syntax validation",
  architecture: "Architecture checks",
  web_build: "Production web build",
  dependency_audit: "Dependency audit",
  runtime_readiness: "Runtime readiness",
});

export function ownerApprovalPresentation(review) {
  const request = review?.request;
  const payload = review?.payload;
  if (!request || !payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  const common = {
    id: cleanText(request.id, 80),
    kind: cleanText(request.kind, 80),
    summary: cleanText(request.summary),
    expiresAt: Number(request.expiresAt) || null,
  };

  if (request.kind === "privileged_role_change") {
    const currentRole = cleanText(payload.expectedRole, 20).toLowerCase();
    const requestedRole = cleanText(payload.requestedRole, 20).toLowerCase();
    const currentHandle = cleanText(payload.expectedHandle, 40).replace(/^@+/, "");
    const requestedHandle = cleanText(payload.requestedHandle, 40).replace(/^@+/, "");
    if (!currentHandle || !requestedHandle || !requestedRole || !HEAD_ROLES.has(currentRole) && !HEAD_ROLES.has(requestedRole)) return null;
    return {
      ...common,
      eyebrow: "PRIVILEGED ACCESS",
      title: `Change @${currentHandle} to ${requestedRole}?`,
      explanation: "This changes who can moderate members or administer Mshpit. Nothing has changed yet.",
      details: [
        { label: "Account", value: `@${currentHandle}` },
        { label: "Current role", value: currentRole || "unknown" },
        { label: "Requested role", value: requestedRole },
        ...(requestedHandle !== currentHandle ? [{ label: "Requested username", value: `@${requestedHandle}` }] : []),
      ],
      approveLabel: "APPROVE ROLE CHANGE",
    };
  }

  if (request.kind === "security_release") {
    const category = cleanText(payload.category, 40).replaceAll("_", " ");
    const commit = cleanText(payload.commit, 64);
    const checks = Array.isArray(payload.checks)
      ? payload.checks.map((check) => CHECK_LABELS[check]).filter(Boolean)
      : [];
    if (!category || !checks.length) return null;
    return {
      ...common,
      eyebrow: "SECURITY STAMP",
      title: category === "security audit" ? "Approve this security audit stamp?" : "Approve this security update stamp?",
      explanation: "This records an Owner-reviewed security receipt. It does not deploy code or change the live site by itself.",
      details: [
        { label: "Type", value: category },
        { label: "Release", value: commit || "unreleased" },
        { label: "Completed checks", value: checks.join(" / ") },
      ],
      approveLabel: "APPROVE SECURITY STAMP",
    };
  }

  return null;
}

export function ownerApprovalRemaining(expiresAt, now = Date.now()) {
  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= 0) return { expired: false, minutes: null };
  const remaining = expiry - Number(now);
  if (remaining <= 0) return { expired: true, minutes: 0 };
  return { expired: false, minutes: Math.max(1, Math.ceil(remaining / 60_000)) };
}
