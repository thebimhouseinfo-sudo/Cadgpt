export function isHeaderlessCadConfirmCall(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const request = body as {
    method?: unknown;
    params?: {
      name?: unknown;
    };
  };
  return (
    request.method === "tools/call" &&
    request.params?.name === "cadgpt_cad_confirm"
  );
}

export function extractHeaderlessCadConfirmToken(
  body: unknown
): string | undefined {
  if (!isHeaderlessCadConfirmCall(body)) return undefined;
  const request = body as {
    params?: {
      arguments?: Record<string, unknown>;
    };
  };
  const token = request.params?.arguments?.confirmation_token;
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}
