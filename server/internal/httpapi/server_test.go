package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthReturnsServerIdentity(t *testing.T) {
	recorder := performRequest(t, New(Options{Version: "0.1.0"}), http.MethodGet, "/api/v1/health", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var response struct {
		OK         bool   `json:"ok"`
		Product    string `json:"product"`
		APIVersion string `json:"apiVersion"`
		Version    string `json:"version"`
	}
	decodeResponse(t, recorder, &response)
	if !response.OK || response.Product != "tediapros-server" || response.APIVersion != "v1" || response.Version != "0.1.0" {
		t.Fatalf("unexpected response: %+v", response)
	}
}

func TestHandshakeAcceptsCompatibleWindowsClient(t *testing.T) {
	body := []byte(`{"product":"tediapros","apiVersion":"v1","clientVersion":"0.1.27","platform":"win32","architecture":"x64"}`)
	recorder := performRequest(t, New(Options{Version: "0.1.0"}), http.MethodPost, "/api/v1/session/handshake", body)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var response struct {
		OK            bool     `json:"ok"`
		Product       string   `json:"product"`
		APIVersion    string   `json:"apiVersion"`
		ServerVersion string   `json:"serverVersion"`
		Capabilities  []string `json:"capabilities"`
	}
	decodeResponse(t, recorder, &response)
	if !response.OK || response.Product != "tediapros-server" || response.APIVersion != "v1" || response.ServerVersion != "0.1.0" {
		t.Fatalf("unexpected response: %+v", response)
	}
	if len(response.Capabilities) != 1 || response.Capabilities[0] != "session" {
		t.Fatalf("capabilities = %v, want [session]", response.Capabilities)
	}
}

func TestHandshakeRejectsIncompatibleClientFields(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"product", `{"product":"another-product","apiVersion":"v1","clientVersion":"1.0.0","platform":"win32","architecture":"x64"}`},
		{"api version", `{"product":"tediapros","apiVersion":"v2","clientVersion":"1.0.0","platform":"win32","architecture":"x64"}`},
		{"platform", `{"product":"tediapros","apiVersion":"v1","clientVersion":"1.0.0","platform":"linux","architecture":"x64"}`},
		{"missing version", `{"product":"tediapros","apiVersion":"v1","clientVersion":"","platform":"win32","architecture":"x64"}`},
		{"architecture", `{"product":"tediapros","apiVersion":"v1","clientVersion":"1.0.0","platform":"win32","architecture":"ia32"}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := performRequest(t, New(Options{Version: "0.1.0"}), http.MethodPost, "/api/v1/session/handshake", []byte(test.body))
			assertPublicError(t, recorder, http.StatusUnprocessableEntity, "incompatible_client")
		})
	}
}

func TestHandshakeRejectsUnknownJSONField(t *testing.T) {
	body := []byte(`{"product":"tediapros","apiVersion":"v1","clientVersion":"1.0.0","platform":"win32","architecture":"x64","prompt":"hidden"}`)
	recorder := performRequest(t, New(Options{Version: "0.1.0"}), http.MethodPost, "/api/v1/session/handshake", body)
	assertPublicError(t, recorder, http.StatusBadRequest, "invalid_request")
}

func TestHandshakeRequiresJSONContentType(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/session/handshake", strings.NewReader(`{"product":"tediapros"}`))
	recorder := httptest.NewRecorder()
	New(Options{Version: "0.1.0"}).ServeHTTP(recorder, request)
	assertPublicError(t, recorder, http.StatusUnsupportedMediaType, "unsupported_media_type")
}

func TestHandshakeRejectsOversizedBody(t *testing.T) {
	body := []byte(`{"product":"tediapros","apiVersion":"v1","clientVersion":"` + strings.Repeat("x", maxRequestBodyBytes) + `","platform":"win32","architecture":"x64"}`)
	recorder := performRequest(t, New(Options{Version: "0.1.0"}), http.MethodPost, "/api/v1/session/handshake", body)
	assertPublicError(t, recorder, http.StatusRequestEntityTooLarge, "request_too_large")
}

func TestRoutesRejectWrongMethods(t *testing.T) {
	tests := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/v1/health"},
		{http.MethodGet, "/api/v1/session/handshake"},
	}
	for _, test := range tests {
		recorder := performRequest(t, New(Options{Version: "0.1.0"}), test.method, test.path, nil)
		assertPublicError(t, recorder, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func TestUnknownRouteReturnsJSONError(t *testing.T) {
	recorder := performRequest(t, New(Options{Version: "0.1.0"}), http.MethodGet, "/api/v1/unknown", nil)
	assertPublicError(t, recorder, http.StatusNotFound, "not_found")
}

func performRequest(t *testing.T, handler http.Handler, method, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func decodeResponse(t *testing.T, recorder *httptest.ResponseRecorder, target any) {
	t.Helper()
	if contentType := recorder.Header().Get("Content-Type"); contentType != "application/json; charset=utf-8" {
		t.Fatalf("content-type = %q", contentType)
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), target); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, recorder.Body.String())
	}
}

func assertPublicError(t *testing.T, recorder *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if recorder.Code != status {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, status, recorder.Body.String())
	}
	var response struct {
		OK    bool `json:"ok"`
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	decodeResponse(t, recorder, &response)
	if response.OK || response.Error.Code != code || response.Error.Message == "" {
		t.Fatalf("unexpected error response: %+v", response)
	}
}
