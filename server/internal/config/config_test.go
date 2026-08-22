package config

import (
	"testing"
	"time"
)

func TestLoadUsesLoopbackDefault(t *testing.T) {
	config, err := Load(func(string) string { return "" })
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if config.Address != "127.0.0.1:48191" {
		t.Fatalf("Address = %q", config.Address)
	}
	if config.ReadHeaderTimeout != 5*time.Second || config.ReadTimeout != 15*time.Second || config.WriteTimeout != 30*time.Second || config.IdleTimeout != 60*time.Second {
		t.Fatalf("unexpected timeouts: %+v", config)
	}
}

func TestLoadAcceptsExplicitLANBind(t *testing.T) {
	config, err := Load(func(name string) string {
		if name == "TEDIAPROS_SERVER_ADDR" {
			return " 0.0.0.0:48191 "
		}
		return ""
	})
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if config.Address != "0.0.0.0:48191" {
		t.Fatalf("Address = %q", config.Address)
	}
}

func TestLoadRejectsInvalidAddress(t *testing.T) {
	tests := []string{
		"http://127.0.0.1:48191",
		"127.0.0.1",
		":48191",
		"127.0.0.1:0",
		"127.0.0.1:70000",
	}
	for _, value := range tests {
		t.Run(value, func(t *testing.T) {
			_, err := Load(func(string) string { return value })
			if err == nil {
				t.Fatalf("Load(%q) succeeded", value)
			}
		})
	}
}
