/**
 * WebSocket route handlers for agents and spectators.
 * Uses Hono's Bun WebSocket adapter.
 *
 * NOTE: Hono creates a new WSContext wrapper per event callback,
 * so we key our per-connection state on ws.raw (the underlying
 * Bun ServerWebSocket) which IS stable across events.
 */
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { ClientMessageSchema } from "@ai-arena/protocol";
import type { AgentId } from "@ai-arena/protocol";
import type { MatchManager } from "./match-manager.js";
import type { WSContext } from "hono/ws";

/** Metadata stored per agent WebSocket connection */
interface AgentWSData {
  agentId: AgentId | null;
  name: string;
  wsContext: WSContext; // keep a reference to the latest WSContext for sending
}

/** Map from raw ServerWebSocket → agent metadata */
const connectionMap = new Map<object, AgentWSData>();

/** Get a stable key from the WSContext */
function wsKey(ws: WSContext): object {
  return (ws as any).raw;
}

export function createWSRoutes(matchManager: MatchManager): Hono {
  const app = new Hono();

  // ── Agent WebSocket Endpoint ──
  app.get(
    "/agent",
    upgradeWebSocket((c) => ({
      onOpen(_event, ws) {
        console.log("[WS] Agent connection opened");
        connectionMap.set(wsKey(ws), {
          agentId: null,
          name: "",
          wsContext: ws,
        });
      },

      onMessage(event, ws) {
        const key = wsKey(ws);
        const data = connectionMap.get(key);
        if (!data) {
          console.log("[WS] onMessage: unknown connection");
          return;
        }
        // Update WSContext reference (Hono may wrap a new one)
        data.wsContext = ws;

        const raw =
          typeof event.data === "string"
            ? event.data
            : String(event.data);

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          ws.send(
            JSON.stringify({ type: "error", message: "Invalid JSON" })
          );
          return;
        }

        const result = ClientMessageSchema.safeParse(parsed);
        if (!result.success) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Invalid message: ${result.error.issues.map((i) => i.message).join(", ")}`,
            })
          );
          return;
        }

        const msg = result.data;

        switch (msg.type) {
          case "join": {
            if (data.agentId !== null) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Already joined",
                })
              );
              return;
            }

            const assignedId = matchManager.assignAgent(ws, msg.name);
            if (assignedId === null) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Match is full (2 agents max)",
                })
              );
              ws.close();
              return;
            }

            data.agentId = assignedId;
            data.name = msg.name;

            // Try to start match (succeeds when both agents joined)
            matchManager.tryStartMatch();
            break;
          }

          case "action": {
            if (data.agentId === null) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Must join before sending actions",
                })
              );
              return;
            }

            matchManager.receiveAction(
              data.agentId,
              msg.action,
              msg.round
            );
            break;
          }
        }
      },

      onClose(_event, ws) {
        const key = wsKey(ws);
        const data = connectionMap.get(key);
        if (data?.agentId !== null && data?.agentId !== undefined) {
          matchManager.handleDisconnect(data.agentId);
        }
        connectionMap.delete(key);
        console.log("[WS] Agent connection closed");
      },
    }))
  );

  // ── Spectator WebSocket Endpoint ──
  app.get(
    "/spectator",
    upgradeWebSocket((c) => ({
      onOpen(_event, ws) {
        matchManager.addSpectator(ws);
      },
      onClose(_event, ws) {
        matchManager.removeSpectator(ws);
      },
      onMessage() {
        // Spectators don't send messages
      },
    }))
  );

  return app;
}
