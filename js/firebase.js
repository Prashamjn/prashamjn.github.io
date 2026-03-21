// ============================================================
// firebase.js — Phase 5: Auth (Email + Google) + Firestore
// ============================================================

// ⚠️  PASTE YOUR FIREBASE CONFIG HERE
const firebaseConfig = {
  apiKey: "AIzaSyCmafTF4zz4HuicImUtMA9HfszIsxanyVg",
  authDomain: "ipl-auction-21b82.firebaseapp.com",
  projectId: "ipl-auction-21b82",
  storageBucket: "ipl-auction-21b82.firebasestorage.app",
  messagingSenderId: "573274312634",
  appId: "1:573274312634:web:0d4e35ab05228718689783"
};

firebase.initializeApp(firebaseConfig);
const db   = firebase.firestore();
const auth = firebase.auth();

// ─────────────────────────────────────────────
// Auth — Email/Password
// ─────────────────────────────────────────────

async function signUpWithEmail(email, password, displayName) {
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  await cred.user.updateProfile({ displayName });
  await _createOrUpdateUserDoc(cred.user.uid, {
    displayName,
    email,
    provider: "email"
  });
  return cred.user;
}

async function signInWithEmail(email, password) {
  const cred = await auth.signInWithEmailAndPassword(email, password);
  return cred.user;
}

// ─────────────────────────────────────────────
// Auth — Google Sign-In (popup)
// ─────────────────────────────────────────────

async function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope("profile");
  provider.addScope("email");
  provider.setCustomParameters({ prompt: "select_account" });

  const cred = await auth.signInWithPopup(provider);
  const user = cred.user;

  await _createOrUpdateUserDoc(user.uid, {
    displayName: user.displayName || user.email.split("@")[0],
    email:       user.email,
    photoURL:    user.photoURL || null,
    provider:    "google"
  });

  return user;
}

/**
 * Redirect-based Google Sign-In (fallback for popup-blocked environments)
 * The page will redirect to Google and back — onAuthStateChanged handles the result.
 */
async function signInWithGoogleRedirect() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope("profile");
  provider.addScope("email");
  provider.setCustomParameters({ prompt: "select_account" });
  await auth.signInWithRedirect(provider);
  // Note: page redirects away here — code below won't execute
}

/**
 * Check if we just returned from a Google redirect sign-in.
 * Call this on page load.
 */
async function handleGoogleRedirectResult() {
  try {
    const result = await auth.getRedirectResult();
    if (result && result.user) {
      const user = result.user;
      await _createOrUpdateUserDoc(user.uid, {
        displayName: user.displayName || user.email.split("@")[0],
        email:       user.email,
        photoURL:    user.photoURL || null,
        provider:    "google"
      });
    }
  } catch(e) {
    // No redirect result — this is normal on first load
    if (e.code && e.code !== "auth/no-auth-event") {
      console.warn("Redirect result error:", e.code);
    }
  }
}

/**
 * Internal: create user doc if it doesn't exist, or merge on re-login
 */
