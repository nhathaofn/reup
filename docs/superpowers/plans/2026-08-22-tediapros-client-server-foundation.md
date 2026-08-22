# TediaPros Client-Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the Windows Electron product as TediaPros and make a validated Go server connection mandatory before the client application becomes usable.

**Architecture:** Keep the existing Electron client at repository root and add a separate Go service under `server/`. Renderer calls typed preload APIs, Electron Main owns endpoint validation/persistence and HTTP transport, and the server exposes a versioned handshake contract; media stays local.

**Tech Stack:** Go standard library HTTP server, Electron 34, React 19, TypeScript 5.7, Node test runner, colocated CSS.

**Spec:** `docs/superpowers/specs/2026-08-22-tediapros-client-server-foundation-design.md`

## Global Constraints

- Product name is `TediaPros`; no legacy-product compatibility identifiers or data migration remain.
- Target platform is Windows only.
- Initial i18n locale is Vietnamese (`vi`) with deterministic `vi` fallback and no language selector.
- The client application shell is unavailable until a TediaPros Go server handshake succeeds.
- Server defaults to `127.0.0.1:48191`; LAN bind is explicit configuration.
- Original video and image files remain on the client unless a future named operation proves a minimum payload is necessary.
- Existing FFmpeg/FFprobe and engine packaging behavior remains in place.
- Do not run a build or package command unless the user separately requests it.

---

### Task 1: Align project instructions and skills

**Files:**
- Modify: `AGENTS.md`
- Modify: `.agents/README.md`
- Modify: `.agents/skills/*/SKILL.md`
- Modify: `.agents/skills/*/agents/openai.yaml`

**Interfaces:**
- Consumes: approved product decisions in the design spec.
- Produces: an implicitly discoverable TediaPros skill contract for all later tasks.

- [ ] Replace legacy project assumptions with TediaPros and the actual root Electron layout.
- [ ] Set Windows-only build/release guidance and remove Linux/macOS requirements.
- [ ] Set Vietnamese-only initial i18n and actual React/TSX/colocated-CSS guidance.
- [ ] Preserve bundled FFmpeg/FFprobe and current engine lifecycle as an explicit project decision.
- [ ] Validate every project skill with `quick_validate.py` and confirm implicit invocation remains enabled.
- [ ] Commit the instruction contract as its own checkpoint.

### Task 2: Rebrand active product identifiers

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `electron-builder.yml`
- Modify: `electron-builder.local.yml`
- Modify: `src/main/index.ts`
- Modify: `src/main/logger.ts`
- Modify: `src/shared/build-variant.ts`
- Modify: tracked source, tests, scripts, and documentation containing active legacy identifiers.

**Interfaces:**
- Consumes: TediaPros naming contract.
- Produces: `tediapros://`, `TEDIAPROS_*`, `tediapros.*`, TediaPros installer identity, and TediaPros logs.

- [ ] Update package and Windows builder identities without running a package command.
- [ ] Rename protocol, environment, persisted-key, log, scheduled-task, and artifact identifiers.
- [ ] Update product copy and technical documentation while preserving legally required third-party attribution.
- [ ] Run a repository search and classify any remaining old identifier as required legal history or a defect.
- [ ] Run typecheck and relevant unit tests.
- [ ] Commit the brand checkpoint.

### Task 3: Add the versioned Go handshake service

**Files:**
- Create: `server/go.mod`
- Create: `server/cmd/tediapros-server/main.go`
- Create: `server/internal/config/config.go`
- Create: `server/internal/httpapi/server.go`
- Create: `server/internal/httpapi/server_test.go`

**Interfaces:**
- Consumes: `TEDIAPROS_SERVER_ADDR`, default `127.0.0.1:48191`.
- Produces: `GET /api/v1/health` and `POST /api/v1/session/handshake` JSON contracts.

- [ ] Write Go HTTP contract tests for health, valid handshake, invalid product/platform/API version, method rejection, unknown fields, and body limits.
- [ ] Run `go test ./...` under `server/` and confirm RED because the server package is absent.
- [ ] Implement strict JSON decoding, safe public errors, request limits, and deterministic capability output.
- [ ] Run `go test ./...` and confirm GREEN.
- [ ] Add operator documentation for localhost and explicit LAN binding without modifying Windows Firewall.
- [ ] Commit the server foundation.

### Task 4: Add typed Electron server transport

**Files:**
- Create: `src/shared/server-contract.ts`
- Create: `src/main/services/serverConnection.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Create: `tests/server-contract.test.ts`

**Interfaces:**
- Consumes: server handshake request/response v1.
- Produces: `server:get-status` and `server:connect` typed IPC calls; persisted endpoint only after successful handshake.

- [ ] Write Node tests for URL normalization, private-LAN HTTP allowance, public HTTP rejection, public HTTPS allowance, and handshake validation.
- [ ] Run the targeted Node test and confirm RED because the contract module is absent.
- [ ] Implement the pure shared validation contract and make the targeted test GREEN.
- [ ] Implement Electron Main persistence under current TediaPros user data and bounded HTTP transport.
- [ ] Register narrow IPC handlers and preload methods without exposing raw fetch or filesystem access.
- [ ] Run targeted tests and TypeScript typecheck.
- [ ] Commit the client transport checkpoint.

### Task 5: Gate the renderer and establish Vietnamese i18n

**Files:**
- Create: `src/renderer/src/i18n/vi.ts`
- Create: `src/renderer/src/i18n/index.ts`
- Create: `src/renderer/src/components/ServerConnectionScreen.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`
- Create: `tests/app-startup-model.test.ts`

**Interfaces:**
- Consumes: typed preload server status/connect methods.
- Produces: `server-checking`, `server-required`, `dependency-checking`, `setup`, and `ready` startup states.

- [ ] Write a pure startup-state test proving dependencies cannot be checked before a valid server handshake.
- [ ] Run the targeted test and confirm RED.
- [ ] Implement the startup model and Vietnamese i18n fallback.
- [ ] Add the Warm Minimal connection screen with endpoint entry, retry, validation, loading, and error states.
- [ ] Wire App startup so no feature or dependency setup becomes available before handshake success.
- [ ] Run targeted tests and TypeScript typecheck.
- [ ] Start the Go server and Electron development client, then verify offline/error/success states through the real UI with `computer-use`.
- [ ] Commit the UI gate checkpoint.

### Task 6: Add the non-build base verification gate

**Files:**
- Create: `verify-base.mjs`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: Go server and Electron client test commands.
- Produces: one root command that verifies both bases without building.

- [ ] Implement a fail-fast verifier that runs `go test ./...` in `server/`, client typecheck, unit tests, and architecture checks.
- [ ] Run `node verify-base.mjs` and record the complete output.
- [ ] Run the TediaPros identifier search, skill validation, and architecture audit.
- [ ] Commit and push only `auto-short`; verify `origin/main` remains unchanged.
