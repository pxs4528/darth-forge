package handlers

import (
	"backend/internal/logger"
	"backend/internal/services"
	"encoding/json"
	"net/http"
	"os"
)

type USCISHandler struct {
	logger *logger.Logger
	poller *services.USCISPoller
}

func NewUSCISHandler(log *logger.Logger, poller *services.USCISPoller) *USCISHandler {
	return &USCISHandler{logger: log, poller: poller}
}

// AdminOnly middleware — checks X-Admin-Token header against ADMIN_SECRET env var.
func AdminOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		secret := os.Getenv("ADMIN_SECRET")
		if secret == "" || r.Header.Get("X-Admin-Token") != secret {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// GET /api/admin/uscis/status
func (h *USCISHandler) HandleGetStatus(w http.ResponseWriter, r *http.Request) {
	status := h.poller.GetStatus()
	w.Header().Set("Content-Type", "application/json")
	if status == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "no check has run yet",
		})
		return
	}
	json.NewEncoder(w).Encode(status)
}

// POST /api/admin/uscis/check — triggers an immediate poll
func (h *USCISHandler) HandleCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	go h.poller.Check()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "check triggered"})
}

// PUT /api/admin/uscis/credentials — update session cookie/bearer without restart
func (h *USCISHandler) HandleUpdateCredentials(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Cookie string `json:"cookie"`
		Bearer string `json:"bearer"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	h.poller.UpdateCredentials(body.Cookie, body.Bearer)
	h.logger.Info("uscis", "Admin updated USCIS credentials", nil)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "credentials updated"})
}

// POST /api/admin/uscis/test-notify — sends a test ntfy.sh notification
func (h *USCISHandler) HandleTestNotify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := h.poller.SendTestNotification(); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "test notification sent"})
}

// POST /api/admin/auth — validates admin password and echoes it back as the token
// (token IS the secret — client stores it and sends it as X-Admin-Token)
func HandleAdminAuth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Password == "" {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	secret := os.Getenv("ADMIN_SECRET")
	if secret == "" || body.Password != secret {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid password"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": secret})
}
