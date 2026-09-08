package handlers

import (
	"backend/internal/logger"
	"testing"
)

// A malformed PLAID_IMPORT_START must fail open. Importing too much is a
// visible nuisance in the review queue; importing nothing looks exactly like a
// broken sync and would be debugged for hours before anyone suspected the date.
func TestPlaidImportStart(t *testing.T) {
	tests := []struct {
		name string
		env  string
		want string
	}{
		{"unset imports everything", "", ""},
		{"valid date is honoured", "2026-08-01", "2026-08-01"},
		{"surrounding whitespace is trimmed", "  2026-08-01  ", "2026-08-01"},
		{"prose fails open", "August 2026", ""},
		{"US ordering fails open", "08/01/2026", ""},
		{"impossible date fails open", "2026-02-30", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("PLAID_IMPORT_START", tt.env)

			h := NewPlaidHandler(logger.GetLogger(), nil, nil)

			if h.importStart != tt.want {
				t.Errorf("importStart = %q, want %q", h.importStart, tt.want)
			}
		})
	}
}
