// E2E encryption — ECDH P-256 + AES-GCM 256
// Keypair generado en el navegador, clave privada solo en IndexedDB.
// Expone window.LatidoCrypto para uso desde app.js.
(function (global) {
  const DB_NAME    = 'latido_keys';
  const STORE_NAME = 'keys';
  const KEY_PREFIX = 'e2e_';
  const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };

  // ── IndexedDB helpers ──────────────────────────────────────────────────────
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(STORE_NAME);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function dbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function dbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── Keypair ────────────────────────────────────────────────────────────────
  async function initCrypto(userId) {
    const storeKey = KEY_PREFIX + userId;
    const stored   = await dbGet(storeKey);

    if (stored) {
      const privateKey = await crypto.subtle.importKey(
        'jwk', stored.privateJwk, ECDH_PARAMS, true, ['deriveKey']
      );
      const publicKey = await crypto.subtle.importKey(
        'jwk', stored.publicJwk, ECDH_PARAMS, true, []
      );
      return { privateKey, publicKey, publicJwk: stored.publicJwk };
    }

    const pair       = await crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey']);
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const publicJwk  = await crypto.subtle.exportKey('jwk', pair.publicKey);
    await dbSet(storeKey, { privateJwk, publicJwk });
    return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicJwk };
  }

  async function getPublicKeyJwk(userId) {
    const stored = await dbGet(KEY_PREFIX + userId);
    return stored ? stored.publicJwk : null;
  }

  // ── Derivación clave compartida ────────────────────────────────────────────
  async function deriveSharedKey(myPrivateKey, theirPublicJwk) {
    const theirKey = await crypto.subtle.importKey(
      'jwk', theirPublicJwk, ECDH_PARAMS, false, []
    );
    return crypto.subtle.deriveKey(
      { name: 'ECDH', public: theirKey },
      myPrivateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // ── Encrypt → base64(iv[12] + ciphertext) ─────────────────────────────────
  async function encryptMessage(userId, recipientPublicJwk, plaintext) {
    const { privateKey } = await initCrypto(userId);
    const sharedKey = await deriveSharedKey(privateKey, recipientPublicJwk);
    const iv        = crypto.getRandomValues(new Uint8Array(12));
    const encoded   = new TextEncoder().encode(plaintext);
    const cipher    = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, encoded);
    const combined  = new Uint8Array(iv.byteLength + cipher.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipher), iv.byteLength);
    return btoa(String.fromCharCode(...combined));
  }

  // ── Decrypt ────────────────────────────────────────────────────────────────
  async function decryptMessage(userId, senderPublicJwk, ciphertext) {
    const { privateKey } = await initCrypto(userId);
    const sharedKey = await deriveSharedKey(privateKey, senderPublicJwk);
    const bytes     = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const iv        = bytes.slice(0, 12);
    const data      = bytes.slice(12);
    const plain     = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, data);
    return new TextDecoder().decode(plain);
  }

  global.LatidoCrypto = { initCrypto, getPublicKeyJwk, encryptMessage, decryptMessage };
})(window);
