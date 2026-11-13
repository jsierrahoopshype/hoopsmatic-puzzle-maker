// Lock a data-built Daily for the Puzzle Maker server (hoopsmatic-worker
// puzzle-maker-server/). Deep Cut's and the crossword's format:
// AES-256-GCM for the puzzle, the AES key wrapped with RSA-OAEP (SHA-256).
// Only the server's private key opens it.
import { webcrypto as wc } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const b64 = (buf) => Buffer.from(buf).toString('base64');
export const PUBKEY_URL = 'https://hoopsmatic.com/puzzle-maker/api/pubkey';
const COMMITTED = new URL('../../rules/pubkey.json', import.meta.url);

// The committed key (rules/pubkey.json), checked against the live one
// whenever it answers; a mismatch stops the build.
export async function fetchPubkey() {
  let live = null;
  try {
    const res = await fetch(PUBKEY_URL, { headers: { 'User-Agent': 'HoopsMaticPuzzleMakerBuild/1.0' } });
    if (res.ok) live = await res.json();
  } catch (e) { /* offline */ }
  const committed = existsSync(COMMITTED) ? JSON.parse(readFileSync(COMMITTED, 'utf8')) : null;
  if (committed && live && (live.kid !== committed.kid || live.jwk?.n !== committed.jwk?.n)) throw new Error(`server key changed (live ${live.kid}, committed ${committed.kid}): update rules/pubkey.json`);
  const k = committed || live;
  if (!k || !k.kid || k.jwk?.kty !== 'RSA') return null;
  return { kid: k.kid, jwk: k.jwk, live: !!live };
}

export async function lock(plain, pub) {
  const rsa = await wc.subtle.importKey('jwk', { kty: 'RSA', n: pub.jwk.n, e: pub.jwk.e, alg: 'RSA-OAEP-256', ext: true }, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const raw = wc.getRandomValues(new Uint8Array(32));
  const iv = wc.getRandomValues(new Uint8Array(12));
  const aes = await wc.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const data = await wc.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aes, new TextEncoder().encode(JSON.stringify(plain)));
  const key = await wc.subtle.encrypt({ name: 'RSA-OAEP' }, rsa, raw);
  return { v: 1, alg: 'RSA-OAEP-256+A256GCM', kid: pub.kid, key: b64(key), iv: b64(iv), data: b64(data) };
}
