export const CADGPT_WELCOME = [
  "```text",
  "CadGPT / CG",
  "────────────────────────────────",
  "SESSION   READY",
  "WORK      IDLE",
  "CAD MCP   SLEEPING",
  "",
  "cadgpt/         command menu",
  "cadgpt/help     usage help",
  "cadgpt/cad      detect AutoCAD / open CAD launcher",
  "cadgpt/status   session/work status",
  "cadgpt/stop     stop current CadGPT work",
  "────────────────────────────────",
  "```",
  "",
  "CadGPT is ready for this chat. Send CAD requests normally; work and CAD MCP start only when a task needs them.",
].join("\n");

export const CADGPT_ROOT_MENU = [
  "```text",
  "CadGPT Commands",
  "────────────────────────────────",
  "1  cadgpt/cad      detect AutoCAD / CAD workspace launcher",
  "2  cadgpt/help     usage help",
  "3  cadgpt/status   session/work status",
  "4  cadgpt/stop     stop current CadGPT work",
  "────────────────────────────────",
  "```",
].join("\n");

export const CADGPT_HELP = [
  "# CadGPT Help",
  "",
  "Call **CG** (the CadGPT plugin/icon) or type `@cadgpt` once to activate CadGPT for the current chat.",
  "",
  "After activation, continue naturally without repeating the plugin or `@cadgpt`.",
  "",
  "Examples:",
  "",
  "- `drawing nào đang mở`",
  "- `đọc layer của drawing hiện tại`",
  "- `sửa Lisp này`",
  "- `load Lisp vào drawing đang bind`",
  "",
  "Control commands:",
  "",
  "- `cadgpt/` — command menu",
  "- `cadgpt/cad` — detect AutoCAD and open the CAD workspace launcher",
  "- `cadgpt/help` — usage help",
  "- `cadgpt/status` — session/work status",
  "- `cadgpt/stop` — stop current CadGPT work",
].join("\n");

export function isBareCadGptLaunch(userTurn: string): boolean {
  const value = userTurn.trim();
  return (
    /^@cadgpt\s*$/i.test(value) ||
    /^(?:cg|cadgpt)\s*$/i.test(value)
  );
}
