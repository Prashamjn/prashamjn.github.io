/* ============================================================
   chunkManager.js — File Chunking Engine
   DropBeam Phase 3

   Handles:
   - Adaptive chunk sizing by file size
   - Binary frame encoding (header + payload)
   - Ordered assembly from chunks
   - Resume via missing-chunk detection
============================================================ */

// Chunk size tiers
export const CHUNK = {
  SMALL:  64  * 1024,   // 64 KB  — small files / slow links
  MEDIUM: 128 * 1024,   // 128 KB — default
  LARGE:  256 * 1024,   // 256 KB — large files / fast links
};

export const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500 MB

// Control message types sent over DataChannel as JSON strings
export const MT = {
  PUBKEY:     "PUBKEY",      // ECDH public key exchange
  FILE_META:  "FILE_META",   // File announcement
  ACCEPT:     "FILE_ACCEPT", // Receiver accepted
  REJECT:     "FILE_REJECT", // Receiver declined
  RESUME_REQ: "RESUME_REQ",  // Request resume from chunk N
  COMPLETE:   "COMPLETE",    // All chunks delivered
  CANCEL:     "CANCEL",      // Sender cancelled
  CHAT:       "CHAT",        // Text message
  CLIPBOARD:  "CLIPBOARD",   // Clipboard content
  PING:       "PING",
  PONG:       "PONG",
};

/** Choose chunk size based on file size */
export function pickChunkSize(fileSize) {
  if (fileSize < 5 * 1024 * 1024)   return CHUNK.SMALL;
  if (fileSize < 100 * 1024 * 1024) return CHUNK.MEDIUM;
  return CHUNK.LARGE;
}

// ============================================================
//   BINARY FRAME FORMAT
//
//  [4B: tidLen][tidLen B: transferId][4B: chunkIdx][payload]
//
//  The payload is already encrypted (IV prepended by encryption.js)
// ============================================================

export function encodeFrame(transferId, chunkIndex, payload) {
  const tidBytes = new TextEncoder().encode(transferId);
  const frame    = new Uint8Array(4 + tidBytes.length + 4 + payload.byteLength);
  const view     = new DataView(frame.buffer);
  let   p        = 0;

  view.setUint32(p, tidBytes.length); p += 4;
  frame.set(tidBytes, p);             p += tidBytes.length;
  view.setUint32(p, chunkIndex);      p += 4;
  frame.set(new Uint8Array(payload),  p);

  return frame.buffer;
}

export function decodeFrame(buffer) {
  const view    = new DataView(buffer);
  let   p       = 0;

  const tidLen  = view.getUint32(p);  p += 4;
  const tidBuf  = buffer.slice(p, p + tidLen); p += tidLen;
  const tid     = new TextDecoder().decode(tidBuf);
  const idx     = view.getUint32(p);  p += 4;
  const payload = buffer.slice(p);

  return { transferId: tid, chunkIndex: idx, payload };
}

// ============================================================
//   FileSender
// ============================================================
export class FileSender {
  constructor(file, enc, chunkSize) {
    this.file        = file;
    this.enc         = enc;
    this.chunkSize   = chunkSize || pickChunkSize(file.size);
    this.totalChunks = Math.ceil(file.size / this.chunkSize);
    this.transferId  = crypto.randomUUID();
    this._cancelled  = false;
    this._paused     = false;
    this._pauseRes   = null;
    this.sentBytes   = 0;
    this.startTime   = null;
  }

  metaMsg(toPeer) {
    return {
      type:        MT.FILE_META,
      transferId:  this.transferId,
      fileName:    this.file.name,
      fileSize:    this.file.size,
      mimeType:    this.file.type || "application/octet-stream",
      totalChunks: this.totalChunks,
      chunkSize:   this.chunkSize,
      to:          toPeer,
    };
  }

  /** Send chunks starting from `startIdx` (0 for fresh transfer) */
  async sendChunks(sendFn, onProgress, startIdx = 0) {
    this.startTime = this.startTime || Date.now();
    this.sentBytes = startIdx * this.chunkSize;

    for (let i = startIdx; i < this.totalChunks; i++) {
      if (this._cancelled) break;

      // Wait while paused
      while (this._paused) {
        await new Promise(r => { this._pauseRes = r; });
      }

      const off   = i * this.chunkSize;
      const slice = this.file.slice(off, off + this.chunkSize);
      const raw   = await slice.arrayBuffer();

      // Encrypt chunk (IV is prepended by enc.encrypt)
      const encrypted = await this.enc.encrypt(raw);

      // Encode binary frame
      const frame = encodeFrame(this.transferId, i, encrypted);

      // Back-pressure send
      await sendFn(frame);

      this.sentBytes += raw.byteLength;
      const elapsed   = (Date.now() - this.startTime) / 1000;
      const speed     = elapsed > 0 ? this.sentBytes / elapsed : 0;
      const pct       = Math.min(99, Math.round(this.sentBytes / this.file.size * 100));
      onProgress(pct, speed, this.sentBytes);

      // Yield every 8 chunks to keep UI responsive
      if (i % 8 === 0) await yieldControl();
    }
  }

