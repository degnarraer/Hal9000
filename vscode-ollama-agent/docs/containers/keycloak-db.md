# keycloak-db Container

## Purpose

`keycloak-db` is PostgreSQL for Keycloak identity data.

## Network And Permissions

- Exposes port `5432` only to Docker networks.
- Attached to `app_net`.
- Intended client: `keycloak`.
- Data persists in `keycloak_db_data`.
- Health checked with `pg_isready`.

## USER Functions

None directly. Users never access this database.

## ADMIN Functions

No normal Bob ADMIN route should access this database directly. Keycloak administrators manage identity data through Keycloak, not by querying PostgreSQL.

## Security Notes

- Do not publish this port to the host/internet.
- Backups may include identity data and should be encrypted.
- Treat this as high sensitivity because it backs authentication.

