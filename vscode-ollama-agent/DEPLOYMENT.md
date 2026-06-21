# Secure Docker Deployment

This deployment keeps the public edge, app, identity provider, database, and Ollama service separated by containers and Docker networks.

## Services

- `caddy`: only public entry point on ports 80 and 443.
- `app`: Node/Ollama assistant server. Exposes port 3000 only to the Docker network.
- `keycloak`: OIDC identity provider and account registration. Exposes Keycloak ports only to the Docker network.
- `keycloak-db`: private PostgreSQL database for Keycloak users. Exposes port 5432 only to the Docker network.
- `vaultwarden`: self-hosted Bitwarden-compatible vault for production secrets. Exposes its web service only to Caddy.
- `ollama`: private Ollama service. Exposes port 11434 only to the Docker network.

`keycloak-db`, `memory-db`, and `ollama` are not exposed to the host or internet.

## Container Boundaries

Only `caddy` publishes host ports. Do not add host `ports` mappings to `app`, `keycloak`, `keycloak-db`, or `ollama` unless you are doing short-lived local troubleshooting.

```txt
internet / browser
  -> caddy :80/:443
     -> app :3000
     -> keycloak :8080
     -> vaultwarden :80
        -> keycloak-db :5432
     -> ollama :11434
```

The application does not store user passwords. Keycloak owns identities, credentials, roles, groups, and registration. The app consumes OIDC claims from Keycloak and applies authorization rules from `security.config.json`.

The Docker network is intentionally not marked `internal` because `ollama` needs outbound internet access to pull models.

## Health Checks

Compose health checks are configured for:

- `app`: `GET /health`
- `keycloak-db`: `pg_isready`
- `ollama`: `ollama list`

The `/health` endpoint only reports that the web app container is alive. It does not expose user, database, auth, or Ollama details.

## Local Start

For local testing, `app.localhost` and `auth.localhost` are used.

On a new Windows server, run the prerequisite check first:

```bash
npm run server:check
```

To install missing host tools with `winget`:

```bash
npm run server:install
```

For a fuller first-time Windows server setup that also attempts WSL installation and persists discovered PATH entries, run from an elevated terminal:

```bash
npm run server:install:full
```

If WSL is installed or Windows features are changed, reboot before starting Docker.

To also persist discovered tool paths to your Windows PATH:

```bash
npm run server:install:persist-path
```

Start Docker Desktop and wait for the engine:

```bash
npm run docker:start
```

```bash
npm run docker:up
```

Open:

```txt
http://app.localhost
```

Keycloak admin:

```txt
http://auth.localhost/admin
```

Vaultwarden:

```txt
http://vault.localhost
```

Default dev credentials:

```txt
admin / change-me-before-production
```

Change all `change-me-before-production` values before exposing this outside your machine.

## Application Administrators

Keycloak manages identities, while the app manages its own administrator level for model installation, monitoring, logs, and remote server controls.

The first app administrator can be bootstrapped only while no administrator exists. Configure at least one of:

```env
ADMIN_BOOTSTRAP_USERS=you@example.com
ADMIN_BOOTSTRAP_TOKEN=<generated strong secret>
```

After signing in as a matching bootstrap user, open the menu and use the shield-plus button beside your account. Local `app.localhost` development requests can also bootstrap the first admin.

If you use Keycloak or another OIDC provider to send app roles, the app also recognizes `admin` or `administrator` in common role claims such as `roles`, `groups`, Keycloak realm roles, and `ollama-agent` client roles.

## Secrets Management

Vaultwarden is the human-facing source of truth for production secrets. The app still reads secrets from environment variables at startup, so there is no application wrapper around Vaultwarden and no runtime dependency on the vault being available.

Use Vaultwarden to store:

- `env/prod.env`
- Keycloak admin and database passwords
- OIDC client secrets
- Yahoo OAuth secrets
- DuckDNS tokens
- backup encryption and rclone recovery notes

