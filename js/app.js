// ============================================================
// app.js — Phase 4: Firebase Auth + fixed ordering + session
// ============================================================

const AppState = {
  userId:           null,
  userName:         null,
  roomId:           null,
  isHost:           false,
  unsubscribeRoom:  null,
  players:          [],
  lastRoomSnapshot: null,
  soundEnabled:     true,
  auctionPaused:    false,
  lastOutbidBid:    0,
  wasHighestBidder: false,
  // Auth
  firebaseUser:     null
};

const STARTING_BUDGET   = 100;
const AUCTION_TIMER     = 10;   // ← changed from 15 to 10 seconds
const SMART_TIMER_BOOST = 5;
const BID_INCREMENT     = 1;

// ─────────────────────────────────────────────
// STAR PLAYER ORDERING
// Players are ordered by prestige tier so marquee players
// come first. Within a tier, order is shuffled randomly.
// ─────────────────────────────────────────────
const TIER_ORDER = {
  "S": 1,   // Legends: Virat, Rohit, Dhoni, Bumrah, Jadeja, SKY, etc.
  "A": 2,   // Stars
  "B": 3,   // Good players
  "C": 4    // Regular
};

function getPlayerTier(player) {
  if (player.rating >= 93)      return "S";
  if (player.rating >= 88)      return "A";
  if (player.rating >= 83)      return "B";
  return "C";
}

/**
 * Build a player queue with star players first.
 * Within each tier players are randomised.
 * This ensures Virat, Rohit, Dhoni etc. appear early.
 */
function buildStarFirstQueue(players) {
  // Separate into tiers
  const tiers = { S: [], A: [], B: [], C: [] };
  players.forEach(p => {
    const t = getPlayerTier(p);
    tiers[t].push(p);
  });
  // Shuffle each tier individually
  Object.values(tiers).forEach(arr => arr.sort(() => Math.random() - 0.5));
  // Concatenate: S → A → B → C
  return [...tiers.S, ...tiers.A, ...tiers.B, ...tiers.C].map(p => p.id);
}

/**
 * Build category-based queue (Marquee first, then others).
 * Stars still lead within each category.
 */
function buildCategoryQueue(players) {
  const categoryOrder = ["Marquee","Batsmen","Bowlers","All-rounders","Wicketkeepers"];
  const ids = [];
  categoryOrder.forEach(cat => {
    const catPlayers = players
      .filter(p => p.category === cat)
      .sort((a, b) => b.rating - a.rating + (Math.random() - 0.5) * 8);
    ids.push(...catPlayers.map(p => p.id));
  });
  return ids;
}

// ─────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const page = document.body.dataset.page;
  ThemeManager.init();
  AppState.players = await loadPlayers();

  // Handle Google redirect sign-in result (fires if user was redirected from Google)
  // Must run before onAuthStateChanged so the user doc is created first
  if (page === "home") {
    await handleGoogleRedirectResult();
  }

  // Wait for Firebase Auth to resolve before rendering
  onAuthChange(async (user) => {
    AppState.firebaseUser = user;
    if (user) {
      AppState.userId   = user.uid;
      AppState.userName = user.displayName || user.email.split("@")[0];
    }

    if (page === "home")     initHomePage(user);
    if (page === "room")     initRoomPage(user);
    if (page === "profile")  initProfilePage(user);
  });
});

async function loadPlayers() {
  try { return await (await fetch("data/players.json")).json(); }
  catch(e) { console.error(e); return []; }
}

// ─────────────────────────────────────────────
// HOME PAGE
// ─────────────────────────────────────────────
function initHomePage(user) {
  if (user) {
    showLoggedInHome(user);
  } else {
    showAuthHome();
  }
}

function showAuthHome() {
  const authSection = document.getElementById("authSection");
  const mainSection = document.getElementById("mainSection");
  if (authSection) authSection.style.display = "";
  if (mainSection) mainSection.style.display = "none";

  // Tab switching
  document.querySelectorAll(".auth-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const mode = tab.dataset.mode;
      document.getElementById("loginForm").style.display  = mode === "login"  ? "" : "none";
      document.getElementById("signupForm").style.display = mode === "signup" ? "" : "none";
    });
  });

  // Email Login
  document.getElementById("loginSubmitBtn")?.addEventListener("click", handleLogin);
  document.getElementById("loginPassword")?.addEventListener("keypress", e => {
    if (e.key === "Enter") handleLogin();
  });

  // Email Signup
  document.getElementById("signupSubmitBtn")?.addEventListener("click", handleSignup);
  document.getElementById("signupConfirmPwd")?.addEventListener("keypress", e => {
    if (e.key === "Enter") handleSignup();
  });

  // Google Sign-In (both login + signup pages share the same handler)
  document.getElementById("googleSignInBtn")?.addEventListener("click", handleGoogleSignIn);
  document.getElementById("googleSignUpBtn")?.addEventListener("click", handleGoogleSignIn);

  // Forgot password
  document.getElementById("forgotPwdLink")?.addEventListener("click", handleForgotPassword);
}

