// Password hashing utilities using the Web Crypto API.
//
// Format of a hashed credential:
//   { hash: <hex sha-256>, salt: <hex 16 bytes>, iterations: 100000, algo: 'pbkdf2-sha256' }
//
// Why PBKDF2 and not bcrypt/argon2?
// - PBKDF2 is available natively in every browser via SubtleCrypto, no deps.
// - bcrypt/argon2 would require WASM or a server.
// - 100k iterations of SHA-256 is weaker than bcrypt but still orders of magnitude
//   better than plaintext and adds meaningful cost to any offline cracking.

const ITERATIONS = 100000;
const KEY_LENGTH_BITS = 256;

const toHex = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
};

const fromHex = (hex) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
};

const deriveKey = async (password, saltBytes, iterations = ITERATIONS) => {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    baseKey,
    KEY_LENGTH_BITS
  );
  return toHex(bits);
};

// Hash a plaintext password. Returns a credential object safe to persist.
export const hashPassword = async (password) => {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveKey(password, saltBytes);
  return {
    algo: 'pbkdf2-sha256',
    iterations: ITERATIONS,
    salt: toHex(saltBytes),
    hash,
  };
};

// Return true if `credential` is a stored hash object (vs. a plaintext legacy string).
export const isHashedCredential = (credential) =>
  !!credential && typeof credential === 'object' && credential.algo === 'pbkdf2-sha256' && typeof credential.hash === 'string';

// Constant-time string comparison to avoid timing attacks.
const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

// Verify a password against a stored credential (hash object OR legacy plaintext).
// Returns { ok: boolean, needsUpgrade: boolean } so callers can re-hash on login.
export const verifyPassword = async (password, stored) => {
  if (stored == null) return { ok: false, needsUpgrade: false };
  // Legacy plaintext
  if (typeof stored === 'string') {
    return { ok: safeEqual(password, stored), needsUpgrade: true };
  }
  if (!isHashedCredential(stored)) return { ok: false, needsUpgrade: false };
  try {
    const saltBytes = fromHex(stored.salt);
    const candidate = await deriveKey(password, saltBytes, stored.iterations || ITERATIONS);
    return { ok: safeEqual(candidate, stored.hash), needsUpgrade: false };
  } catch {
    return { ok: false, needsUpgrade: false };
  }
};
