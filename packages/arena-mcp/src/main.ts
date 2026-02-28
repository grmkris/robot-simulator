/**
 * Arena MCP Server — stdio entry point.
 *
 * Run as a standalone MCP server that any Claude Code session can connect to.
 *
 * Usage in Claude Code settings or .claude/settings.json:
 *   {
 *     "mcpServers": {
 *       "ai-arena": {
 *         "command": "bun",
 *         "args": ["run", "<path-to>/packages/arena-mcp/src/main.ts"]
 *       }
 *     }
 *   }
 *
 * Or with npx (if published):
 *   {
 *     "mcpServers": {
 *       "ai-arena": {
 *         "command": "npx",
 *         "args": ["@ai-arena/arena-mcp"]
 *       }
 *     }
 *   }
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createArenaMcpServer } from "./server.js";

const server = createArenaMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);
