# keycloak Container

## Purpose

`keycloak` is the OIDC identity provider. It owns users, credentials, login sessions, registration, roles/groups, and token issuance.

## Network And Permissions

- Exposes ports `8080` and `9000` only to Docker networks.
- Attached to `app_net`.
- Public browser access is through Caddy's `AUTH_SITE`.
- Uses `keycloak-db` for persistent identity data.
- Imports realm configuration from `deploy/keycloak/ollama-agent-realm.json` or generated realm import.
- Mounts the Big Hal login theme read-only.

## USER Functions

Users can:

- Log in.
- Register if the realm permits it.
- Complete OIDC redirects back to Bob.
- Receive tokens containing claims such as `sub`, `email`, `name`, roles, and groups.

## ADMIN Functions

Keycloak administrators can:

- Manage users, credentials, sessions, roles, groups, clients, and realm settings.
- Configure OIDC clients used by Bob and Vaultwarden.

This is separate from Bob's app-level `admin` role.

## Security Notes

- Keycloak creates the authoritative `sub` claim.
- Bob derives its database key from `sub` but should not store raw `sub` as the ownership key.
- Keep `KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_DB_PASSWORD`, and client secrets strong.

