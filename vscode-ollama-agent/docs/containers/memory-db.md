# memory-db Container

## Purpose

`memory-db` is PostgreSQL for Bob application data.

It stores app-owned records such as:

- Chat messages.
- Memory summaries.
- Memory factoids.
- App admin roles.
- Activity/security events.
- User chat public keys and encrypted message envelopes.
- Yahoo OAuth token records.

## Network And Permissions

- Exposes port `5432` only to Docker networks.
- Attached to `app_net`.
- Intended client: `app`.
- Data persists in `memory_db_data`.
- Health checked with `pg_isready`.

## USER Functions

Users access only their own records through the `app` API. User-owned rows are keyed by opaque `databaseUserKey(user)`, derived from Keycloak `sub`.

USERs should not be able to provide arbitrary `user_key` values to retrieve another user's rows.

## ADMIN Functions

ADMINs can view operational dashboards and manage app admin roles through the `app` API. Direct unrestricted reads of user private memory/chat should not be a default admin function without an explicit audited support feature.

## Security Notes

- Do not publish this database port.
- Do not use email/name/username as ownership lookup keys.
- Backups may contain private memory and encrypted token material; encrypt them.

