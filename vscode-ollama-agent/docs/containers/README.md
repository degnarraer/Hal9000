# Docker Container Security Notes

This folder documents each Docker service in `docker-compose.yml`.

The public security model is:

- Browsers enter through `caddy` only.
- Authenticated USER traffic reaches the `app` service through Caddy.
- ADMIN features are still browser-accessible through `app`, but require the app `admin` role.
- Databases, Ollama, and container-private services are not published to the host.
- User-owned database rows are keyed by Bob's opaque `databaseUserKey(user)`, derived from Keycloak `sub`; email/name are display metadata, not ownership keys.

## Service Docs

- [caddy.md](caddy.md)
- [app.md](app.md)
- [keycloak.md](keycloak.md)
- [keycloak-db.md](keycloak-db.md)
- [memory-db.md](memory-db.md)
- [ollama.md](ollama.md)
- [vaultwarden.md](vaultwarden.md)
- [duckdns.md](duckdns.md)

