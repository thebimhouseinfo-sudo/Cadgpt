export const CADGPT_WELCOME = [
  "```text",
  "CadGPT / CG",
  "────────────────────────────────",
  "SESSION   READY",
  "WORK      IDLE",
  "CAD MCP   SLEEPING",
  "",
  "cg/         command menu",
  "cg/list     refresh open drawings",
  "cg/cad      open CAD workspace launcher",
  "cg/status   session / work / CAD status",
  "cg/stop     stop current work",
  "cg/help     usage help",
  "────────────────────────────────",
  "```",
  "",
  "CadGPT is ready for this chat. Send requests naturally; use cg/ when you want the quick command menu.",
].join("\n");

export const CADGPT_ROOT_MENU = [
  "```text",
  "CG Commands",
  "────────────────────────────────",
  "cg/list     refresh open drawing list",
  "cg/cad      open CAD workspace launcher",
  "cg/status   session / work / CAD status",
  "cg/stop     stop current work",
  "cg/help     usage help",
  "────────────────────────────────",
  "```",
  "",
  "For Lisp, Skill, Job, file work, or other tasks, just describe what you want after CadGPT is active.",
].join("\n");

export const CADGPT_HELP = [
  "# CG Help",
  "",
  "Call **CG** (the CadGPT plugin/icon) or type `@cadgpt` once to activate CadGPT for the current chat.",
  "",
  "After activation, continue naturally without repeating CG or `@cadgpt`.",
  "",
  "Quick CLI commands:",
  "",
  "- `cg/` — command menu",
  "- `cg/list` — refresh the drawing list from the latest tray snapshot",
  "- `cg/cad` — open the CAD workspace launcher",
  "- `cg/status` — session / work / CAD status",
  "- `cg/stop` — stop current work",
  "- `cg/help` — usage help",
  "",
  "The fake CLI is not a live-updating UI. If AutoCAD drawings are opened or closed, use `cg/list` to fetch the latest tray snapshot.",
].join("\n");

export function isBareCadGptLaunch(userTurn: string): boolean {
  const value = userTurn.trim();
  return (
    /^@cadgpt\s*$/i.test(value) ||
    /^(?:cg|cadgpt)\s*$/i.test(value)
  );
}
