package main

import (
	"backend/internal/db"
	"backend/internal/handlers"
	"backend/internal/logger"
	"backend/internal/plaid"
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

	// Plaid is optional in the same way: unconfigured means the /plaid routes
	// report themselves unavailable and manual entry carries on working.
	plaidClient, err := plaid.New()
	if err != nil {
		log.Info("plaid", "Plaid not configured, bank sync disabled", map[string]interface{}{
			"reason": err.Error(),
		})
		plaidClient = nil
	} else {
		log.Info("plaid", "Plaid configured", map[string]interface{}{"env": plaidClient.Env()})
	}

	// Initialize handlers
	logsHandler := handlers.NewLogsHandler(hub, log)
	webhookHandler := handlers.NewWebhookHandler(log)
	telemetryHandler := handlers.NewTelemetryHandler(log)
	uscisHandler := handlers.NewUSCISHandler(log, uscisPoller)
	budgetHandler := handlers.NewBudgetHandler(log, budgetDB)
	plaidHandler := handlers.NewPlaidHandler(log, budgetDB, plaidClient)

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
	http.HandleFunc("/api/admin/budget/meta", handlers.AdminOnly(budgetHandler.HandleMeta))
	http.HandleFunc("/api/admin/budget/month", handlers.AdminOnly(budgetHandler.HandleMonth))
	http.HandleFunc("/api/admin/budget/accounts", handlers.AdminOnly(budgetHandler.HandleAccounts))
	http.HandleFunc("/api/admin/budget/entries", handlers.AdminOnly(budgetHandler.HandleEntries))
	http.HandleFunc("/api/admin/budget/budgets", handlers.AdminOnly(budgetHandler.HandleBudgets))
	http.HandleFunc("/api/admin/budget/goal", handlers.AdminOnly(budgetHandler.HandleGoal))
	http.HandleFunc("/api/admin/budget/history", handlers.AdminOnly(budgetHandler.HandleHistory))
	http.HandleFunc("/api/admin/budget/register", handlers.AdminOnly(budgetHandler.HandleRegister))
	http.HandleFunc("/api/admin/budget/suggest", handlers.AdminOnly(budgetHandler.HandleSuggest))
	http.HandleFunc("/api/admin/budget/reconcile", handlers.AdminOnly(budgetHandler.HandleReconcile))
	http.HandleFunc("/api/admin/budget/reset", handlers.AdminOnly(budgetHandler.HandleReset))
	http.HandleFunc("/api/admin/budget/dump", handlers.AdminOrBackupToken(budgetHandler.HandleDump))

	// Plaid bank sync (protected). Never reachable with the backup token:
	// these routes can move money into the books and mint link tokens.
	http.HandleFunc("/api/admin/budget/plaid/status", handlers.AdminOnly(plaidHandler.HandleStatus))
	http.HandleFunc("/api/admin/budget/plaid/link-token", handlers.AdminOnly(plaidHandler.HandleLinkToken))
	http.HandleFunc("/api/admin/budget/plaid/exchange", handlers.AdminOnly(plaidHandler.HandleExchange))
	http.HandleFunc("/api/admin/budget/plaid/accounts", handlers.AdminOnly(plaidHandler.HandleMapAccount))
	http.HandleFunc("/api/admin/budget/plaid/items", handlers.AdminOnly(plaidHandler.HandleDeleteItem))
	http.HandleFunc("/api/admin/budget/plaid/sync", handlers.AdminOnly(plaidHandler.HandleSync))
	http.HandleFunc("/api/admin/budget/plaid/staged", handlers.AdminOnly(plaidHandler.HandleStaged))
	http.HandleFunc("/api/admin/budget/plaid/accept", handlers.AdminOnly(plaidHandler.HandleAccept))
	http.HandleFunc("/api/admin/budget/plaid/ignore", handlers.AdminOnly(plaidHandler.HandleIgnore))

	// Learning dashboard (protected). Embedded in the binary — see learn.go for
	// why it isn't served from the static bundle.
	http.HandleFunc("/api/admin/learn", handlers.AdminOnly(handlers.HandleLearn))

	log.Info("server", "Server starting on :8080", nil)
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Error("server", "Server failed to start", map[string]interface{}{
			"error": err.Error(),
		})
	}
}