When a value changes in Vaultwarden, update `env/prod.env`, redeploy the production stack, and confirm the matching service still starts. Keep `env/prod.env` out of git.

The Vaultwarden admin panel is protected by `VAULTWARDEN_ADMIN_TOKEN`. Keep `VAULTWARDEN_SIGNUPS_ALLOWED=false` for production, create accounts by invitation, then disable invitations if you do not need ongoing onboarding.

## Multiple Docker Environments

The repo supports named Compose environments so dev and production-style stacks use separate Compose project names, networks, containers, and volumes.

Create environment files from the examples:

```bash
copy env\dev.env.example env\dev.env
copy env\prod.env.example env\prod.env
```

Dev stack commands:

```bash
npm run docker:dev:config
npm run docker:dev:up
npm run docker:dev:logs
npm run docker:dev:down
```

Production-style stack commands:

```bash
npm run docker:prod:config
npm run docker:prod:up
npm run docker:prod:logs
npm run docker:prod:down
```

The wrapper script uses these project names:

```txt
hal9000-dev
hal9000-prod
```

That keeps Docker resources separated:

```txt
hal9000-dev_app_1
hal9000-dev_keycloak-db_data
hal9000-prod_app_1
hal9000-prod_keycloak-db_data
```

Only one stack can bind the same host port at a time. By default both examples use `HTTP_PORT=80` and `HTTPS_PORT=443`. For side-by-side local testing, change one environment file to alternate host ports, such as:

```env
HTTP_PORT=8080
HTTPS_PORT=8443
```

For real production DNS, keep ports `80` and `443`.

## Production Checklist

1. Set real DNS names:

   ```env
   DEPLOYMENT_ENV=production
   APP_HOST=bobassist.duckdns.org
   AUTH_HOST=bobassist-auth.duckdns.org
   VAULT_HOST=bobassist-vault.duckdns.org
   OIDC_ISSUER=https://bobassist-auth.duckdns.org/realms/ollama-agent
   OIDC_REDIRECT_URI=https://bobassist.duckdns.org/auth/callback
   SECURITY_SECURE_COOKIES=true
   ```

2. Update the Keycloak realm/client:

   - Client secret must match `OIDC_CLIENT_SECRET`.
   - Valid redirect URI must include `https://bobassist.duckdns.org/auth/callback`.
   - Web origin must include `https://bobassist.duckdns.org`.

3. Use strong values for:

   ```env
   OIDC_CLIENT_SECRET=
   KEYCLOAK_ADMIN_PASSWORD=
   KEYCLOAK_DB_PASSWORD=
   MEMORY_DB_PASSWORD=
   VAULTWARDEN_ADMIN_TOKEN=
   ```

   Generate starter values with:

   ```bash
   npm run secrets:generate
   ```

   In `DEPLOYMENT_ENV=production`, the app refuses to start if any of these still use `change-me-before-production`, if secure cookies are disabled, or if the OIDC URLs are not HTTPS.

4. Keep these private:

   - `keycloak-db`
   - `memory-db`
   - `ollama`
   - `vaultwarden`
   - Docker volumes
   - `env/prod.env`

5. Configure encrypted backups:

   ```env
   BACKUP_DIR=backups
   BACKUP_RCLONE_REMOTE=gdrive:hal9000-backups
   BACKUP_AGE_RECIPIENT=age1...
   ```

   Install and configure `rclone` with a Google Drive remote first. Install `age` and set `BACKUP_AGE_RECIPIENT` so backups are encrypted before upload.

6. Back up production:

   ```bash
   npm run backup:prod
   ```

   The backup includes Keycloak and memory PostgreSQL dumps, Vaultwarden data, and `env/prod.env`. If `BACKUP_RCLONE_REMOTE` is set, `BACKUP_AGE_RECIPIENT` is required and the encrypted archive is copied to Google Drive.
