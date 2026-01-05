package handlers

import (
	"backend/internal/logger"
	"encoding/json"
	"io"
	"net/http"
)

type WebhookHandler struct {
	logger *logger.Logger
}

func NewWebhookHandler(log *logger.Logger) *WebhookHandler {
	return &WebhookHandler{
		logger: log,
	}
}

func (h *WebhookHandler) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	h.logger.Info("webhook", "Received webhook request", map[string]interface{}{
		"method":      r.Method,
		"remote_addr": r.RemoteAddr,
		"user_agent":  r.UserAgent(),
		"path":        r.URL.Path,
	})

	// Read body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		h.logger.Error("webhook", "Failed to read request body", map[string]interface{}{
			"error": err.Error(),
		})
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// Parse JSON payload
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		h.logger.Warn("webhook", "Failed to parse JSON payload", map[string]interface{}{
			"error": err.Error(),
			"body":  string(body),
		})
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}

	h.logger.Info("webhook", "Webhook payload received", map[string]interface{}{
		"payload": payload,
	})

	// Check if it's a GitHub webhook
	event := r.Header.Get("X-GitHub-Event")
	if event != "" {
		h.handleGitHubWebhook(event, payload)
	}

	// Respond with success
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": "Webhook received",
	})
}

func (h *WebhookHandler) handleGitHubWebhook(event string, payload map[string]interface{}) {
	h.logger.Info("webhook", "Processing GitHub webhook", map[string]interface{}{
		"event": event,
	})

	switch event {
	case "push":
		h.handlePushEvent(payload)
	case "pull_request":
		h.handlePullRequestEvent(payload)
	default:
		h.logger.Debug("webhook", "Unhandled GitHub event", map[string]interface{}{
			"event": event,
		})
	}
}

func (h *WebhookHandler) handlePushEvent(payload map[string]interface{}) {
	ref, _ := payload["ref"].(string)
	pusher, _ := payload["pusher"].(map[string]interface{})
	name, _ := pusher["name"].(string)

	commits, _ := payload["commits"].([]interface{})
	commitCount := len(commits)

	h.logger.Info("webhook", "Push event received", map[string]interface{}{
		"ref":          ref,
		"pusher":       name,
		"commit_count": commitCount,
	})

	// Log each commit
	for i, c := range commits {
		commit, _ := c.(map[string]interface{})
		message, _ := commit["message"].(string)
		author, _ := commit["author"].(map[string]interface{})
		authorName, _ := author["name"].(string)

		h.logger.Info("webhook", "Commit details", map[string]interface{}{
			"index":   i + 1,
			"author":  authorName,
			"message": message,
		})
	}
}

func (h *WebhookHandler) handlePullRequestEvent(payload map[string]interface{}) {
	action, _ := payload["action"].(string)
	pr, _ := payload["pull_request"].(map[string]interface{})
	title, _ := pr["title"].(string)
	number, _ := pr["number"].(float64)
	user, _ := pr["user"].(map[string]interface{})
	username, _ := user["login"].(string)

	h.logger.Info("webhook", "Pull request event received", map[string]interface{}{
		"action": action,
		"number": int(number),
		"title":  title,
		"user":   username,
	})
}