  pause()  { this._paused = true; }
  resume() {
    this._paused = false;
    if (this._pauseRes) { this._pauseRes(); this._pauseRes = null; }
  }
  cancel() { this._cancelled = true; this.resume(); }
}

// ============================================================
//   FileReceiver
// ============================================================
export class FileReceiver {
  constructor(meta, enc) {
    this.meta         = meta;
    this.enc          = enc;
    this.chunks       = new Array(meta.totalChunks).fill(null);
    this.received     = new Set();
    this.bytesRecvd   = 0;
    this.startTime    = null;
    this.transferId   = meta.transferId;
  }

  get isComplete() { return this.received.size >= this.meta.totalChunks; }

  async receiveChunk(chunkIndex, encPayload) {
    if (this.received.has(chunkIndex)) return;  // deduplicate

    const decrypted = await this.enc.decrypt(encPayload);
    this.chunks[chunkIndex] = decrypted;
    this.received.add(chunkIndex);

    if (!this.startTime) this.startTime = Date.now();
    this.bytesRecvd += decrypted.byteLength;
  }

  progress() {
    const pct     = Math.min(99, Math.round(this.received.size / this.meta.totalChunks * 100));
    const elapsed = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
    const speed   = elapsed > 0 ? this.bytesRecvd / elapsed : 0;
    return { pct, speed, bytesRecvd: this.bytesRecvd };
  }

  missingChunks() {
    const m = [];
    for (let i = 0; i < this.meta.totalChunks; i++) {
      if (!this.received.has(i)) m.push(i);
    }
    return m;
  }

  assemble() {
    const parts = this.chunks.map(c => c || new ArrayBuffer(0));
    return new Blob(parts, { type: this.meta.mimeType });
  }
}

// ============================================================
//   UTILITIES
// ============================================================

export function fmtBytes(b) {
  if (!b) return "0 B";
  const k = 1024, u = ["B","KB","MB","GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + " " + u[i];
}

export function fmtSpeed(bps) {
  return bps ? fmtBytes(bps) + "/s" : "";
}

export function fileEmoji(name, mime = "") {
  const e = (name || "").split(".").pop().toLowerCase();
  const M = {
    jpg:"🖼️",jpeg:"🖼️",png:"🖼️",gif:"🖼️",webp:"🖼️",svg:"🎨",bmp:"🖼️",
    mp4:"🎬",mov:"🎬",avi:"🎬",mkv:"🎬",webm:"🎬",
    mp3:"🎵",wav:"🎵",flac:"🎵",ogg:"🎵",aac:"🎵",
    pdf:"📄",doc:"📝",docx:"📝",odt:"📝",
    xls:"📊",xlsx:"📊",csv:"📊",
    ppt:"📊",pptx:"📊",
    txt:"📋",md:"📋",rtf:"📋",
    js:"💻",ts:"💻",py:"🐍",java:"☕",c:"💻",cpp:"💻",
    html:"🌐",css:"🎨",json:"📋",xml:"📋",
    zip:"📦",rar:"📦",tar:"📦",gz:"📦","7z":"📦",
    exe:"⚙️",dmg:"🍎",apk:"📱",
  };
  if (M[e]) return M[e];
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎵";
  return "📁";
}

export function previewType(name, mime = "") {
  const e = (name||"").split(".").pop().toLowerCase();
  if (["jpg","jpeg","png","gif","webp","svg","bmp"].includes(e) || mime.startsWith("image/")) return "image";
  if (["mp4","webm","ogg"].includes(e) || mime.startsWith("video/")) return "video";
  if (e === "pdf" || mime === "application/pdf") return "pdf";
  return null;
}

export function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return "just now";
  if (s < 3600)  return Math.floor(s/60) + "m ago";
  if (s < 86400) return Math.floor(s/3600) + "h ago";
  return Math.floor(s/86400) + "d ago";
}

function yieldControl() {
  return new Promise(r => setTimeout(r, 0));
}
