package logger

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

type Level string

const (
	LevelInfo  Level = "info"
	LevelWarn  Level = "warn"
	LevelError Level = "error"
	LevelDebug Level = "debug"
)

type LogEntry struct {
	Timestamp string `json:"timestamp"`
	Level     Level  `json:"level"`
	Service   string `json:"service"`
	Message   string `json:"message"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

type Logger struct {
	buffer    *CircularBuffer
	mu        sync.RWMutex
	observers []chan LogEntry
}

var instance *Logger
var once sync.Once

func GetLogger() *Logger {
	once.Do(func() {
		instance = &Logger{
			buffer:    NewCircularBuffer(1000),
			observers: make([]chan LogEntry, 0),
		}
	})
	return instance
}

func (l *Logger) log(level Level, service, message string, data map[string]interface{}) {
	entry := LogEntry{
		Timestamp: time.Now().Format(time.RFC3339),
		Level:     level,
		Service:   service,
		Message:   message,
		Data:      data,
	}

	l.buffer.Add(entry)
	
	// Print to stdout for Docker logs
	jsonEntry, _ := json.Marshal(entry)
	fmt.Println(string(jsonEntry))

	// Notify all observers
	l.mu.RLock()
	defer l.mu.RUnlock()
	for _, ch := range l.observers {
		select {
		case ch <- entry:
		default:
			// Channel full, skip
		}
	}
}

func (l *Logger) Info(service, message string, data ...map[string]interface{}) {
	var d map[string]interface{}
	if len(data) > 0 {
		d = data[0]
	}
	l.log(LevelInfo, service, message, d)
}

func (l *Logger) Warn(service, message string, data ...map[string]interface{}) {
	var d map[string]interface{}
	if len(data) > 0 {
		d = data[0]
	}
	l.log(LevelWarn, service, message, d)
}

func (l *Logger) Error(service, message string, data ...map[string]interface{}) {
	var d map[string]interface{}
	if len(data) > 0 {
		d = data[0]
	}
	l.log(LevelError, service, message, d)
}

func (l *Logger) Debug(service, message string, data ...map[string]interface{}) {
	var d map[string]interface{}
	if len(data) > 0 {
		d = data[0]
	}
	l.log(LevelDebug, service, message, d)
}

func (l *Logger) GetRecentLogs(limit int) []LogEntry {
	return l.buffer.GetAll(limit)
}

func (l *Logger) Subscribe() chan LogEntry {
	ch := make(chan LogEntry, 100)
	l.mu.Lock()
	l.observers = append(l.observers, ch)
	l.mu.Unlock()
	return ch
}
