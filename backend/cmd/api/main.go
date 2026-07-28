package main

import (
	"backend/internal/db"
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

	// Connect to Turso for the budget tool. A failure here is non-fatal: the
	// rest of the site keeps working and budget routes return 503.
	budgetDB, err := db.Open()
	if err != nil {
		log.Error("budget", "Turso unavailable, budget routes disabled", map[string]interface{}{
			"error": err.Error(),
		})
	} else {
		log.Info("budget", "Connected to Turso", nil)
		defer budgetDB.Close()
	}

	// Initialize handlers
	logsHandler := handlers.NewLogsHandler(hub, log)
	webhookHandler := handlers.NewWebhookHandler(log)
	telemetryHandler := handlers.NewTelemetryHandler(log)
	uscisHandler := handlers.NewUSCISHandler(log, uscisPoller)
	budgetHandler := handlers.NewBudgetHandler(log, budgetDB)

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

	// Budget tool routes (protected)
	http.HandleFunc("/api/admin/budget/categories", handlers.AdminOnly(budgetHandler.HandleCategories))
	http.HandleFunc("/api/admin/budget/month", handlers.AdminOnly(budgetHandler.HandleMonth))
	http.HandleFunc("/api/admin/budget/budgets", handlers.AdminOnly(budgetHandler.HandleBudgets))
	http.HandleFunc("/api/admin/budget/networth", handlers.AdminOnly(budgetHandler.HandleNetWorth))
	http.HandleFunc("/api/admin/budget/transactions", handlers.AdminOnly(budgetHandler.HandleTransactions))
	http.HandleFunc("/api/admin/budget/history", handlers.AdminOnly(budgetHandler.HandleHistory))
	http.HandleFunc("/api/admin/budget/suggest", handlers.AdminOnly(budgetHandler.HandleSuggest))

	log.Info("server", "Server starting on :8080", nil)
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Error("server", "Server failed to start", map[string]interface{}{
			"error": err.Error(),
		})
	}
}
