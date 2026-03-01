"use client";

import { useEffect, useRef } from "react";
import { useArenaStore } from "@/lib/store";
import type { ServerViewerMessage } from "@/lib/types";

/**
 * Connects to the arena server's spectator WebSocket.
 * Automatically reconnects on disconnect.
 */
export function useMatchSocket(serverUrl: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { setConnected, updateState, setMatchEnd, updateLobby, reset } = useArenaStore();

  useEffect(() => {
    if (!serverUrl) return; // Wait until URL is resolved

    const url = serverUrl; // Capture for closure narrowing
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!unmounted) {
          setConnected(true);
          console.log("[Viewer] Connected to server");
        }
      };

      ws.onmessage = (event) => {
        if (unmounted) return;
        try {
          const msg = JSON.parse(event.data) as ServerViewerMessage;
          if (msg.type === "state") {
            updateState(msg);
          } else if (msg.type === "match_end") {
            setMatchEnd(msg);
          } else if (msg.type === "lobby") {
            updateLobby(msg);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!unmounted) {
          setConnected(false);
          console.log("[Viewer] Disconnected. Reconnecting in 2s...");
          reconnectTimer.current = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      reset();
    };
  }, [serverUrl, setConnected, updateState, setMatchEnd, updateLobby, reset]);
}
