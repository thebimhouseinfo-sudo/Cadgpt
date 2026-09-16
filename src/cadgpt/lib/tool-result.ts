export function toolResult(tool: string, data: Record<string, unknown>, summary?: string) {
  const payload = {
    ok: true,
    tool,
    summary: summary ?? `${tool}: ok`,
    data,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function toolError(tool: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const payload = {
    ok: false,
    tool,
    summary: message,
    data: { error: message },
  };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}
