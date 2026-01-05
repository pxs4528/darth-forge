package handlers

import (
	"backend/internal/logger"
	"encoding/json"
	"io"
	"net/http"
)

type TelemetryHandler struct {
	logger *logger.Logger
}

type TelemetryEvent struct {
	Type      string                 `json:"type"`
	Data      map[string]interface{} `json:"data"`
	Timestamp string                 `json:"timestamp"`
	SessionID string                 `json:"sessionId"`
	UserID    string                 `json:"userId"`
	UserAgent string                 `json:"userAgent"`
	URL       string                 `json:"url"`
	Referrer  string                 `json:"referrer"`
}

func NewTelemetryHandler(log *logger.Logger) *TelemetryHandler {
	return &TelemetryHandler{
		logger: log,
	}
}

func (h *TelemetryHandler) HandleTelemetry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		h.logger.Error("telemetry", "Failed to read request body", map[string]interface{}{
			"error": err.Error(),
		})
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var event TelemetryEvent
	if err := json.Unmarshal(body, &event); err != nil {
		h.logger.Warn("telemetry", "Failed to parse telemetry event", map[string]interface{}{
			"error": err.Error(),
			"body":  string(body),
		})
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}

	// Log the telemetry event with appropriate level based on type
	logData := map[string]interface{}{
		"event_type": event.Type,
		"user_id":    event.UserID,
		"session_id": event.SessionID,
		"url":        event.URL,
		"user_agent": event.UserAgent,
	}

	// Merge event data
	for k, v := range event.Data {
		logData[k] = v
	}

	// Log with different messages based on event type
	switch event.Type {
	case "click":
		element, _ := event.Data["element"].(string)
		h.logger.Info("telemetry", "User clicked: "+element, logData)
	case "command":
		command, _ := event.Data["command"].(string)
		h.logger.Info("telemetry", "User executed command: "+command, logData)
	case "navigation":
		to, _ := event.Data["to"].(string)
		h.logger.Info("telemetry", "User navigated to: "+to, logData)
	case "pageview":
		page, _ := event.Data["page"].(string)
		h.logger.Info("telemetry", "User viewed page: "+page, logData)
	case "interaction":
		action, _ := event.Data["action"].(string)
		h.logger.Info("telemetry", "User interaction: "+action, logData)
	default:
		h.logger.Debug("telemetry", "Unknown telemetry event", logData)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status": "success",
	})
}
