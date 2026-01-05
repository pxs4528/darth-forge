package logger

import "sync"

type CircularBuffer struct {
	entries []LogEntry
	size    int
	current int
	mu      sync.RWMutex
	filled  bool
}

func NewCircularBuffer(size int) *CircularBuffer {
	return &CircularBuffer{
		entries: make([]LogEntry, size),
		size:    size,
		current: 0,
		filled:  false,
	}
}

func (cb *CircularBuffer) Add(entry LogEntry) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.entries[cb.current] = entry
	cb.current = (cb.current + 1) % cb.size

	if cb.current == 0 {
		cb.filled = true
	}
}

func (cb *CircularBuffer) GetAll(limit int) []LogEntry {
	cb.mu.RLock()
	defer cb.mu.RUnlock()

	var result []LogEntry
	count := cb.size
	if !cb.filled {
		count = cb.current
	}

	if limit > 0 && limit < count {
		count = limit
	}

	if cb.filled {
		// Buffer is full, start from current position
		for i := 0; i < count; i++ {
			idx := (cb.current + i) % cb.size
			result = append(result, cb.entries[idx])
		}
	} else {
		// Buffer not full yet, return from beginning
		result = make([]LogEntry, count)
		copy(result, cb.entries[:count])
	}

	return result
}
