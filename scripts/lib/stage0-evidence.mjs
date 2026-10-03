import fs from "node:fs";
import path from "node:path";

export const STAGE0_SCHEMA_VERSION = 1;
export const SUCCESS_EVENTS = new Set([
  "admission_completed",
  "session_probe_completed",
]);
export const FAILURE_EVENTS = new Set([
  "admission_failed",
  "session_probe_failed",
]);

function isoMs(value) {
  const ms = Date.parse(value ?? "");
  return Number.isFinite(ms) ? ms : NaN;
}

function uniqueRecords(records) {
  const seen = new Set();
  const output = [];
  for (const record of records) {
    const key = [
      record.event,
      record.observation_id,
      record.runtime_id,
      record.logical_session,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(record);
  }
  return output;
}

export function selectStepEvidence(records, step) {
  if (!step || !step.expected_event) {
    return { status: "PREREQUISITE_BLOCKED", reason: "STEP_EXPECTATION_MISSING", records: [] };
  }
  if (step.ui_observation?.manual_intervention === true) {
    return { status: "FAILED", reason: "MANUAL_INTERVENTION", records: [] };
  }

  const begin = isoMs(step.begin_at);
  const end = isoMs(step.end_at);
  if (!Number.isFinite(begin) || !Number.isFinite(end) || end < begin) {
    return { status: "PREREQUISITE_BLOCKED", reason: "INVALID_CAPTURE_WINDOW", records: [] };
  }

  const bounded = uniqueRecords(
    records.filter((record) => {
      const time = isoMs(record.timestamp);
      return Number.isFinite(time) && time >= begin && time <= end;
    })
  );

  const relevantFailureEvent =
    step.expected_event === "admission_completed"
      ? "admission_failed"
      : step.expected_event === "session_probe_completed"
        ? "session_probe_failed"
        : null;

  const failures = bounded.filter(
    (record) => relevantFailureEvent && record.event === relevantFailureEvent
  );
  if (failures.length > 0) {
    return { status: "FAILED", reason: "BACKEND_FAILURE_EVENT", records: failures };
  }

  const candidates = bounded.filter(
    (record) => record.event === step.expected_event && record.success === true
  );

  if (candidates.length === 0) {
    return { status: "NO_SUCCESS", reason: "EXPECTED_COMPLETION_MISSING", records: [] };
  }
  if (candidates.length > 1) {
    return { status: "AMBIGUOUS", reason: "COMPETING_COMPLETIONS", records: candidates };
  }

  const candidate = candidates[0];
  if (
    candidate.schema_version !== STAGE0_SCHEMA_VERSION ||
    !candidate.observation_id ||
    !candidate.runtime_id ||
    !candidate.logical_session ||
    candidate.connector_bound !== true
  ) {
    return { status: "FAILED", reason: "IDENTITY_EVIDENCE_INVALID", records: [candidate] };
  }
  if (
    step.expected_runtime_id &&
    candidate.runtime_id !== step.expected_runtime_id
  ) {
    return { status: "FAILED", reason: "RUNTIME_MISMATCH", records: [candidate] };
  }
  if (
    step.expected_logical_fingerprint &&
    candidate.logical_session !== step.expected_logical_fingerprint
  ) {
    return { status: "FAILED", reason: "LOGICAL_IDENTITY_MISMATCH", records: [candidate] };
  }

  return {
    status: "UNIQUE_SUCCESS",
    reason: "OK",
    records: [candidate],
    evidence: {
      event: candidate.event,
      observation_id: candidate.observation_id,
      runtime_id: candidate.runtime_id,
      logical_session: candidate.logical_session,
      transport_session: candidate.transport_session ?? null,
      request_id: candidate.request_id ?? null,
      connector_bound: true,
      success: true,
      claimed: candidate.claimed === true,
    },
  };
}

function evidenceFor(round, key) {
  const value = round?.[key];
  return value?.status === "UNIQUE_SUCCESS" ? value.evidence : null;
}

export function evaluateRound(round) {
  const keys = ["a_admission", "b_admission", "a_probe", "b_probe"];
  for (const key of keys) {
    const value = round?.[key];
    if (!value) return { status: "AMBIGUOUS", reason: "ROUND_STEP_MISSING", step: key };
    if (value.status === "AMBIGUOUS" || value.status === "NO_SUCCESS" || value.status === "PREREQUISITE_BLOCKED") {
      return { status: "AMBIGUOUS", reason: value.reason, step: key };
    }
    if (value.status !== "UNIQUE_SUCCESS") {
      return { status: "FAIL", reason: value.reason, step: key };
    }
  }

  const aAdmission = evidenceFor(round, "a_admission");
  const bAdmission = evidenceFor(round, "b_admission");
  const aProbe = evidenceFor(round, "a_probe");
  const bProbe = evidenceFor(round, "b_probe");

  const runtimes = new Set([
    aAdmission.runtime_id,
    bAdmission.runtime_id,
    aProbe.runtime_id,
    bProbe.runtime_id,
  ]);
  if (runtimes.size !== 1) {
    return { status: "AMBIGUOUS", reason: "ROUND_RUNTIME_CHANGED" };
  }
  if (aAdmission.logical_session === bAdmission.logical_session) {
    return { status: "FAIL", reason: "A_B_LOGICAL_IDENTITY_COLLISION" };
  }
  if (aProbe.logical_session !== aAdmission.logical_session) {
    return { status: "FAIL", reason: "A_NOT_INDEPENDENTLY_RESUMABLE" };
  }
  if (bProbe.logical_session !== bAdmission.logical_session) {
    return { status: "FAIL", reason: "B_NOT_INDEPENDENTLY_RESUMABLE" };
  }

  return {
    status: "PASS",
    reason: "DISTINCT_STABLE_LOGICAL_SESSIONS",
    runtime_id: aAdmission.runtime_id,
    logical_a: aAdmission.logical_session,
    logical_b: bAdmission.logical_session,
  };
}

export function evaluateRun(rounds, prerequisites = {}) {
  if (prerequisites.blocked === true) {
    return { status: "AMBIGUOUS", reason: "PREREQUISITE_BLOCKED" };
  }
  if (!Array.isArray(rounds) || rounds.length === 0) {
    return { status: "AMBIGUOUS", reason: "NO_ROUNDS" };
  }
  const verdicts = rounds.map(evaluateRound);
  if (verdicts.some((item) => item.status === "AMBIGUOUS")) {
    return { status: "AMBIGUOUS", reason: "MIXED_OR_INCOMPLETE_EVIDENCE", verdicts };
  }
  if (verdicts.some((item) => item.status === "FAIL")) {
    return { status: "FAIL", reason: "CONTROLLED_CAPABILITY_FAILURE", verdicts };
  }
  return { status: "PASS", reason: "ALL_ROUNDS_PASS", verdicts };
}

export function stage0Root(runId, env = process.env) {
  const base =
    env.CADGPT_APPDATA_ROOT ||
    (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "CadGPT") : null);
  if (!base) throw new Error("CADGPT_STAGE0_APPDATA_UNAVAILABLE");
  return path.join(base, "logs", "stage0", runId);
}

