/* ============================================================
   encryption.js — E2E Encryption
   DropBeam Phase 3

   ECDH P-256 key exchange per peer pair
   AES-256-GCM encryption for every chunk
   Keys are ephemeral — never stored or sent in plaintext
============================================================ */

export class PeerEncryption {
  constructor() {
    this.keyPair   = null;  // ECDH key pair
    this.sharedKey = null;  // Derived AES-GCM key
    this.ready     = false;
  }

  /** Generate our ECDH key pair */
  async init() {
    this.keyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );
    return this;
  }

  /** Export public key as base64 string for transmission */
  async exportPublicKey() {
    const raw = await crypto.subtle.exportKey("raw", this.keyPair.publicKey);
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
  }

  /** Import peer's public key and derive shared AES-GCM key */
  async deriveSharedKey(peerPubKeyB64) {
    const rawBytes = Uint8Array.from(atob(peerPubKeyB64), c => c.charCodeAt(0));
    const peerPub  = await crypto.subtle.importKey(
      "raw", rawBytes,
      { name: "ECDH", namedCurve: "P-256" },
      false, []
    );
    this.sharedKey = await crypto.subtle.deriveKey(
      { name: "ECDH", public: peerPub },
      this.keyPair.privateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    this.ready = true;
  }

  /**
   * Encrypt an ArrayBuffer chunk.
   * @returns {ArrayBuffer} — [12B IV][encrypted data]
   */
  async encrypt(chunk) {
    if (!this.ready) return chunk;  // passthrough if not yet keyed
    const iv        = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      this.sharedKey,
      chunk
    );
    // Prepend IV to the ciphertext
    const out = new Uint8Array(12 + encrypted.byteLength);
    out.set(iv);
    out.set(new Uint8Array(encrypted), 12);
    return out.buffer;
  }

  /**
   * Decrypt a chunk that was encrypted with encrypt().
   * @param {ArrayBuffer} data — [12B IV][ciphertext]
   */
  async decrypt(data) {
    if (!this.ready) return data;
    const iv         = data.slice(0, 12);
    const ciphertext = data.slice(12);
    return crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      this.sharedKey,
      ciphertext
    );
  }

  /** Hash a plaintext password → base64 SHA-256 */
  static async hashPassword(pwd) {
    const buf  = new TextEncoder().encode(pwd);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return btoa(String.fromCharCode(...new Uint8Array(hash)));
  }

  static async verifyPassword(pwd, hash) {
    return (await PeerEncryption.hashPassword(pwd)) === hash;
  }
}
