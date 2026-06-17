const crypto = require('crypto');

function secret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

const values = {
  OIDC_CLIENT_SECRET: secret(32),
  KEYCLOAK_ADMIN_PASSWORD: secret(24),
  KEYCLOAK_DB_PASSWORD: secret(24)
};

for (const [key, value] of Object.entries(values)) {
  console.log(`${key}=${value}`);
}