function showLoggedInHome(user) {
  const authSection = document.getElementById("authSection");
  const mainSection = document.getElementById("mainSection");
  if (authSection) authSection.style.display = "none";
  if (mainSection) mainSection.style.display = "";

  const name = user.displayName || user.email.split("@")[0];

  // Avatar circle initials
  const avatarEl = document.getElementById("navAvatarCircle");
  if (avatarEl) {
    avatarEl.textContent = name.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase();
  }

  // Greeting
  const greetEl = document.getElementById("userGreeting");
  if (greetEl) greetEl.textContent = `Hey, ${name}! 👋`;

  // Pre-fill name
  const nameInput = document.getElementById("nameInput");
  if (nameInput) nameInput.value = name;

  // Queue mode buttons
  document.querySelectorAll(".queue-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".queue-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  document.getElementById("createRoomBtn")?.addEventListener("click", handleCreateRoom);
  document.getElementById("joinRoomBtn")?.addEventListener("click", handleJoinRoom);
  document.getElementById("roomCodeInput")?.addEventListener("keypress", e => {
    if (e.key === "Enter") handleJoinRoom();
  });
  document.getElementById("signOutBtn")?.addEventListener("click", async () => {
    await signOutUser();
    showToast("Signed out successfully", "success");
  });
  document.getElementById("profileBtn")?.addEventListener("click", () => {
    window.location.href = "profile.html";
  });
}

// ─────────────────────────────────────────────
// AUTH HANDLERS
// ─────────────────────────────────────────────
async function handleLogin() {
  const email    = document.getElementById("loginEmail")?.value.trim();
  const password = document.getElementById("loginPassword")?.value;
  if (!email || !password) { showToast("Enter email and password", "error"); return; }

  setButtonLoading("loginSubmitBtn", true);
  try {
    await signInWithEmail(email, password);
    showToast("Welcome back! ✅", "success");
  } catch(err) {
    showToast(getFriendlyAuthError(err.code), "error");
    setButtonLoading("loginSubmitBtn", false);
  }
}

async function handleSignup() {
  const name    = document.getElementById("signupName")?.value.trim();
  const email   = document.getElementById("signupEmail")?.value.trim();
  const pwd     = document.getElementById("signupPassword")?.value;
  const confirm = document.getElementById("signupConfirmPwd")?.value;

  if (!name)    { showToast("Enter your name", "error"); return; }
  if (!email)   { showToast("Enter your email", "error"); return; }
  if (!pwd || pwd.length < 6) { showToast("Password must be at least 6 characters", "error"); return; }
  if (pwd !== confirm) { showToast("Passwords do not match", "error"); return; }

  setButtonLoading("signupSubmitBtn", true);
  try {
    await signUpWithEmail(email, pwd, name);
    showToast("Account created! Welcome 🎉", "success");
  } catch(err) {
    showToast(getFriendlyAuthError(err.code), "error");
    setButtonLoading("signupSubmitBtn", false);
  }
}

async function handleForgotPassword() {
  const email = document.getElementById("loginEmail")?.value.trim();
  if (!email) { showToast("Enter your email first", "error"); return; }
  try {
    await sendPasswordReset(email);
    showToast("Password reset email sent! Check your inbox 📧", "success");
  } catch(err) {
    showToast(getFriendlyAuthError(err.code), "error");
  }
}

async function handleGoogleSignIn() {
  // Disable both Google buttons
  ["googleSignInBtn","googleSignUpBtn"].forEach(id => {
    const b = document.getElementById(id);
    if (b) { b.disabled = true; b.style.opacity = ".6"; }
  });

  const re_enable = () => {
    ["googleSignInBtn","googleSignUpBtn"].forEach(id => {
      const b = document.getElementById(id);
      if (b) { b.disabled = false; b.style.opacity = ""; }
    });
  };

  try {
    await signInWithGoogle();
    showToast("Signed in with Google! ✅", "success");
    // onAuthStateChanged will handle the redirect
  } catch(err) {
    console.error("Google sign-in error:", err.code, err.message);

    if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") {
      showToast("Sign-in was cancelled", "info");
      re_enable();
    } else if (err.code === "auth/popup-blocked") {
      // Try redirect fallback for environments that block popups
      showToast("Popup blocked — trying redirect login…", "info");
      try {
        await signInWithGoogleRedirect();
        // Page will redirect — no need to re-enable
      } catch(e2) {
        showToast("Redirect login failed. Enable popups and retry.", "error");
        re_enable();
      }
    } else if (err.code === "auth/operation-not-allowed") {
      showToast("Google Sign-In is not enabled. See setup instructions below.", "error");
      showGoogleSetupHelper();
      re_enable();
    } else if (err.code === "auth/unauthorized-domain") {
      showToast("This domain is not authorized in Firebase. See setup instructions.", "error");
      showGoogleSetupHelper();
      re_enable();
    } else {
      showToast(getFriendlyAuthError(err.code) + ` (${err.code || "unknown"})`, "error");
      re_enable();
    }
  }
}

