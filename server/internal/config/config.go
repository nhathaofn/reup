package config

import (
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

const defaultAddress = "127.0.0.1:48191"

type Config struct {
	Address           string
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
}

func Load(getenv func(string) string) (Config, error) {
	address := strings.TrimSpace(getenv("TEDIAPROS_SERVER_ADDR"))
	if address == "" {
		address = defaultAddress
	}
	if err := validateAddress(address); err != nil {
		return Config{}, fmt.Errorf("TEDIAPROS_SERVER_ADDR: %w", err)
	}

	return Config{
		Address:           address,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}, nil
}

func validateAddress(address string) error {
	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("địa chỉ listen không hợp lệ")
	}
	if strings.TrimSpace(host) == "" {
		return fmt.Errorf("host listen không được để trống")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("port phải nằm trong khoảng 1..65535")
	}
	return nil
}
