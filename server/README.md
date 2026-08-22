# TediaPros Go Server

The server owns the versioned TediaPros API contract. The Electron application does not unlock its feature shell until this server completes a compatible handshake.

## Local Windows development

From the repository root:

```powershell
cd server
go run ./cmd/tediapros-server
```

The default listener is `127.0.0.1:48191`. This exposes the service only to the same machine.

Verify liveness:

```powershell
Invoke-RestMethod http://127.0.0.1:48191/api/v1/health
```

## Explicit LAN listener

For testing on a trusted private LAN:

```powershell
$env:TEDIAPROS_SERVER_ADDR = '0.0.0.0:48191'
go run ./cmd/tediapros-server
```

Other Windows clients use `http://<server-lan-ip>:48191`. The repository does not scan the subnet or modify Windows Firewall. If an inbound rule is required, create a narrowly scoped TCP rule for port `48191` on the Private profile after reviewing the machine's network policy.

Loopback or same-machine LAN-IP access is not proof that a second physical device can connect. Record physical-LAN PASS only when another Windows device reaches the server and the server observes that request.

## Current security boundary

The foundation handshake rejects incompatible clients and makes server reachability mandatory. It does not provide tamper-proof DRM or authenticate individual users. Use it only on a trusted private LAN during this phase. Add reviewed client authentication and TLS before routing the service over an untrusted Wi-Fi, routed network, or VPS.

Provider keys, protected prompts, and later server configuration must be supplied at runtime and must not be committed, printed in logs, or returned to the client.
