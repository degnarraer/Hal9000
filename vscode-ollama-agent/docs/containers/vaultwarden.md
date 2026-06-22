# vaultwarden Container

## Purpose

`vaultwarden` is a self-hosted Bitwarden-compatible vault intended for secrets and operational credentials.

## Network And Permissions

- Exposes port `80` only to Docker networks.
- Attached to `app_net`.
- Public browser access, if enabled, is through Caddy's `VAULT_SITE`.
- Data persists in `vaultwarden_data`.
- Supports optional SSO settings through environment variables.

## USER Functions

Vaultwarden users can use vault features according to Vaultwarden's own account/organization permissions. Bob's USER role does not automatically grant Vaultwarden access.

## ADMIN Functions

Vaultwarden administrators can manage the vault and its admin panel using `VAULTWARDEN_ADMIN_TOKEN`.

Bob ADMINs may have a UI link to Vaultwarden, but Vaultwarden enforces its own authentication and admin token.

## Security Notes

- Keep `VAULTWARDEN_ADMIN_TOKEN` strong.
- Do not assume Bob ADMIN equals Vaultwarden ADMIN.
- Vault data is sensitive and should be backed up securely.

