import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateRound,
  evaluateRun,
  sanitizeUiObservation,
  selectStepEvidence,
} from "../scripts/lib/stage0-evidence.mjs";

function record(overrides = {}) {
  return {
    schema_version: 1,
    timestamp: "2026-10-03T06:00:10.000Z",
    runtime_id: "runtime-1",
    event: "admission_completed",
    observation_id: "obs-1",
    logical_session: "logical-A",
    transport_session: "transport-A",
    request_id: "request-A",
    connector_bound: true,
    success: true,
    claimed: true,
    ...overrides,
  };
}

function step(overrides = {}) {
  return {
    expected_event: "admission_completed",
    begin_at: "2026-10-03T06:00:00.000Z",
    end_at: "2026-10-03T06:00:20.000Z",
    ui_observation: { manual_intervention: false },
    ...overrides,
  };
}

function success(logical, event, observation, runtime = "runtime-1") {
  return {
    status: "UNIQUE_SUCCESS",
    reason: "OK",
    evidence: {
      event,
      observation_id: observation,
      runtime_id: runtime,
      logical_session: logical,
      connector_bound: true,
      success: true,
      claimed: true,
    },
  };
}

test("selectStepEvidence accepts exactly one connector-bound completion", () => {
  const result = selectStepEvidence([record()], step());
  assert.equal(result.status, "UNIQUE_SUCCESS");
  assert.equal(result.evidence.logical_session, "logical-A");
});

test("selectStepEvidence rejects zero, competing, failed, and manual-intervention cases", () => {
  assert.equal(selectStepEvidence([], step()).status, "NO_SUCCESS");

  const competing = selectStepEvidence(
    [
      record(),
      record({ observation_id: "obs-2", logical_session: "logical-B" }),
    ],
    step()
  );
  assert.equal(competing.status, "AMBIGUOUS");
  assert.equal(competing.reason, "COMPETING_COMPLETIONS");

  const failed = selectStepEvidence(
    [
      record({
        event: "admission_failed",
        success: false,
        failure_category: "ADMISSION_CALLBACK_FAILED",
      }),
    ],
    step()
  );
  assert.equal(failed.status, "FAILED");

  const manual = selectStepEvidence(
    [record()],
    step({ ui_observation: { manual_intervention: true } })
  );
  assert.equal(manual.status, "FAILED");
  assert.equal(manual.reason, "MANUAL_INTERVENTION");
});

test("identical duplicate observation records are deduplicated but identity gaps fail closed", () => {
  const same = record();
  const deduped = selectStepEvidence([same, { ...same }], step());
  assert.equal(deduped.status, "UNIQUE_SUCCESS");

  for (const mutation of [
    { observation_id: null },
    { runtime_id: null },
    { logical_session: null },
    { connector_bound: false },
  ]) {
    const result = selectStepEvidence([record(mutation)], step());
    assert.equal(result.status, "FAILED");
    assert.equal(result.reason, "IDENTITY_EVIDENCE_INVALID");
  }
});

test("expected runtime and logical identity must match", () => {
  assert.equal(
    selectStepEvidence(
      [record()],
      step({ expected_runtime_id: "runtime-2" })
    ).reason,
    "RUNTIME_MISMATCH"
  );
  assert.equal(
    selectStepEvidence(
      [record()],
      step({ expected_logical_fingerprint: "logical-B" })
    ).reason,
    "LOGICAL_IDENTITY_MISMATCH"
  );
});

test("round passes only for distinct stable A/B identities within one runtime", () => {
  const good = {
    a_admission: success("logical-A", "admission_completed", "a1"),
    b_admission: success("logical-B", "admission_completed", "b1"),
    a_probe: success("logical-A", "session_probe_completed", "a2"),
    b_probe: success("logical-B", "session_probe_completed", "b2"),
  };
  assert.equal(evaluateRound(good).status, "PASS");

  assert.equal(
    evaluateRound({
      ...good,
      b_admission: success("logical-A", "admission_completed", "b1"),
    }).reason,
    "A_B_LOGICAL_IDENTITY_COLLISION"
  );

  assert.equal(
    evaluateRound({
      ...good,
      a_probe: success("logical-C", "session_probe_completed", "a2"),
    }).reason,
    "A_NOT_INDEPENDENTLY_RESUMABLE"
  );

  assert.equal(
    evaluateRound({
      ...good,
      b_probe: success("logical-B", "session_probe_completed", "b2", "runtime-2"),
    }).status,
    "AMBIGUOUS"
  );
});

test("run verdict preserves ambiguity and capability failure", () => {
  const good = {
    a_admission: success("logical-A", "admission_completed", "a1"),
    b_admission: success("logical-B", "admission_completed", "b1"),
    a_probe: success("logical-A", "session_probe_completed", "a2"),
    b_probe: success("logical-B", "session_probe_completed", "b2"),
  };
  assert.equal(evaluateRun([good, good, good]).status, "PASS");
  assert.equal(evaluateRun([], {}).status, "AMBIGUOUS");
  assert.equal(evaluateRun([good], { blocked: true }).status, "AMBIGUOUS");

  const fail = {
    ...good,
    b_admission: success("logical-A", "admission_completed", "b1"),
  };
  assert.equal(evaluateRun([good, fail, good]).status, "FAIL");
});

test("UI observation sanitizer never retains raw URL or arbitrary payload fields", () => {
  const sanitized = sanitizeUiObservation({
    success: true,
    method: "dom-v1",
    adapter_version: "1",
    reference_hash: "abc",
    raw_url: "https://chatgpt.com/c/secret",
    cookie: "SECRET_SENTINEL_COOKIE",
    payload: "SECRET_SENTINEL_PAYLOAD",
    manual_intervention: false,
  });
  const serialized = JSON.stringify(sanitized);
  assert.equal(serialized.includes("chatgpt.com"), false);
  assert.equal(serialized.includes("SECRET_SENTINEL"), false);
  assert.equal(sanitized.reference_hash, "abc");
});
