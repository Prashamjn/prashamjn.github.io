/* ============================================================
   firebase2.js — Firestore Signaling
   DropBeam Phase 3

   SETUP: Replace firebaseConfig below with yours.
   See README.md for step-by-step instructions.
============================================================ */

// ⚙️ REPLACE WITH YOUR FIREBASE CONFIG
// Firebase Console → Project Settings → Your apps → Web
const firebaseConfig = {
  apiKey: "AIzaSyBETwJ3Ur7DiLo7-eybyMFsmEb4As98EzQ",
  authDomain: "dropbeam.firebaseapp.com",
  projectId: "dropbeam",
  storageBucket: "dropbeam.firebasestorage.app",
  messagingSenderId: "236537497529",
  appId: "1:236537497529:web:be6343afa2cd3497b71868"
};

import { initializeApp } from
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, collection,
  setDoc, getDoc, updateDoc, deleteDoc,
  addDoc, getDocs, onSnapshot,
  serverTimestamp, arrayUnion, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ============================================================
//   ROOM CRUD
// ============================================================

export async function createRoom(roomId, opts = {}) {
  const expiresAt = opts.expiryMinutes > 0
    ? Timestamp.fromDate(new Date(Date.now() + opts.expiryMinutes * 60_000))
    : null;

  await setDoc(doc(db, "rooms", roomId), {
    createdAt:    serverTimestamp(),
    expiresAt,
    hasPassword:  !!opts.passwordHash,
    passwordHash: opts.passwordHash || null,
    status:       "waiting",
    peers:        [],
  });
}

export async function getRoom(roomId) {
  const snap = await getDoc(doc(db, "rooms", roomId));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
    await closeRoom(roomId).catch(() => {});
    return null;
  }
  return data;
}

export async function addPeerToRoom(roomId, peerId, peerName) {
  await updateDoc(doc(db, "rooms", roomId), {
    peers:  arrayUnion({ id: peerId, name: peerName }),
    status: "active"
  });
}

export function listenRoom(roomId, cb) {
  return onSnapshot(doc(db, "rooms", roomId), snap => {
    if (snap.exists()) cb(snap.data());
  });
}

// ============================================================
//   SIGNALING (SDP offers/answers)
// ============================================================

export async function putSignal(roomId, fromId, toId, payload) {
  const sigId = `${fromId}__${toId}`;
  await setDoc(doc(db, "rooms", roomId, "sigs", sigId), {
    ...payload, from: fromId, to: toId, ts: serverTimestamp()
  });
}

export function listenSignals(roomId, myId, cb) {
  return onSnapshot(collection(db, "rooms", roomId, "sigs"), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === "added" || ch.type === "modified") {
        const d = ch.doc.data();
        if (d.to === myId) cb(d);
      }
    });
  });
}

// ============================================================
//   ICE CANDIDATES
// ============================================================

export async function pushIce(roomId, fromId, toId, cand) {
  await addDoc(collection(db, "rooms", roomId, "ice"), {
    from: fromId, to: toId, ts: serverTimestamp(),
    candidate: cand.candidate,
    sdpMid: cand.sdpMid,
    sdpMLineIndex: cand.sdpMLineIndex,
  });
}

export function listenIce(roomId, myId, cb) {
  return onSnapshot(collection(db, "rooms", roomId, "ice"), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === "added") {
        const d = ch.doc.data();
        if (d.to === myId) cb(d);
      }
    });
  });
}

// ============================================================
//   CHAT (Firestore — for persistence/late join)
// ============================================================

export async function pushChatMessage(roomId, msg) {
  await addDoc(collection(db, "rooms", roomId, "chat"), {
    ...msg, ts: serverTimestamp()
  });
}

export function listenChat(roomId, cb) {
  return onSnapshot(collection(db, "rooms", roomId, "chat"), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === "added") cb(ch.doc.data());
    });
  });
}

// ============================================================
//   CLEANUP
// ============================================================

export async function closeRoom(roomId) {
  const subs = ["sigs","ice","chat","presence"];
  for (const sub of subs) {
    const col = collection(db, "rooms", roomId, sub);
    const ds  = await getDocs(col).catch(() => ({ docs: [] }));
    await Promise.all(ds.docs.map(d => deleteDoc(d.ref)));
  }
  await deleteDoc(doc(db, "rooms", roomId));
}