/**
 * Shows an inline helper message explaining how to fix Google Sign-In
 */
function showGoogleSetupHelper() {
  const existing = document.getElementById("googleSetupHelper");
  if (existing) return; // already showing

  const el = document.createElement("div");
  el.id = "googleSetupHelper";
  el.style.cssText = `
    margin-top:.75rem;padding:1rem;
    background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);
    border-radius:10px;font-size:.78rem;line-height:1.7;color:rgba(238,242,255,.8);
  `;
  el.innerHTML = `
    <strong style="color:#ef4444;">⚙️ Google Sign-In Setup Required:</strong><br/>
    1. Go to <strong>Firebase Console → Authentication → Sign-in method</strong><br/>
    2. Click <strong>Google</strong> → Toggle <strong>Enable</strong> → Save<br/>
    3. If on localhost: add <code style="background:rgba(255,255,255,.1);padding:.1rem .35rem;border-radius:4px;">localhost</code> to Authorized Domains<br/>
    4. If deployed: add your domain to Authorized Domains<br/>
    <button onclick="this.parentElement.remove()" style="margin-top:.5rem;background:none;border:1px solid rgba(255,255,255,.2);border-radius:6px;color:rgba(238,242,255,.6);padding:.25rem .6rem;cursor:pointer;font-size:.75rem;">Dismiss</button>
  `;

  // Insert after the Google button
  const googleBtn = document.getElementById("googleSignInBtn") || document.getElementById("googleSignUpBtn");
  if (googleBtn) googleBtn.parentElement.insertBefore(el, googleBtn.nextSibling);
}

function getFriendlyAuthError(code) {
  const map = {
    "auth/user-not-found":          "No account found with this email",
    "auth/wrong-password":          "Incorrect password — try again",
    "auth/invalid-credential":      "Incorrect email or password",
    "auth/email-already-in-use":    "This email is already registered",
    "auth/weak-password":           "Password must be at least 6 characters",
    "auth/invalid-email":           "Invalid email address format",
    "auth/too-many-requests":       "Too many attempts. Try again in a few minutes",
    "auth/network-request-failed":  "Network error — check your connection",
    "auth/operation-not-allowed":   "This sign-in method is not enabled in Firebase",
    "auth/unauthorized-domain":     "This domain is not authorized in Firebase Console",
    "auth/internal-error":          "Firebase internal error — check your config",
    "auth/configuration-not-found": "Firebase Auth not configured — check your setup",
    "auth/user-disabled":           "This account has been disabled"
  };
  return map[code] || `Something went wrong (${code || "unknown"})`;
}

