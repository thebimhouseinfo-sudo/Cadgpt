export const CADGPT_WELCOME = `
```text
CadGPT / CG
────────────────────────────────
SESSION   ACTIVE
CONTROL   READY
CAD MCP   ON DEMAND

cadgpt/         command menu
cadgpt/help     usage help
cadgpt/status   session/work status
cadgpt/stop     stop current CadGPT work
────────────────────────────────
```

CadGPT is ready for this chat. Send CAD requests normally; you do not need to call CG or @cadgpt again in this chat.
`.trim();

export const CADGPT_ROOT_MENU = `
```text
CadGPT Commands
────────────────────────────────
1  cadgpt/help     usage help
2  cadgpt/status   session/work status
3  cadgpt/stop     stop current CadGPT work
────────────────────────────────
```
`.trim();

export const CADGPT_HELP = `
# CadGPT Help

Call **CG** (the CadGPT plugin/icon) or type `@cadgpt` once to activate CadGPT for the current chat.

After activation, continue naturally without repeating the plugin or `@cadgpt`.

Examples:

- `drawing nào đang mở`
- `đọc layer của drawing hiện tại`
- `sửa Lisp này`
- `load Lisp vào drawing đang bind`

Control commands:

- `cadgpt/` — command menu
- `cadgpt/help` — usage help
- `cadgpt/status` — session/work status
- `cadgpt/stop` — stop current CadGPT work
`.trim();

export function isBareCadGptLaunch(userTurn: string): boolean {
  const value = userTurn.trim();
  return (
    /^@cadgpt\s*$/i.test(value) ||
    /^(?:cg|cadgpt)\s*$/i.test(value)
  );
}