export function continuityLogPaths(env = process.env) {
  const base =
    env.CADGPT_APPDATA_ROOT ||
    (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "CadGPT") : null);
  if (!base) throw new Error("CADGPT_STAGE0_APPDATA_UNAVAILABLE");
  return [
    path.join(base, "logs", "continuity.previous.ndjson"),
    path.join(base, "logs", "continuity.ndjson"),
  ];
}

export function readContinuityRecords(env = process.env) {
  const paths = continuityLogPaths(env);
  const records = [];
  let readable = 0;
  for (const filePath of paths) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      readable += 1;
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          records.push(JSON.parse(line));
        } catch {
          // Malformed diagnostics make the bounded evidence unusable rather than
          // being interpreted as success.
          records.push({
            event: "__malformed_record__",
            timestamp: new Date(0).toISOString(),
            malformed: true,
          });
        }
      }
    } catch {
      // Missing segments are handled by the caller.
    }
  }
  return { records, readable_segments: readable, paths };
}

export function sanitizeUiObservation(value) {
  return {
    success: value?.success === true,
    method: typeof value?.method === "string" ? value.method.slice(0, 80) : null,
    adapter_version:
      typeof value?.adapter_version === "string"
        ? value.adapter_version.slice(0, 80)
        : null,
    reference_hash:
      typeof value?.reference_hash === "string"
        ? value.reference_hash.slice(0, 128)
        : null,
    failure_code:
      typeof value?.failure_code === "string"
        ? value.failure_code.slice(0, 80)
        : null,
    manual_intervention: value?.manual_intervention === true,
    started_at: typeof value?.started_at === "string" ? value.started_at : null,
    ended_at: typeof value?.ended_at === "string" ? value.ended_at : null,
  };
}
