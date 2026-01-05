package main

import (
	"backend/internal/handlers"
	"backend/internal/logger"
	"backend/internal/websocket"
	"encoding/json"
	"net/http"
)

func main() {
	// Initialize logger and hub
	log := logger.GetLogger()
	hub := websocket.NewHub()

	// Start WebSocket hub
	go hub.Run()

	// Subscribe logger to hub
	go func() {
		logChan := log.Subscribe()
		for entry := range logChan {
			data, _ := json.Marshal(entry)
			hub.Broadcast(data)
		}
	}()

	// Initialize handlers
	logsHandler := handlers.NewLogsHandler(hub, log)
	webhookHandler := handlers.NewWebhookHandler(log)
	telemetryHandler := handlers.NewTelemetryHandler(log)

	// Routes
	http.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"healthy"}`))
	})

	http.HandleFunc("/api/logs/stream", logsHandler.HandleWebSocket)
	http.HandleFunc("/api/logs", logsHandler.HandleGetLogs)
	http.HandleFunc("/api/webhook", webhookHandler.HandleWebhook)
	http.HandleFunc("/api/telemetry", telemetryHandler.HandleTelemetry)

	log.Info("server", "Server starting on :8080", nil)
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Error("server", "Server failed to start", map[string]interface{}{
			"error": err.Error(),
		})
	}
}
