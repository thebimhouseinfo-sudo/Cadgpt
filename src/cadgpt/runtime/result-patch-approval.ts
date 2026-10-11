/**
 * Trusted-host boundary for one user-approved stored-result change.
 *
 * No MCP tool is allowed to create/expand these grants: a model-supplied
 * `approved=true` or target field is never proof of human consent.
 * The host approval UI must pass the exact plan through this internal API.
 * Without an authenticated host handoff, result patch tools fail closed.
 */
export interface ApprovedFieldChange {
  field_path: string[];
  expected_previous_value: string | number | boolean | null;
  new_value: string | number | boolean | null;
  record_handle?: string;
}
export interface ApprovedResultPatchScope {
  execution_id: string;
  drawing_anchor: string;
  job_result: string;
  relative_file: string;
  expected_sha256: string;
  updates: ApprovedFieldChange[];
}
interface Grant {
  scope: ApprovedResultPatchScope;
  expires_at: number;
}
const grants = new Map<string, Grant>();
const MAX_AGE_MS = 10 * 60 * 1000;
const SHA = /^[a-f0-9]{64}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const finiteScalar = (v: unknown) =>
  v === null || typeof v === "string" || typeof v === "boolean" ||
  (typeof v === "number" && Number.isFinite(v));

function normalizeChange(change: ApprovedFieldChange): ApprovedFieldChange {
  if (!Array.isArray(change.field_path) || !change.field_path.length ||
      change.field_path.length > 10 ||
      change.field_path.some(x => !/^(?:[A-Za-z_][A-Za-z0-9_-]*|[0-9]+)$/.test(x) ||
        ["__proto__", "prototype", "constructor"].includes(x)) ||
      !finiteScalar(change.expected_previous_value) || !finiteScalar(change.new_value))
    throw new Error("JOB_RESULT_APPROVAL_INVALID_FIELD");
  if (change.field_path.slice(0, -1).some(x => /^[0-9]+$/.test(x)) &&
      (!change.record_handle || !/^[A-Za-z0-9_.-]{1,100}$/.test(change.record_handle)))
    throw new Error("JOB_RESULT_APPROVAL_RECORD_HANDLE_REQUIRED");
  return {
    field_path: [...change.field_path],
    expected_previous_value: change.expected_previous_value,
    new_value: change.new_value,
    ...(change.record_handle ? { record_handle: change.record_handle } : {}),
  };
}

/**
 * Internal entrypoint for a trusted host approval event. This function is
 * intentionally NOT registered as an MCP tool and must not be invoked from
 * a model-supplied text/flag or unauthenticated HTTP request.
 */
export function installTrustedResultPatchApproval(scope: ApprovedResultPatchScope): void {
  if (!KEY.test(scope.execution_id) || !KEY.test(scope.drawing_anchor) ||
      !KEY.test(scope.job_result) || !KEY.test(scope.relative_file) ||
      !SHA.test(scope.expected_sha256) ||
      !Array.isArray(scope.updates) || scope.updates.length === 0 ||
      scope.updates.length > 500)
    throw new Error("JOB_RESULT_APPROVAL_INVALID_SCOPE");
  const updates = scope.updates.map(normalizeChange);
  const paths = updates.map(x => JSON.stringify(x.field_path));
  if (new Set(paths).size !== paths.length)
    throw new Error("JOB_RESULT_APPROVAL_DUPLICATE_FIELD");
  grants.set(scope.execution_id, {
    scope: {
      execution_id: scope.execution_id,
      drawing_anchor: scope.drawing_anchor,
      job_result: scope.job_result,
      relative_file: scope.relative_file,
      expected_sha256: scope.expected_sha256,
      updates,
    },
    expires_at: Date.now() + MAX_AGE_MS,
  });
}

const sameValue = (a: unknown, b: unknown) => Object.is(a, b);
function sameChange(a: ApprovedFieldChange, b: ApprovedFieldChange): boolean {
  return a.field_path.length === b.field_path.length &&
    a.field_path.every((field, i) => field === b.field_path[i]) &&
    (a.record_handle ?? "").toLowerCase() === (b.record_handle ?? "").toLowerCase() &&
    sameValue(a.expected_previous_value, b.expected_previous_value) &&
    sameValue(a.new_value, b.new_value);
}

export function assertTrustedResultPatchApproval(
  requested: ApprovedResultPatchScope
): void {
  const grant = grants.get(requested.execution_id);
  if (!grant || grant.expires_at <= Date.now()) {
    if (grant) grants.delete(requested.execution_id);
    throw new Error("JOB_RESULT_APPROVAL_REQUIRED: trusted user-approved scope is missing or expired");
  }
  const approved = grant.scope;
  if (requested.drawing_anchor !== approved.drawing_anchor ||
      requested.job_result !== approved.job_result ||
      requested.relative_file !== approved.relative_file ||
      requested.expected_sha256 !== approved.expected_sha256 ||
      requested.updates.length !== approved.updates.length ||
      requested.updates.some((item, i) => !sameChange(item, approved.updates[i])))
    throw new Error("JOB_RESULT_SCOPE_DENIED: mutation differs from trusted approved target/fields");
}

export function consumeTrustedResultPatchApproval(executionId: string): void {
  grants.delete(executionId);
}

export function clearTrustedResultPatchApproval(executionId: string): void {
  grants.delete(executionId);
}
