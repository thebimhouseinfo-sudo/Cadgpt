#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import {
  readContinuityRecords,
  sanitizeUiObservation,
  selectStepEvidence,
  stage0Root,
} from "./lib/stage0-evidence.mjs";

function args(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      result._.push(item);
      continue;
    }
    const key = item.slice(2).replaceAll("-", "_");
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      i += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function required(value, name) {
  if (!value || typeof value !== "string") {
    throw Object.assign(new Error("missing --" + name), { exitCode: 2 });
  }
  return value;
}

function ensureRun(runId) {
  const root = stage0Root(runId);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function statePath(root) {
  return path.join(root, "state.json");
}

function reportPath(root) {
  return path.join(root, "report.json");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function readState(root) {
  const file = statePath(root);
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error("run not started"), { exitCode: 2 });
  }
  return readJson(file);
}

function writeState(root, state) {
  writeJson(statePath(root), state);
}

function expectation(value) {
  if (value === "admission") return "admission_completed";
  if (value === "probe") return "session_probe_completed";
  throw Object.assign(new Error("--expect must be admission|probe"), { exitCode: 2 });
}

function eventCandidateExists(records, step) {
  const begin = Date.parse(step.begin_at);
  return records.some((record) => {
    const time = Date.parse(record.timestamp ?? "");
    return (
      Number.isFinite(time) &&
      time >= begin &&
      (record.event === step.expected_event ||
        record.event ===
          (step.expected_event === "admission_completed"
            ? "admission_failed"
            : "session_probe_failed"))
    );
  });
}

async function waitForEvidence(step, deadlineMs) {
  while (Date.now() < deadlineMs) {
    const { records, readable_segments } = readContinuityRecords();
    if (readable_segments > 0 && eventCandidateExists(records, step)) {
      return { records, readable_segments };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function main() {
  const parsed = args(process.argv.slice(2));
  const command = parsed._[0];
  const runId = required(parsed.run, "run");
  const root = ensureRun(runId);

  if (command === "start") {
    if (fs.existsSync(statePath(root))) {
      throw Object.assign(new Error("run already exists"), { exitCode: 3 });
    }
    const state = {
      schema_version: 1,
      run_id: runId,
      started_at: new Date().toISOString(),
      open_step: null,
      steps: {},
    };
    writeState(root, state);
    console.log(JSON.stringify({ ok: true, run_id: runId, root }));
    return;
  }

  const state = readState(root);

  if (command === "begin") {
    if (state.open_step) {
      throw Object.assign(new Error("another step is already open"), { exitCode: 4 });
    }
    const stepId = required(parsed.step, "step");
    if (state.steps[stepId]) {
      throw Object.assign(new Error("step id already exists"), { exitCode: 3 });
    }
    const step = {
      step_id: stepId,
      case: required(parsed.case, "case"),
      round: Number(required(parsed.round, "round")),
      chat: required(parsed.chat, "chat"),
      expected_event: expectation(required(parsed.expect, "expect")),
      begin_at: new Date().toISOString(),
      end_at: null,
      ui_observation: null,
      result: null,
    };
    state.steps[stepId] = step;
    state.open_step = stepId;
    writeState(root, state);
    console.log(JSON.stringify({ ok: true, step }));
    return;
  }

  if (command === "wait") {
    const stepId = required(parsed.step, "step");
    const step = state.steps[stepId];
    if (!step || state.open_step !== stepId) {
      throw Object.assign(new Error("step is not open"), { exitCode: 3 });
    }
    const result = await waitForEvidence(step, Date.now() + 120_000);
    if (!result) {
      console.error("stage0 evidence wait timeout");
      process.exitCode = 5;
      return;
    }
    console.log(
      JSON.stringify({
        ok: true,
        provisional: true,
        readable_segments: result.readable_segments,
      })
    );
    return;
  }

  if (command === "end") {
    const stepId = required(parsed.step, "step");
    const step = state.steps[stepId];
    if (!step || state.open_step !== stepId) {
      throw Object.assign(new Error("step is not open"), { exitCode: 3 });
    }
    const uiPath = path.resolve(required(parsed.ui_observation, "ui-observation"));
    const uiObservation = sanitizeUiObservation(readJson(uiPath));
    step.end_at = new Date().toISOString();
    step.ui_observation = uiObservation;

    const { records, readable_segments } = readContinuityRecords();
    if (readable_segments === 0) {
      step.result = {
        status: "PREREQUISITE_BLOCKED",
        reason: "CONTINUITY_LOG_UNREADABLE",
        records: [],
      };
    } else {
      step.result = selectStepEvidence(records, step);
    }

    state.open_step = null;
    writeState(root, state);
    writeJson(path.join(root, stepId + ".json"), {
      schema_version: 1,
      run_id: runId,
      step_id: stepId,
      case: step.case,
      round: step.round,
      chat: step.chat,
      expected_event: step.expected_event,
      ui_observation: uiObservation,
      result: step.result,
    });

    console.log(JSON.stringify({ ok: step.result.status === "UNIQUE_SUCCESS", step: step.result }));
    if (step.result.status === "PREREQUISITE_BLOCKED") process.exitCode = 2;
    else if (step.result.status === "AMBIGUOUS") process.exitCode = 4;
    else if (step.result.status !== "UNIQUE_SUCCESS") process.exitCode = 3;
    return;
  }

  if (command === "report") {
    const steps = Object.values(state.steps).map((step) => ({
      step_id: step.step_id,
      case: step.case,
      round: step.round,
      chat: step.chat,
      expected_event: step.expected_event,
      ui_observation: step.ui_observation,
      result: step.result,
    }));
    const report = {
      schema_version: 1,
      run_id: runId,
      started_at: state.started_at,
      generated_at: new Date().toISOString(),
      open_step: state.open_step,
      steps,
    };
    writeJson(reportPath(root), report);
    console.log(JSON.stringify(report, null, 2));

    if (state.open_step || steps.some((step) => !step.result)) {
      process.exitCode = 4;
    } else if (
      steps.some((step) => step.result.status === "PREREQUISITE_BLOCKED")
    ) {
      process.exitCode = 2;
    } else if (steps.some((step) => step.result.status === "AMBIGUOUS")) {
      process.exitCode = 4;
    } else if (
      steps.some((step) => step.result.status !== "UNIQUE_SUCCESS")
    ) {
      process.exitCode = 3;
    }
    return;
  }

  throw Object.assign(new Error("unknown command"), { exitCode: 2 });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error?.exitCode ?? 3;
});