// ─────────────────────────────────────────────
// ROOM CREATION (Star-first ordering)
// ─────────────────────────────────────────────
async function handleCreateRoom() {
  if (!AppState.firebaseUser) { showToast("Please sign in first!", "error"); return; }

  const nameInput = document.getElementById("nameInput");
  const name      = nameInput?.value.trim() || AppState.userName;
  if (!name)      { showToast("Enter your name!", "error"); return; }

  AppState.userName = name;
  const queueMode = document.querySelector(".queue-mode-btn.active")?.dataset.mode || "stars";
  const roomId    = generateRoomCode();
  setButtonLoading("createRoomBtn", true);

  try {
    // ── STAR-FIRST ORDERING (the key fix for player order) ──
    let orderedIds;
    if (queueMode === "category") {
      orderedIds = buildCategoryQueue(AppState.players);
    } else {
      // Default "stars" mode — marquee + high-rated players appear first
      orderedIds = buildStarFirstQueue(AppState.players);
    }

    await createRoomInDB(roomId, {
      roomId,
      hostId:    AppState.userId,
      hostName:  name,
      status:    "waiting",
      auctionState: "idle",
      queueMode,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      members: {
        [AppState.userId]: {
          id:     AppState.userId,
          name,
          budget: STARTING_BUDGET,
          team:   [],
          isHost: true
        }
      },
      playerQueue:    orderedIds,
      playersSold:    {},
      unsoldPlayers:  [],
      reAuctionQueue: [],
      teamScores:     {},
      auction:        null,
      checkpoint:     null
    });

    localStorage.setItem("iplCurrentRoom", roomId);
    window.location.href = `room.html?room=${roomId}`;
  } catch(err) {
    console.error(err);
    showToast("Failed to create room. Check Firebase config!", "error");
    setButtonLoading("createRoomBtn", false);
  }
}

async function handleJoinRoom() {
  if (!AppState.firebaseUser) { showToast("Please sign in first!", "error"); return; }

  const nameInput = document.getElementById("nameInput");
  const name      = nameInput?.value.trim() || AppState.userName;
  const code      = document.getElementById("roomCodeInput")?.value.trim().toUpperCase();

  if (!name)          { showToast("Enter your name!", "error"); return; }
  if (!code || code.length !== 6) { showToast("6-char room code required!", "error"); return; }

  AppState.userName = name;
  setButtonLoading("joinRoomBtn", true);

  try {
    const roomData = await getRoomOnce(code);
    if (!roomData)                        { showToast("Room not found!", "error"); setButtonLoading("joinRoomBtn", false); return; }
    if (roomData.status === "finished")   { showToast("Auction already ended!", "error"); setButtonLoading("joinRoomBtn", false); return; }

    await updateRoom(code, {
      [`members.${AppState.userId}`]: {
        id:     AppState.userId,
        name,
        budget: STARTING_BUDGET,
        team:   [],
        isHost: false
      }
    });

    localStorage.setItem("iplCurrentRoom", code);
    window.location.href = `room.html?room=${code}`;
  } catch(err) {
    console.error(err);
    showToast("Failed to join!", "error");
    setButtonLoading("joinRoomBtn", false);
  }
}

// ─────────────────────────────────────────────
// ROOM PAGE
// ─────────────────────────────────────────────
function initRoomPage(user) {
  if (!user) {
    showToast("Please sign in to join a room", "error");
    setTimeout(() => { window.location.href = "index.html"; }, 1500);
    return;
  }

  AppState.userId   = user.uid;
  AppState.userName = user.displayName || user.email.split("@")[0];

  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room") || localStorage.getItem("iplCurrentRoom");
  if (!roomId) { window.location.href = "index.html"; return; }

  AppState.roomId = roomId;

  const rcEl = document.getElementById("roomCodeDisplay");
  if (rcEl) rcEl.textContent = roomId;

  document.getElementById("copyCodeBtn")?.addEventListener("click", () => {
    navigator.clipboard.writeText(roomId).then(() => showToast("Copied!", "success"));
  });
  document.getElementById("leaveRoomBtn")?.addEventListener("click", handleLeaveRoom);

  const soundBtn = document.getElementById("soundToggleBtn");
  if (soundBtn) soundBtn.addEventListener("click", () => {
    AppState.soundEnabled = !AppState.soundEnabled;
    soundBtn.textContent  = AppState.soundEnabled ? "🔊" : "🔇";
    showToast(AppState.soundEnabled ? "Sound ON" : "Sound OFF", "info");
  });

  initHistoryListener(roomId);
  AppState.unsubscribeRoom = subscribeToRoom(roomId, onRoomUpdate);
  initChat(roomId);

  // Show user name in nav
  const navUser = document.getElementById("navUserName");
  if (navUser) navUser.textContent = AppState.userName;
}

