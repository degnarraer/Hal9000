# Secure Docker Deployment

This deployment keeps the public edge, app, identity provider, database, and Ollama service separated by containers and Docker networks.

## Services

- `caddy`: only public entry point on ports 80 and 443.
- `app`: Node/Ollama assistant server.
- `keycloak`: OIDC identity provider and account registration.
- `keycloak-db`: private PostgreSQL database for Keycloak users.
- `ollama`: private Ollama service.

`keycloak-db` and `ollama` are not exposed to the host or internet.

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

## Production Checklist

1. Set real DNS names:

   ```env
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

4. Keep these private:

   - `keycloak-db`
   - `ollama`
   - Docker volumes
   - `.env`

5. Back up the `keycloak_db_data` Docker volume.
