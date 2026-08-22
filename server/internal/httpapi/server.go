package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
)

const (
	productID           = "tediapros"
	serverProductID     = "tediapros-server"
	apiVersion          = "v1"
	maxRequestBodyBytes = 32 * 1024
)

type Options struct {
	Version string
}

type server struct {
	version string
}

type handshakeRequest struct {
	Product       string `json:"product"`
	APIVersion    string `json:"apiVersion"`
	ClientVersion string `json:"clientVersion"`
	Platform      string `json:"platform"`
	Architecture  string `json:"architecture"`
}

type publicError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorResponse struct {
	OK    bool        `json:"ok"`
	Error publicError `json:"error"`
}

func New(options Options) http.Handler {
	version := strings.TrimSpace(options.Version)
	if version == "" {
		version = "dev"
	}
	api := &server{version: version}
	return http.HandlerFunc(api.route)
}

func (s *server) route(writer http.ResponseWriter, request *http.Request) {
	switch request.URL.Path {
	case "/api/v1/health":
		s.method(writer, request, http.MethodGet, s.health)
	case "/api/v1/session/handshake":
		s.method(writer, request, http.MethodPost, s.handshake)
	default:
		writeError(writer, http.StatusNotFound, "not_found", "Không tìm thấy API được yêu cầu.")
	}
}

func (s *server) method(writer http.ResponseWriter, request *http.Request, expected string, handler http.HandlerFunc) {
	if request.Method != expected {
		writer.Header().Set("Allow", expected)
		writeError(writer, http.StatusMethodNotAllowed, "method_not_allowed", "Phương thức HTTP không được hỗ trợ.")
		return
	}
	handler(writer, request)
}

func (s *server) health(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, struct {
		OK         bool   `json:"ok"`
		Product    string `json:"product"`
		APIVersion string `json:"apiVersion"`
		Version    string `json:"version"`
	}{
		OK:         true,
		Product:    serverProductID,
		APIVersion: apiVersion,
		Version:    s.version,
	})
}

func (s *server) handshake(writer http.ResponseWriter, request *http.Request) {
	if !isJSONContentType(request.Header.Get("Content-Type")) {
		writeError(writer, http.StatusUnsupportedMediaType, "unsupported_media_type", "Yêu cầu phải dùng nội dung JSON.")
		return
	}

	var input handshakeRequest
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, maxRequestBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		var sizeError *http.MaxBytesError
		if errors.As(err, &sizeError) {
			writeError(writer, http.StatusRequestEntityTooLarge, "request_too_large", "Dữ liệu yêu cầu vượt quá giới hạn.")
			return
		}
		writeError(writer, http.StatusBadRequest, "invalid_request", "Dữ liệu yêu cầu không hợp lệ.")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Dữ liệu yêu cầu không hợp lệ.")
		return
	}

	if !compatibleClient(input) {
		writeError(writer, http.StatusUnprocessableEntity, "incompatible_client", "Client không tương thích với TediaPros server.")
		return
	}

	writeJSON(writer, http.StatusOK, struct {
		OK            bool     `json:"ok"`
		Product       string   `json:"product"`
		APIVersion    string   `json:"apiVersion"`
		ServerVersion string   `json:"serverVersion"`
		Capabilities  []string `json:"capabilities"`
	}{
		OK:            true,
		Product:       serverProductID,
		APIVersion:    apiVersion,
		ServerVersion: s.version,
		Capabilities:  []string{"session"},
	})
}

func compatibleClient(input handshakeRequest) bool {
	architecture := strings.TrimSpace(input.Architecture)
	return input.Product == productID &&
		input.APIVersion == apiVersion &&
		strings.TrimSpace(input.ClientVersion) != "" &&
		input.Platform == "win32" &&
		(architecture == "x64" || architecture == "arm64")
}

func isJSONContentType(value string) bool {
	mediaType, _, err := mime.ParseMediaType(value)
	return err == nil && mediaType == "application/json"
}

func writeError(writer http.ResponseWriter, status int, code, message string) {
	writeJSON(writer, status, errorResponse{
		OK: false,
		Error: publicError{
			Code:    code,
			Message: message,
		},
	})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
