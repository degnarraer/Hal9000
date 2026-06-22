# app Container

## Purpose

`app` is the Node/Express Bob server. It serves the web UI, verifies Keycloak sessions/tokens, enforces USER vs ADMIN routes, talks to Ollama, and reads/writes Bob application data.

## Network And Permissions

- Exposes port `3000` only to Docker networks; it is not published to the host.
- Attached to `app_net`.
- Receives browser traffic through `caddy`.
- Can reach:
  - `ollama:11434`
  - `memory-db:5432`
  - Keycloak OIDC endpoints
- Uses `MEMORY_DATABASE_URL` for Bob data.
- Uses Keycloak OIDC config for authentication.

## USER Functions

Authenticated USERs can access self-scoped features:

- Chat and streaming chat.
- TTS generation/status/audio.
- Their own memory history, manager view, factoid/message deletion, and memory wipe.
- Their own Yahoo OAuth link/status/refresh/disconnect.
- User chat key registration, user listing, message listing, and encrypted message submission.
- Model listing needed to select an installed Bob model.

User-owned database lookups must use Bob's opaque `databaseUserKey(user)` derived from Keycloak `sub`.

## ADMIN Functions

ADMIN-only routes include:

- Rules read/write.
- TTS server settings apply.
- Admin links and user/admin-role management.
- Activity and security dashboards.
- Model pull/remove/show/load/unload and available-model catalog.
- Monitor and logs.
- Remote reboot/shutdown controls.
- App Tester page and admin-only UI probes.

## Security Notes

- USER and ADMIN are app roles, not Docker roles.
- Admin requests still pass through the same authenticated app boundary.
- The app should never accept email/name/username as a database ownership key.
- The app currently contains both public/user APIs and admin APIs; a future hardening step would split internal/admin APIs onto a separate private port or service.