// ─────────────────────────────────────────────
// PROFILE PAGE
// ─────────────────────────────────────────────
async function initProfilePage(user) {
  if (!user) {
    window.location.href = "index.html"; return;
  }

  // Fill profile details
  const nameEl  = document.getElementById("profileName");
  const emailEl = document.getElementById("profileEmail");
  if (nameEl)  nameEl.textContent  = user.displayName || "—";
  if (emailEl) emailEl.textContent = user.email;

  // Load past rooms
  const roomsList = document.getElementById("pastRoomsList");
  if (roomsList) {
    roomsList.innerHTML = `<div class="loading-rooms"><div class="spinner"></div> Loading your auction history…</div>`;
    try {
      const rooms = await getUserRooms(user.uid);
      if (rooms.length === 0) {
        roomsList.innerHTML = `<div class="no-rooms">No auction history yet. Create or join a room to get started!</div>`;
      } else {
        roomsList.innerHTML = rooms.map(r => `
          <div class="past-room-card">
            <div class="prc-header">
              <div class="prc-code">${r.roomId}</div>
              <div class="prc-date">${r.savedAt?.seconds ? new Date(r.savedAt.seconds*1000).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) : "—"}</div>
            </div>
            <div class="prc-stats">
              <span>🏏 ${r.playersCount||0} players bought</span>
              <span>💰 ₹${r.budgetLeft||0} Cr remaining</span>
              <span>💸 ₹${r.spent||0} Cr spent</span>
            </div>
            <div class="prc-host">Hosted by ${escapeHtml(r.hostName||"Unknown")}</div>
          </div>`).join("");
      }
    } catch(e) {
      roomsList.innerHTML = `<div class="no-rooms">Failed to load history.</div>`;
    }
  }

  document.getElementById("profileSignOutBtn")?.addEventListener("click", async () => {
    await signOutUser();
    window.location.href = "index.html";
  });
  document.getElementById("backHomeBtn")?.addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

// ─────────────────────────────────────────────
// Master Room Update
// ─────────────────────────────────────────────
function onRoomUpdate(data) {
  AppState.lastRoomSnapshot = data;
  AppState.isHost           = data.hostId === AppState.userId;
  AppState.auctionPaused    = data.auctionState === "paused";

  renderLobby(data);
  renderLeaderboard(data);
  renderAllTeams(data);
  renderQueuePreview(data);

  const me = data.members?.[AppState.userId];
  if (me) renderMyBudget(me);
  checkOutbidNotification(data);

  if (data.status === "waiting") {
    showSection("lobbySection"); hideSection("auctionSection"); hideSection("finishedSection");
    renderStartButton(data);
  } else if (data.status === "auction") {
    hideSection("lobbySection"); showSection("auctionSection"); hideSection("finishedSection");
    renderHostControls(data);
    handleAuctionState(data);
  } else if (data.status === "finished") {
    hideSection("lobbySection"); hideSection("auctionSection"); showSection("finishedSection");
    stopTimer();
    renderFinalResults(data);
  }
}

function checkOutbidNotification(data) {
  if (!data.auction || data.auction.status !== "live") return;
  const auction  = data.auction;
  const wasWin   = AppState.wasHighestBidder;
  const isNowWin = auction.highestBidderId === AppState.userId;
  if (wasWin && !isNowWin && auction.currentBid > AppState.lastOutbidBid) {
    showToast(`😱 You were outbid! Current: ₹${auction.currentBid} Cr`, "warning");
    AppState.lastOutbidBid = auction.currentBid;
  }
  AppState.wasHighestBidder = isNowWin;
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────
function generateRoomCode() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:6}, ()=>c[Math.floor(Math.random()*c.length)]).join("");
}

function setButtonLoading(id, loading) {
  const btn = document.getElementById(id); if (!btn) return;
  btn.disabled = loading;
  btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
  btn.textContent = loading ? "Loading…" : btn.dataset.originalText;
}

function showSection(id) { const el=document.getElementById(id); if(el) el.style.display=""; }
function hideSection(id) { const el=document.getElementById(id); if(el) el.style.display="none"; }

async function handleLeaveRoom() {
  if (AppState.unsubscribeRoom) AppState.unsubscribeRoom();
  if (typeof ChatState !== "undefined" && ChatState.unsubscribe) ChatState.unsubscribe();
  if (typeof HistoryState !== "undefined" && HistoryState.unsubscribe) HistoryState.unsubscribe();
  stopTimer();
  localStorage.removeItem("iplCurrentRoom");
  window.location.href = "index.html";
}
