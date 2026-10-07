package handlers

import (
	"database/sql"
	_ "modernc.org/sqlite"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBlogDraftPrivacyAndAuth(t *testing.T) {
	conn, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetMaxOpenConns(1)
	h := NewBlogHandler(conn)
	call := func(method, path, body string, admin bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		w := httptest.NewRecorder()
		h.Handle(w, r, admin)
		return w
	}
	draft := `{"title":"Private draft","slug":"private-draft","excerpt":"secret","body":"draft content","published":false}`
	if w := call("POST", "/api/admin/blog", draft, true); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	for _, path := range []string{"/api/blog", "/api/blog?slug=private-draft"} {
		w := call("GET", path, "", false)
		if strings.Contains(w.Body.String(), "secret") || w.Body.String() != "[]\n" {
			t.Fatal("draft exposed", w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	AdminOnly(h.Admin)(w, httptest.NewRequest("GET", "/api/admin/blog", nil))
	if w.Code != 401 {
		t.Fatal("admin endpoint exposed")
	}
	if w := call("POST", "/api/blog", draft, false); w.Code != 405 {
		t.Fatal("public write accepted")
	}
	published := `{"id":1,"title":"Public story","slug":"private-draft","excerpt":"hello","body":"safe text","published":true}`
	if w := call("POST", "/api/admin/blog", published, true); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := call("GET", "/api/blog?slug=private-draft", "", false); !strings.Contains(w.Body.String(), "Public story") {
		t.Fatal("published story missing")
	}
	if w := call("POST", "/api/admin/blog", strings.Replace(published, `"published":true`, `"published":false`, 1), true); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := call("GET", "/api/blog", "", false); w.Body.String() != "[]\n" {
		t.Fatal("unpublished story leaked")
	}
}
