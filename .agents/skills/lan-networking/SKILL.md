---
name: lan-networking
description: Configure, change, or verify Promedia communication over a local area network. Use when work involves LAN server binding, local IP addresses, client server selection, CORS for LAN origins, host firewall guidance, network discovery, or claims that another device can reach Promedia.
---

# LAN Networking

Make LAN behavior configurable, explicit, and testable without weakening the application boundary.

## Inspect first

1. Find the server listen address, HTTP routes, CORS/auth middleware, timeouts, and environment files.
2. Find the client base URL owner, persistence, health check, IPC/network boundary, and error states.
3. Identify whether the requested evidence is loopback, same-machine LAN-IP, virtual-machine, or physical second-device traffic.
4. Use `client-server-contract` for HTTP/CORS changes, `electron-boundary` for preload/IPC changes, and `change-impact` when a config key or shared contract changes.

## Configuration contract

- Put listen addresses, ports, server URLs, allowed browser origins, and timeouts in environment or user configuration; never duplicate a current IP address in source code.
- A LAN server normally binds to an explicit all-interface address such as `0.0.0.0:<port>` while the client uses the server machine's real LAN IP or hostname.
- Keep browser CORS origins as an exact allowlist. Do not use `*` as the default and do not confuse CORS with authentication.
- Persist a user-entered server URL only after a real Promedia health/handshake response succeeds. Invalid or unreachable values remain editable and must not replace the last verified address.
- Do not add subnet scanning, UDP broadcast, mDNS, UPnP, or automatic firewall mutation unless the user explicitly requests and reviews that behavior.

## Security and platform behavior

- Treat the LAN as untrusted. Sensitive endpoints need authentication and authorization even when CORS is strict.
- Recommend TLS when traffic crosses an untrusted Wi-Fi or routed network; never silently accept invalid certificates.
- Keep renderer network or native access behind the narrowest existing boundary. Validate protocol, credentials, query, fragment, size, timeout, and response shape at the owning boundary.
- Firewall changes are an explicit administrator operation. Scope guidance to the application port and private/trusted network profile; do not create broad inbound rules automatically.
- Keep commands and path handling compatible with Windows and Linux. Do not add macOS packaging behavior.

## Verification levels

Report the strongest level actually proven:

1. `LOOPBACK`: client reached `localhost`.
2. `LAN-IP SAME MACHINE`: client reached the host's LAN IP from the same machine.
3. `LAN PHYSICAL PASS`: a second physical device reached the server through the LAN and the server observed that traffic.

Do not call same-machine or VM traffic physical-LAN proof. Test success plus invalid address, timeout/unreachable, persistence after restart, and a disallowed browser origin when relevant. Use `computer-use` for the Windows product path and report `BLOCKED` when a second device or firewall authority is unavailable.