async function _createOrUpdateUserDoc(uid, data) {
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      uid,
      ...data,
      createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
      totalAuctions: 0,
      totalPlayers:  0
    });
  } else {
    // Only update mutable fields on re-login
    await ref.update({
      displayName: data.displayName,
      lastActive:  firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}

// ─────────────────────────────────────────────
// Auth — Common
// ─────────────────────────────────────────────

async function signOutUser() {
  await auth.signOut();
}

function getCurrentUser() {
  return auth.currentUser;
}

function onAuthChange(callback) {
  return auth.onAuthStateChanged(callback);
}

async function sendPasswordReset(email) {
  await auth.sendPasswordResetEmail(email);
}

async function getUserProfile(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function updateUserStats(uid, playersCount) {
  await db.collection("users").doc(uid).update({
    totalAuctions: firebase.firestore.FieldValue.increment(1),
    totalPlayers:  firebase.firestore.FieldValue.increment(playersCount),
    lastActive:    firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function saveRoomToUserHistory(uid, roomId, summary) {
  await db.collection("users").doc(uid).collection("rooms").doc(roomId).set({
    roomId,
    ...summary,
    savedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function getUserRooms(uid) {
  const snap = await db.collection("users").doc(uid)
    .collection("rooms").orderBy("savedAt", "desc").limit(10).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─────────────────────────────────────────────
// Firestore Room helpers
// ─────────────────────────────────────────────
const ROOMS_COL = "rooms";
function roomRef(roomId)    { return db.collection(ROOMS_COL).doc(roomId); }
function chatRef(roomId)    { return roomRef(roomId).collection("chat"); }
function historyRef(roomId) { return roomRef(roomId).collection("history"); }

async function createRoomInDB(roomId, data) { await roomRef(roomId).set(data); }

async function getRoomOnce(roomId) {
  const snap = await roomRef(roomId).get();
  return snap.exists ? snap.data() : null;
}

async function updateRoom(roomId, updates) { await roomRef(roomId).update(updates); }

function subscribeToRoom(roomId, cb) {
  return roomRef(roomId).onSnapshot(
    { includeMetadataChanges: false },   // ← only fire on SERVER confirms, skip pending writes
    snap => { if (snap.exists) cb(snap.data()); }
  );
}

// ─────────────────────────────────────────────
// Atomic bid transaction
// ─────────────────────────────────────────────
async function placeBidTransaction(roomId, bidderId, bidderName, newBidAmount) {
  return db.runTransaction(async (tx) => {
    const ref  = roomRef(roomId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Room not found");
    const data = snap.data();

    if (data.auctionState === "paused") throw new Error("Auction paused");

    const currentBid = data.auction?.currentBid || 0;
    const lastBidder = data.auction?.highestBidderId || null;

    if (newBidAmount <= currentBid) throw new Error("Bid too low");
    if (lastBidder && lastBidder === bidderId) throw new Error("consecutive_bid_blocked");

    const now        = Date.now() / 1000;
    const resetAt    = data.auction?.timerResetAt?.seconds || now;
    const elapsed    = now - resetAt;
    const duration   = data.auction?.timerDuration || AUCTION_TIMER;
    const remaining  = duration - elapsed;
    const needsBoost = remaining <= 3 && remaining > 0;

    tx.update(ref, {
      "auction.currentBid":        newBidAmount,
      "auction.highestBidderId":   bidderId,
      "auction.highestBidderName": bidderName,
      "auction.lastBidAt":         firebase.firestore.FieldValue.serverTimestamp(),
      "auction.timerResetAt":      firebase.firestore.FieldValue.serverTimestamp(),
      "auction.timerDuration":     needsBoost ? SMART_TIMER_BOOST : AUCTION_TIMER,
      "auction.bidCount":          firebase.firestore.FieldValue.increment(1)
    });

    return { newBid: newBidAmount, boosted: needsBoost };
  });
}

// ─────────────────────────────────────────────
// Chat
// ─────────────────────────────────────────────
async function sendChatMessage(roomId, userId, userName, text) {
  await chatRef(roomId).add({
    userId, userName, text,
    ts: firebase.firestore.FieldValue.serverTimestamp()
  });
}

function subscribeToChatMessages(roomId, cb) {
  return chatRef(roomId)
    .orderBy("ts", "asc").limitToLast(60)
    .onSnapshot(snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

async function sendSystemChat(roomId, text) {
  try {
    await chatRef(roomId).add({
      userId: "system", userName: "🏏 Auction", text,
      ts: firebase.firestore.FieldValue.serverTimestamp(), isSystem: true
    });
  } catch(e) {}
}

// ─────────────────────────────────────────────
// History
// ─────────────────────────────────────────────
async function logBidEvent(roomId, event) {
  try {
    await historyRef(roomId).add({
      ...event, ts: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch(e) {}
}

async function getAuctionHistory(roomId) {
  const snap = await historyRef(roomId).orderBy("ts", "asc").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function subscribeToHistory(roomId, cb) {
  return historyRef(roomId).orderBy("ts", "asc")
    .onSnapshot(snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// ─────────────────────────────────────────────
// Save / Resume
// ─────────────────────────────────────────────
async function saveAuctionCheckpoint(roomId, data) {
  await roomRef(roomId).update({
    checkpoint: {
      savedAt:      firebase.firestore.FieldValue.serverTimestamp(),
      playerQueue:  data.playerQueue,
      members:      data.members,
      playersSold:  data.playersSold,
      auctionState: data.auctionState
    }
  });
}
