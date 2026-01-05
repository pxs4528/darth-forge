package handlers

import (
	"backend/internal/logger"
	"backend/internal/websocket"
	"encoding/json"
	"net/http"
	"time"

	ws "github.com/gorilla/websocket"
)

var upgrader = ws.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for now
	},
}

type LogsHandler struct {
	hub    *websocket.Hub
	logger *logger.Logger
}

func NewLogsHandler(hub *websocket.Hub, log *logger.Logger) *LogsHandler {
	return &LogsHandler{
		hub:    hub,
		logger: log,
	}
}

func (h *LogsHandler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("websocket", "Failed to upgrade connection", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	client := &websocket.Client{
		conn,
		make(chan []byte, 256),
	}

	h.hub.Register(client)
	h.logger.Info("websocket", "Client connected", map[string]interface{}{
		"remote_addr": r.RemoteAddr,
	})

	// Send recent logs to new client
	recentLogs := h.logger.GetRecentLogs(100)
	for _, entry := range recentLogs {
		data, _ := json.Marshal(entry)
		client.Send <- data
	}

	// Start writer goroutine
	go h.writePump(client)

	// Start reader goroutine (to handle ping/pong)
	go h.readPump(client)
}

func (h *LogsHandler) writePump(client *websocket.Client) {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		client.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-client.Send:
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				client.Conn.WriteMessage(ws.CloseMessage, []byte{})
				return
			}

			if err := client.Conn.WriteMessage(ws.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := client.Conn.WriteMessage(ws.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (h *LogsHandler) readPump(client *websocket.Client) {
	defer func() {
		h.hub.Unregister(client)
		client.Conn.Close()
	}()

	client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	client.Conn.SetPongHandler(func(string) error {
		client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, _, err := client.Conn.ReadMessage()
		if err != nil {
			if ws.IsUnexpectedCloseError(err, ws.CloseGoingAway, ws.CloseAbnormalClosure) {
				h.logger.Warn("websocket", "Unexpected close error", map[string]interface{}{
					"error": err.Error(),
				})
			}
			break
		}
	}
}

func (h *LogsHandler) HandleGetLogs(w http.ResponseWriter, r *http.Request) {
	logs := h.logger.GetRecentLogs(100)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(logs)
}
