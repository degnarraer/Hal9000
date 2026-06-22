# duckdns Container

## Purpose

`duckdns` updates DuckDNS records for configured domains.

It runs only when the `duckdns` Compose profile is enabled.

## Network And Permissions

- Attached to `public_net`.
- Uses the `curlimages/curl` image.
- Requires:
  - `DUCKDNS_TOKEN`
  - `DUCKDNS_DOMAINS`
- Calls `https://www.duckdns.org/update` every 300 seconds.
- Does not need access to app databases, Keycloak, Ollama, or Vaultwarden.

## USER Functions

None.

## ADMIN Functions

Infrastructure administrators configure the token/domains in environment files and enable the Compose profile.

Bob app ADMINs do not control DuckDNS through the app.

## Security Notes

- Treat `DUCKDNS_TOKEN` as a secret.
- This container needs outbound internet access.
- It should not be connected to `app_net` unless there is a future need.

