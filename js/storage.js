/* ============================================================
   storage.js — IndexedDB Wrapper
   DropBeam Phase 3

   Stores:
     history   — completed transfers (sent & received)
     partials  — resumable in-progress transfers
     settings  — user preferences
     rooms     — recent rooms list
============================================================ */

const DB_NAME    = "dropbeam_v3";
const DB_VER     = 2;

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("history")) {
        const hs = db.createObjectStore("history", { keyPath: "id" });
        hs.createIndex("dir", "direction");
        hs.createIndex("ts",  "timestamp");
      }
      if (!db.objectStoreNames.contains("partials")) {
        db.createObjectStore("partials", { keyPath: "transferId" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("rooms")) {
        const rs = db.createObjectStore("rooms", { keyPath: "roomId" });
        rs.createIndex("lastUsed", "lastUsed");
      }
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

function tx(storeName, mode, fn) {
  return openDB().then(db => new Promise((res, rej) => {
    const t   = db.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  }));
}

function getAll(storeName) {
  return openDB().then(db => new Promise((res, rej) => {
    const t   = db.transaction(storeName, "readonly");
    const req = t.objectStore(storeName).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  }));
}

function clearStore(storeName) {
  return openDB().then(db => new Promise((res, rej) => {
    const t   = db.transaction(storeName, "readwrite");
    const req = t.objectStore(storeName).clear();
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  }));
}

// ============================================================
//   HISTORY
// ============================================================

export async function saveHistory(entry) {
  const id  = entry.id || crypto.randomUUID();
  const obj = {
    id,
    direction:  entry.direction,   // "sent"|"received"
    fileName:   entry.fileName,
    fileSize:   entry.fileSize,
    mimeType:   entry.mimeType    || "application/octet-stream",
    peerName:   entry.peerName    || "unknown",
    roomId:     entry.roomId      || "",
    timestamp:  entry.timestamp   || Date.now(),
    status:     entry.status      || "complete",
    encrypted:  entry.encrypted   || false,
    blob:       (entry.blob && entry.fileSize <= 10 * 1024 * 1024) ? entry.blob : null,
  };
  return tx("history", "readwrite", s => s.put(obj));
}

export async function getHistory(direction = "all") {
  const all = await getAll("history");
  const sorted = all.sort((a, b) => b.timestamp - a.timestamp);
  return direction === "all" ? sorted : sorted.filter(h => h.direction === direction);
}

export async function deleteHistory(id) {
  return tx("history", "readwrite", s => s.delete(id));
}

export async function clearHistory() {
  return clearStore("history");
}

export async function getStats() {
  const all = await getAll("history");
  return {
    sent:       all.filter(h => h.direction === "sent").length,
    received:   all.filter(h => h.direction === "received").length,
    totalBytes: all.reduce((s, h) => s + (h.fileSize || 0), 0),
  };
}

// ============================================================
//   PARTIAL TRANSFERS (Resume)
// ============================================================

export async function savePartial(obj) {
  return tx("partials", "readwrite", s => s.put({
    transferId:    obj.transferId,
    fileId:        obj.fileId,
    fileName:      obj.fileName,
    fileSize:      obj.fileSize,
    mimeType:      obj.mimeType,
    totalChunks:   obj.totalChunks,
    chunkSize:     obj.chunkSize,
    receivedIdxs:  obj.receivedIdxs || [],
    lastActivity:  Date.now(),
  }));
}

export async function getPartial(transferId) {
  return tx("partials", "readonly", s => s.get(transferId));
}

export async function deletePartial(transferId) {
  return tx("partials", "readwrite", s => s.delete(transferId));
}

export async function getAllPartials() {
  return getAll("partials");
}

// ============================================================
//   SETTINGS
// ============================================================

export async function setSetting(key, value) {
  return tx("settings", "readwrite", s => s.put({ key, value }));
}

export async function getSetting(key, def = null) {
  const r = await tx("settings", "readonly", s => s.get(key)).catch(() => null);
  return r ? r.value : def;
}

// ============================================================
//   RECENT ROOMS
// ============================================================

export async function saveRecentRoom(roomId, meta = {}) {
  return tx("rooms", "readwrite", s => s.put({
    roomId,
    lastUsed:    Date.now(),
    hasPassword: meta.hasPassword || false,
  }));
}

export async function getRecentRooms(limit = 5) {
  const all = await getAll("rooms");
  return all.sort((a, b) => b.lastUsed - a.lastUsed).slice(0, limit);
}

export async function clearRecentRooms() {
  return clearStore("rooms");
}
