import { isInternalJobId } from "./internal-jobs.js";

// Kept as internal compatibility implementations, not competing V5 MCP routes.
export const RETIRED_AUTHORING_TOOLS = new Set([
  "job_draft_new", "job_checkout", "job_draft_validate", "job_promote_draft", "job_run_direct_draft",
  "lisp_checkout", "lisp_draft_validate", "lisp_promote_draft",
  "file_temp_lisp_create", "file_temp_lisp_cleanup",
]);

const CONTROL_TOOLS = new Set([
  "cadgpt_control",
  "cadgpt_admission",
  "cadgpt_cad_confirm",
  "cadgpt_work_start",
  "cadgpt_work_resume",
  "cadgpt_work_status",
  "cadgpt_work_stop",
  "cadgpt_work_upgrade",
]);

const DISCOVERY_TOOLS = new Set([
  "job_list",
  "job_get",
  "job_local_compat_status",
  "skill_list",
  "skill_get",
  "registry_list",
  "registry_get",
  "library_list",
]);

export type ToolAuthority =
  | "control"
  | "session"
  | "work"
  | "work-or-system"
  | "system";

export function toolAuthority(toolName: string): ToolAuthority {
  if (CONTROL_TOOLS.has(toolName)) return "control";
  if (toolName === "job_system_release") return "system";
  if (toolName === "job_system_run_helper") return "work-or-system";
  if (DISCOVERY_TOOLS.has(toolName)) return "session";
  if (toolName.startsWith("file_")) return "work-or-system";
  return "work";
}

export function toolFamily(toolName: string): string {
  if (toolName === "job_runtime_save_now") return "cad";
  if (toolName === "temp_job_lisp_load") return "cad";
  if (toolName.startsWith("temp_job_") || toolName.startsWith("v5_source_")) return "filesystem";
  if (toolName.startsWith("knowledge_")) return "knowledge";
  if (toolName.startsWith("file_")) return "filesystem";
  if (toolName.startsWith("lisp_")) return "lisp-authoring";
  if (toolName.startsWith("job_")) return "job-authoring";
  if (toolName.startsWith("library_") || toolName.startsWith("asset_")) return "library";
  if (toolName.startsWith("registry_")) return "registry";
  if (toolName.startsWith("skill_")) return "skills";
  if (toolName.startsWith("observator_")) return "observator";
  if (toolName.startsWith("cad_mcp_dev_")) return "cad-mcp-dev";
  if (toolName.startsWith("cad__") || toolName.startsWith("drawing_") || toolName.startsWith("cad_")) {
    return "cad";
  }
  return "core";
}

/**
 * Internal Direct Jobs execute bound-CAD operations, even when their public
 * entry point shares the job_run_direct name with User Python Jobs.
 * A CAD-only drawing Work must be able to load TBH; User Direct Jobs keep
 * the ordinary job-authoring FILE/HYBRID capability gate.
 */
export function toolFamilyForInvocation(
  toolName: string,
  args: Record<string, unknown>
): string {
  if (
    toolName === "job_run_direct" &&
    typeof args.id === "string" &&
    isInternalJobId(args.id)
  ) {
    return "cad";
  }
  return toolFamily(toolName);
}

export function toolTargetId(args: Record<string, unknown>, family: string): string {
  for (const key of ["drawing_id", "path", "draft_path", "source_path", "library_id", "registry_id"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return family;
}
