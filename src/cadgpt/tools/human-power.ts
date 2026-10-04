import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  activateHumanPower,
  currentHumanPower,
  currentToolLease,
  deactivateHumanPower,
} from "../lib/work-registration.js";
import { toolError, toolResult } from "../lib/tool-result.js";
import {
  humanPowerErrorLogPath,
  logHumanPowerStart,
  logHumanPowerStop,
} from "../runtime/human-power.js";

async function restartCadBackendBoundary(): Promise<void> {
  try {
    const { cadUpstream } = await import("../runtime/cad-upstream.js");
    if (cadUpstream.status().enabled || cadUpstream.status().connected) {
      await cadUpstream.deactivate();
    }
  } catch {
    // Human Power state is authoritative even when CAD backend is already absent.
  }
}

export function registerHumanPowerTools(server: McpServer): void {
  server.registerTool(
    "human_power_start",
    {
      title: "Start Human Power",
      description:
        "Enable one-task Human Power for the current work execution after explicit human approval. Human Power bypasses CadGPT policy gates for this execution, including source/runtime development restrictions. It does not survive work stop/release/expiry or a replacement work execution. Source edits under Human Power require an audited fix summary.",
      inputSchema: {
        task: z.string().min(1).max(1000),
        reason: z.string().min(1).max(2000),
        error_description: z.string().min(1).max(6000),
        expected_behavior: z.string().min(1).max(6000),
        human_approved: z.literal(true),
      },
    },
    async ({
      task,
      reason,
      error_description,
      expected_behavior,
      human_approved,
    }) => {
      try {
        if (!human_approved) {
          throw new Error(
            "HUMAN_POWER_REQUIRES_EXPLICIT_HUMAN_APPROVAL"
          );
        }
        const lease = currentToolLease();
        const grant = activateHumanPower({
          task,
          reason,
          errorDescription: error_description,
          expectedBehavior: expected_behavior,
        });
        try {
          const logPath = await logHumanPowerStart(
            lease.workId,
            grant
          );
          await restartCadBackendBoundary();
          return toolResult("human_power_start", {
            active: true,
            grant_id: grant.grantId,
            execution_id: lease.workId,
            task: grant.task,
            activated_at: grant.activatedAt,
            error_log_path: logPath,
            scope:
              "current work execution only; automatically lost on stop/release/expiry/replacement",
            source_mutation_rule:
              "repo source mutations require human_power_fix and are logged with before/after hashes",
          });
        } catch (error) {
          deactivateHumanPower();
          throw error;
        }
      } catch (error) {
        return toolError("human_power_start", error);
      }
    }
  );

  server.registerTool(
    "human_power_status",
    {
      title: "Human Power Status",
      description:
        "Report whether one-task Human Power is active for the current work execution.",
      inputSchema: {},
    },
    async () => {
      try {
        const lease = currentToolLease();
        const grant = currentHumanPower();
        return toolResult("human_power_status", {
          active: Boolean(grant),
          execution_id: lease.workId,
          grant: grant
            ? {
                grant_id: grant.grantId,
                task: grant.task,
                reason: grant.reason,
                error_description: grant.errorDescription,
                expected_behavior: grant.expectedBehavior,
                activated_at: grant.activatedAt,
              }
            : null,
          error_log_path: humanPowerErrorLogPath(),
        });
      } catch (error) {
        return toolError("human_power_status", error);
      }
    }
  );

  server.registerTool(
    "human_power_stop",
    {
      title: "Stop Human Power",
      description:
        "End Human Power for the current task and immediately return this work execution to normal CadGPT behavior. Work stop/release/expiry also clears Human Power automatically.",
      inputSchema: {
        outcome: z.string().min(1).max(6000),
      },
    },
    async ({ outcome }) => {
      try {
        const lease = currentToolLease();
        const grant = currentHumanPower();
        if (!grant) {
          return toolResult("human_power_stop", {
            active: false,
            execution_id: lease.workId,
            already_stopped: true,
          });
        }
        const logPath = await logHumanPowerStop(
          lease.workId,
          grant,
          outcome
        );
        deactivateHumanPower();
        await restartCadBackendBoundary();
        return toolResult("human_power_stop", {
          active: false,
          execution_id: lease.workId,
          grant_id: grant.grantId,
          stopped: true,
          error_log_path: logPath,
        });
      } catch (error) {
        return toolError("human_power_stop", error);
      }
    }
  );
}
