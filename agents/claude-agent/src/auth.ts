/**
 * Resolve Anthropic authentication from environment or Claude Code credentials.
 *
 * Priority:
 * 1. ANTHROPIC_API_KEY env var
 * 2. ANTHROPIC_AUTH_TOKEN env var
 * 3. Claude Code OAuth token from ~/.claude/.credentials.json
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface AnthropicAuth {
  apiKey?: string;
  authToken?: string;
  source: string;
}

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string;
    expiresAt?: number;
  };
}

export function resolveAnthropicAuth(): AnthropicAuth | null {
  // 1. Check ANTHROPIC_API_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return { apiKey, source: "ANTHROPIC_API_KEY env var" };
  }

  // 2. Check ANTHROPIC_AUTH_TOKEN
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (authToken) {
    return { authToken, source: "ANTHROPIC_AUTH_TOKEN env var" };
  }

  // 3. Try Claude Code credentials file
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const credPath = join(configDir, ".credentials.json");

  try {
    const raw = readFileSync(credPath, "utf-8");
    const creds: ClaudeCredentials = JSON.parse(raw);
    const token = creds.claudeAiOauth?.accessToken;

    if (!token) {
      return null;
    }

    // Check expiration (warn but don't block — server gives a clear 401)
    const expiresAt = creds.claudeAiOauth?.expiresAt;
    if (expiresAt && expiresAt < Date.now()) {
      console.warn(
        `[ClaudeAgent] WARNING: Claude Code OAuth token expired at ${new Date(expiresAt).toISOString()}. ` +
          `Run Claude Code to refresh it.`
      );
    }

    return { authToken: token, source: `Claude Code credentials (${credPath})` };
  } catch {
    // File doesn't exist or is unreadable
    return null;
  }
}
