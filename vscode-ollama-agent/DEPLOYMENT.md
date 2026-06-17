# Secure Docker Deployment

This deployment keeps the public edge, app, identity provider, database, and Ollama service separated by containers and Docker networks.

## Services

- `caddy`: only public entry point on ports 80 and 443.
- `app`: Node/Ollama assistant server. Exposes port 3000 only to the Docker network.
- `keycloak`: OIDC identity provider and account registration. Exposes Keycloak ports only to the Docker network.
- `keycloak-db`: private PostgreSQL database for Keycloak users. Exposes port 5432 only to the Docker network.
- `ollama`: private Ollama service. Exposes port 11434 only to the Docker network.

`keycloak-db` and `ollama` are not exposed to the host or internet.

## Container Boundaries

Only `caddy` publishes host ports. Do not add host `ports` mappings to `app`, `keycloak`, `keycloak-db`, or `ollama` unless you are doing short-lived local troubleshooting.

```txt
internet / browser
  -> caddy :80/:443
     -> app :3000
     -> keycloak :8080
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

Default dev credentials:

```txt
admin / change-me-before-production
```

Change all `change-me-before-production` values before exposing this outside your machine.

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
   APP_HOST=your-app.example.com
   AUTH_HOST=auth.example.com
   OIDC_ISSUER=https://auth.example.com/realms/ollama-agent
   OIDC_REDIRECT_URI=https://your-app.example.com/auth/callback
   SECURITY_SECURE_COOKIES=true
   ```

2. Update the Keycloak realm/client:

   - Client secret must match `OIDC_CLIENT_SECRET`.
   - Valid redirect URI must include `https://your-app.example.com/auth/callback`.
   - Web origin must include `https://your-app.example.com`.

3. Use strong values for:

   ```env
   OIDC_CLIENT_SECRET=
   KEYCLOAK_ADMIN_PASSWORD=
   KEYCLOAK_DB_PASSWORD=
   ```

   Generate starter values with:

   ```bash
   npm run secrets:generate
   ```

   In `DEPLOYMENT_ENV=production`, the app refuses to start if any of these still use `change-me-before-production`, if secure cookies are disabled, or if the OIDC URLs are not HTTPS.

4. Keep these private:

   - `keycloak-db`
   - `ollama`
   - Docker volumes
   - `.env`

5. Back up the `keycloak_db_data` Docker volume.
