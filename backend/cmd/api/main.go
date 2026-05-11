package main

import (
	"backend/internal/handlers"
	"backend/internal/logger"
	"backend/internal/services"
	"backend/internal/websocket"
	"encoding/json"
	"net/http"
	"time"
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

	// Initialize USCIS poller (polls every 30 minutes)
	uscisPoller := services.NewUSCISPoller(log)
	uscisPoller.Start(30 * time.Minute)

	// Initialize handlers
	logsHandler := handlers.NewLogsHandler(hub, log)
	webhookHandler := handlers.NewWebhookHandler(log)
	telemetryHandler := handlers.NewTelemetryHandler(log)
	uscisHandler := handlers.NewUSCISHandler(log, uscisPoller)

	// Routes
	http.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"healthy"}`))
	})

	http.HandleFunc("/api/logs/stream", logsHandler.HandleWebSocket)
	http.HandleFunc("/api/logs", logsHandler.HandleGetLogs)
	http.HandleFunc("/api/webhook", webhookHandler.HandleWebhook)
	http.HandleFunc("/api/telemetry", telemetryHandler.HandleTelemetry)

	// Admin auth
	http.HandleFunc("/api/admin/auth", handlers.HandleAdminAuth)

	// USCIS admin routes (protected)
	http.HandleFunc("/api/admin/uscis/status", handlers.AdminOnly(uscisHandler.HandleGetStatus))
	http.HandleFunc("/api/admin/uscis/check", handlers.AdminOnly(uscisHandler.HandleCheck))
	http.HandleFunc("/api/admin/uscis/credentials", handlers.AdminOnly(uscisHandler.HandleUpdateCredentials))
	http.HandleFunc("/api/admin/uscis/test-notify", handlers.AdminOnly(uscisHandler.HandleTestNotify))

	log.Info("server", "Server starting on :8080", nil)
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Error("server", "Server failed to start", map[string]interface{}{
			"error": err.Error(),
		})
	}
}
