/**
 * Resolve Anthropic authentication from environment.
 *
 * Requires ANTHROPIC_API_KEY env var.
 * Claude Code OAuth tokens are NOT supported by the Anthropic API.
 */

export interface AnthropicAuth {
  apiKey: string;
  source: string;
}

export function resolveAnthropicAuth(): AnthropicAuth | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return { apiKey, source: "ANTHROPIC_API_KEY env var" };
  }

  return null;
}
