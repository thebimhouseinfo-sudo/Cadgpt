export const CADGPT_WELCOME = [
  "```text",
  "CadGPT / CG",
  "────────────────────────────────",
  "",
  "CAD",
  "Offline",
  "",
  "────────────────────────────────",
  "",
  "WORKSPACE",
  "AutoCAD đang tắt nên chưa có bản vẽ nào đang mở.",
  "Hãy mở AutoCAD và drawing cần làm việc, sau đó dùng:",
  "",
  "cg/list     cập nhật danh sách drawing và tạo workspace",
  "",
  "────────────────────────────────",
  "",
  "COMMANDS",
  "cg/cl       create Lisp",
  "cg/cj       create Job",
  "cg/job      list registered Jobs",
  "",
  "cg/         xem toàn bộ command",
  "────────────────────────────────",
  "```",
].join("\n");

export const CADGPT_ROOT_MENU = [
  "```text",
  "CG Commands",
  "────────────────────────────────",
  "cg/list     cập nhật drawing / chọn workspace",
  "cg/cl       create Lisp",
  "cg/cj       create Job",
  "cg/job      list registered Jobs",
  "cg/rl       register Lisp folder",
  "cg/rj       register Job folder",
  "cg/il       import Lisp",
  "cg/el       export Lisp",
  "cg/ij       import Job",
  "cg/ej       export Job",
  "cg/mcp      update / develop CAD MCP",
  "cg/help     help",
  "cg/stop     stop current work",
  "cg/         full command menu",
  "────────────────────────────────",
  "```",
].join("\n");

export const CADGPT_HELP = [
  "# CG Help",
  "",
  "Gọi **CG** hoặc dùng `@cadgpt` / `@cg` một lần để kích hoạt CadGPT cho chat hiện tại.",
  "",
  "CadGPT làm việc trên một CAD workspace duy nhất:",
  "`1 work = 1 drawing`.",
  "",
  "Commands:",
  "",
  "- `cg/list` — cập nhật drawing đang mở và chọn workspace",
  "- `cg/cl` — create / repair Lisp",
  "- `cg/cj` — create / repair Job",
  "- `cg/job` — list registered Jobs",
  "- `cg/rl` — register Lisp folder",
  "- `cg/rj` — register Job folder",
  "- `cg/il` — import Lisp",
  "- `cg/el` — export Lisp",
  "- `cg/ij` — import Job",
  "- `cg/ej` — export Job",
  "- `cg/mcp` — update / develop CAD MCP",
  "- `cg/help` — help",
  "- `cg/stop` — stop current work",
  "- `cg/` — full command menu",
  "",
  "Fake CLI không tự cập nhật theo AutoCAD. Dùng `cg/list` sau khi mở hoặc đóng drawing.",
].join("\n");

export function isBareCadGptLaunch(
  userTurn: string,
  invocationSource: "mention" | "plugin" = "mention"
): boolean {
  const value = userTurn
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF\uFFFC]/g, "")
    .trim();

  if (/^@(?:cadgpt|cg)\s*$/i.test(value) || /^(?:\$?cg|\$?cadgpt)\s*$/i.test(value)) {
    return true;
  }

  if (invocationSource !== "plugin") return false;

  // ChatGPT may serialize the connector chip differently from the visible UI.
  // Remove known app-link / mention wrappers, then classify the invocation by
  // whether any real task text remains.
  const remainder = value
    .replace(/\[[^\]]*\]\(app:\/\/[^)]+\)/gi, " ")
    .replace(/app:\/\/[^\s)]+/gi, " ")
    .replace(/@(?:cadgpt|cg)\b/gi, " ")
    .replace(/\$(?:cg|cadgpt)\b/gi, " ")
    .replace(/\b(?:cadgpt|cg)\b/gi, " ")
    .replace(/[\[\](){}<>|:;,_*~`'"-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return remainder.length === 0;
}
