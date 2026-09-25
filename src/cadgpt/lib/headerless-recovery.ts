export function extractHeaderlessCadConfirmToken(
  body: unknown
): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const request = body as {
    method?: unknown;
    params?: {
      name?: unknown;
      arguments?: Record<string, unknown>;
    };
  };
  if (request.method !== "tools/call") return undefined;
  if (request.params?.name !== "cadgpt_cad_confirm") return undefined;
  const token = request.params.arguments?.confirmation_token;
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}
