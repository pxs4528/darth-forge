import type { Component } from "solid-js";
import { createSignal, onMount, onCleanup, For } from "solid-js";
import { telemetry } from "../services/telemetry";

type LogEntry = {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  service: string;
  message: string;
  data?: Record<string, unknown>;
};

const Logs: Component = () => {
  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [connected, setConnected] = createSignal(false);
  const [paused, setPaused] = createSignal(false);
  let ws: WebSocket | null = null;
  let logContainerRef: HTMLDivElement | undefined;

  const getLevelColor = (level: string) => {
    switch (level) {
      case "info":
        return "text-[#5bff4d]";
      case "warn":
        return "text-yellow-400";
      case "error":
        return "text-red-400";
      case "debug":
        return "text-gray-400";
      default:
        return "text-white";
    }
  };

  const connectWebSocket = () => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/logs/stream`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const entry: LogEntry = JSON.parse(event.data);
        setLogs((prev) => [...prev, entry]);

        // Auto-scroll if not paused
        if (!paused() && logContainerRef) {
          setTimeout(() => {
            if (logContainerRef) {
              logContainerRef.scrollTop = logContainerRef.scrollHeight;
            }
          }, 50);
        }
      } catch (err) {
        console.error("Failed to parse log entry:", err);
      }
    };

    ws.onerror = () => {
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        if (ws?.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
      }, 3000);
    };
  };

  onMount(() => {
    connectWebSocket();
    telemetry.trackPageView("logs");
  });

  onCleanup(() => {
    if (ws) {
      ws.close();
    }
  });

  const clearLogs = () => {
    setLogs([]);
    telemetry.trackClick("logs-clear");
  };

  const togglePause = () => {
    setPaused(!paused());
    telemetry.trackClick("logs-pause", { paused: !paused() });
  };

  return (
    <section id="logs" class="min-h-screen px-4 py-20">
      <div class="max-w-7xl mx-auto">
        <h2 class="text-3xl font-bold text-white mb-8">Live Logs</h2>

        <div class="terminal-window flex flex-col" style="height: calc(100vh - 200px);">
          {/* Header */}
          <div class="flex items-center justify-between p-4 border-b border-gray-700">
            <div class="flex items-center gap-4">
              <span class="text-white font-bold">System Logs</span>
              <span
                class={`text-sm ${
                  connected() ? "text-[#5bff4d]" : "text-red-400"
                }`}
              >
                {connected() ? "● Connected" : "● Disconnected"}
              </span>
            </div>
            <div class="flex gap-2">
              <button
                onClick={togglePause}
                class={`px-3 py-1 text-sm transition-colors ${
                  paused()
                    ? "bg-yellow-500 text-black"
                    : "border border-white text-white hover:bg-white/20"
                }`}
              >
                {paused() ? "Resume" : "Pause"}
              </button>
              <button
                onClick={clearLogs}
                class="px-3 py-1 text-sm border border-white text-white hover:bg-white/20 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Log content */}
          <div
            ref={logContainerRef}
            class="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-xs"
          >
            <For each={logs()}>
              {(log) => (
                <div class="flex gap-2">
                  <span class="text-gray-500 shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span class={`${getLevelColor(log.level)} shrink-0 w-12`}>
                    [{log.level.toUpperCase()}]
                  </span>
                  <span class="text-blue-400 shrink-0">[{log.service}]</span>
                  <span class="text-white">{log.message}</span>
                  {log.data && (
                    <span class="text-gray-400">
                      {JSON.stringify(log.data)}
                    </span>
                  )}
                </div>
              )}
            </For>
            {logs().length === 0 && (
              <div class="text-gray-500 text-center py-8">
                No logs yet. Waiting for events...
              </div>
            )}
          </div>

          {/* Footer stats */}
          <div class="p-2 border-t border-gray-700 text-gray-500 text-xs">
            Total logs: {logs().length} {paused() && "(Paused)"}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Logs;
