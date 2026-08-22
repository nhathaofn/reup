package main

import (
	"errors"
	"log"
	"net/http"
	"os"

	"github.com/nhathaofn/tediapros/server/internal/config"
	"github.com/nhathaofn/tediapros/server/internal/httpapi"
)

const version = "0.1.0"

func main() {
	settings, err := config.Load(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}

	server := &http.Server{
		Addr:              settings.Address,
		Handler:           httpapi.New(httpapi.Options{Version: version}),
		ReadHeaderTimeout: settings.ReadHeaderTimeout,
		ReadTimeout:       settings.ReadTimeout,
		WriteTimeout:      settings.WriteTimeout,
		IdleTimeout:       settings.IdleTimeout,
	}

	log.Printf("TediaPros server %s đang lắng nghe tại %s", version, settings.Address)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
