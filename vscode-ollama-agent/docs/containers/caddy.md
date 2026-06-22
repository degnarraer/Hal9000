# caddy Container

## Purpose

`caddy` is the only public HTTP/S entry point. It terminates public traffic and reverse-proxies to internal services.

Routes from `deploy/caddy/Caddyfile`:

- `APP_SITE` -> `app:3000`
- `AUTH_SITE` -> `keycloak:8080`
- `VAULT_SITE` -> `vaultwarden:80`

## Network And Permissions

- Publishes host ports `${HTTP_PORT:-80}` and `${HTTPS_PORT:-443}`.
- Attached to `public_net` and `app_net`.
- Reads `deploy/caddy/Caddyfile` read-only.
- Stores Caddy runtime data in `caddy_data` and `caddy_config`.
- Does not have direct database credentials.

## USER Functions

USER traffic can reach:

- Bob app UI and authenticated user APIs through `APP_SITE`.
- Keycloak login/registration through `AUTH_SITE`.
- Vaultwarden UI if the deployment exposes `VAULT_SITE`.

## ADMIN Functions

Caddy does not decide app admin permissions. It forwards requests; the `app` service enforces ADMIN access with authenticated roles.

## Security Notes

- Do not publish `app`, `keycloak`, `vaultwarden`, `ollama`, or database ports directly when Caddy is the intended edge.
- Caddy is a routing boundary, not the only authorization boundary.

