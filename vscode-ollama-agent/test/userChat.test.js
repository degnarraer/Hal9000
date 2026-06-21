const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { webcrypto } = require('node:crypto');

const subtle = globalThis.crypto?.subtle || webcrypto.subtle;
const getRandomValues = bytes => (globalThis.crypto || webcrypto).getRandomValues(bytes);

function response() {
  return {
    code: 200,
    body: null,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function withMockPg(handler) {
  const pools = [];
  class MockPool {
    constructor() {
      this.messages = [];
      this.keys = new Map([
        ['alice', { user_key: 'alice', public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'alice-x', y: 'alice-y' } }],
        ['bob', { user_key: 'bob', public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'bob-x', y: 'bob-y' } }]
      ]);
      pools.push(this);
    }

    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('CREATE TABLE') || normalized.startsWith('ALTER TABLE') || normalized.startsWith('CREATE INDEX')) {
        return { rows: [] };
      }
      if (normalized.includes('FROM user_chat_keys') && normalized.includes('ANY')) {
        return { rows: (params[0] || []).map(key => this.keys.get(key)).filter(Boolean) };
      }
      if (normalized.startsWith('INSERT INTO user_chat_messages')) {
        const row = {
          id: String(this.messages.length + 1),
          sender_key: params[0],
          recipient_key: params[1],
          sender_public_key_jwk: params[2],
          ciphertext: params[3],
          iv: params[4],
          algorithm: 'ECDH-P256-AES-GCM',
          created_at: new Date('2026-06-21T12:00:00.000Z').toISOString()
        };
        this.messages.push(row);
        return { rows: [row] };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    }

    async end() {}
  }

  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'pg') return { Pool: MockPool };
    return originalLoad.call(this, request, parent, isMain);
  };

  const originalDatabaseUrl = process.env.MEMORY_DATABASE_URL;
  process.env.MEMORY_DATABASE_URL = 'postgres://user:pass@localhost/db';
  delete require.cache[require.resolve('../server/userChat')];

  return Promise.resolve()
    .then(() => handler(require('../server/userChat'), pools))
    .finally(() => {
      Module._load = originalLoad;
      if (originalDatabaseUrl === undefined) delete process.env.MEMORY_DATABASE_URL;
      else process.env.MEMORY_DATABASE_URL = originalDatabaseUrl;
      delete require.cache[require.resolve('../server/userChat')];
    });
}

test('user chat service stores and returns encrypted payloads without plaintext', async () => {
  await withMockPg(async ({ createUserChatStore }, pools) => {
    const store = createUserChatStore({ info() {}, warn() {}, error() {} });
    const res = response();
    await store.sendMessage({
      user: { sub: 'alice', email: 'alice@example.com' },
      body: {
        recipientKey: 'bob',
        ciphertext: 'base64-ciphertext-only',
        iv: 'base64-iv'
      }
    }, res);

    assert.equal(res.code, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.ciphertext, 'base64-ciphertext-only');
    assert.equal(res.body.data.iv, 'base64-iv');
    assert.equal(res.body.data.algorithm, 'ECDH-P256-AES-GCM');
    assert.equal(JSON.stringify(pools[0].messages).includes('hello'), false);
    assert.deepEqual(Object.keys(res.body.data).sort(), [
      'algorithm',
      'ciphertext',
      'createdAt',
      'direction',
      'id',
      'iv',
      'recipientKey',
      'senderKey',
      'senderPublicKeyJwk'
    ].sort());
  });
});

test('user chat service rejects unencrypted message submissions', async () => {
  await withMockPg(async ({ createUserChatStore }) => {
    const store = createUserChatStore({ info() {}, warn() {}, error() {} });
    const res = response();
    await store.sendMessage({
      user: { sub: 'alice' },
      body: { recipientKey: 'bob', text: 'hello in plaintext' }
    }, res);

    assert.equal(res.code, 400);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /ciphertext/);
  });
});

test('ECDH P-256 AES-GCM chat ciphertext decrypts only with the peer key and fails when tampered', async () => {
  const alice = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const bob = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const mallory = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const bobPublicJwk = await subtle.exportKey('jwk', bob.publicKey);
  const alicePublicJwk = await subtle.exportKey('jwk', alice.publicKey);

  async function sharedKey(privateKey, publicKeyJwk) {
    const publicKey = await subtle.importKey('jwk', publicKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return subtle.deriveKey(
      { name: 'ECDH', public: publicKey },
      privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  const plaintext = 'the server must never see this text';
  const iv = getRandomValues(new Uint8Array(12));
  const aliceToBobKey = await sharedKey(alice.privateKey, bobPublicJwk);
  const ciphertext = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv },
    aliceToBobKey,
    new TextEncoder().encode(plaintext)
  ));

  const bobToAliceKey = await sharedKey(bob.privateKey, alicePublicJwk);
  const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, bobToAliceKey, ciphertext);
  assert.equal(new TextDecoder().decode(decrypted), plaintext);

  const malloryKey = await sharedKey(mallory.privateKey, alicePublicJwk);
  await assert.rejects(() => subtle.decrypt({ name: 'AES-GCM', iv }, malloryKey, ciphertext), DOMException);

  const tampered = new Uint8Array(ciphertext);
  tampered[0] ^= 1;
  await assert.rejects(() => subtle.decrypt({ name: 'AES-GCM', iv }, bobToAliceKey, tampered), DOMException);
});
