const CONTROL_TOOLS = new Set([
  "cadgpt_admission",
  "cadgpt_work_start",
  "cadgpt_work_status",
  "cadgpt_work_stop",
]);

const DISCOVERY_TOOLS = new Set([
  "job_list",
  "job_get",
  "skill_list",
  "skill_get",
  "registry_list",
  "registry_get",
  "library_list",
]);

export type ToolAuthority = "control" | "admission" | "work";

export function toolAuthority(toolName: string): ToolAuthority {
  if (CONTROL_TOOLS.has(toolName)) return "control";
  if (DISCOVERY_TOOLS.has(toolName)) return "admission";
  return "work";
}

export function toolFamily(toolName: string): string {
  if (toolName.startsWith("file_")) return "filesystem";
  if (toolName.startsWith("lisp_")) return "lisp-authoring";
  if (toolName.startsWith("job_")) return "job-authoring";
  if (toolName.startsWith("library_")) return "library";
  if (toolName.startsWith("registry_")) return "registry";
  if (toolName.startsWith("skill_")) return "skills";
  if (toolName.startsWith("observator_")) return "observator";
  if (toolName.startsWith("cad__") || toolName.startsWith("drawing_") || toolName.startsWith("cad_")) {
    return "cad";
  }
  if (toolName.startsWith("cad_mcp_dev_")) return "cad-mcp-dev";
  return "core";
}

export function toolTargetId(args: Record<string, unknown>, family: string): string {
  for (const key of ["drawing_id", "path", "draft_path", "source_path", "library_id", "registry_id"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return family;
}
