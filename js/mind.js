/* ============================================================
   mind.js — Home Page
   DropBeam Phase 3
============================================================ */

import {
  getSetting, setSetting,
  getRecentRooms, clearRecentRooms, saveRecentRoom,
  getStats,
} from "./storage.js";
import { PeerEncryption } from "./encryption.js";
import { createRoom, getRoom } from "./firebase2.js";

// ============================================================
//   CLOCK
// ============================================================
function startClock() {
  const el = document.getElementById("sysClock");
  if (!el) return;
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString("en-US",{ hour12:false });
    setTimeout(tick, 1000);
  };
  tick();
}

// ============================================================
//   UTILS
// ============================================================
function $(id) { return document.getElementById(id); }

function toast(msg, type = "info", dur = 3000) {
  const stack = $("toastStack");
  const icons = { info:"ℹ", success:"✓", error:"✗", warn:"⚠" };
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<span class="t-ico" style="color:${
    type==="success"?"var(--green)":type==="error"?"var(--red)":"var(--amber)"}">${icons[type]||"·"}</span>
    <span class="t-msg">${msg}</span>
    <button class="t-close">✕</button>`;
  stack.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  const close = () => { t.classList.remove("show"); setTimeout(()=>t.remove(),350); };
  t.querySelector(".t-close").addEventListener("click", close);
  setTimeout(close, dur);
}

function showOverlay(msg = "WORKING...") {
  $("sysMsg").textContent = msg;
  $("sysOverlay").classList.remove("hidden");
}
function hideOverlay() { $("sysOverlay").classList.add("hidden"); }

// ============================================================
//   THEME
// ============================================================
async function initTheme() {
  const saved = await getSetting("theme", "dark");
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeIcon(saved);
  $("themeToggle")?.addEventListener("click", async () => {
    const cur  = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    await setSetting("theme", next);
    updateThemeIcon(next);
  });
}
function updateThemeIcon(t) {
  const el = $("themeIcon");
  if (el) el.textContent = t === "dark" ? "◐" : "◑";
}

// ============================================================
//   PWA INSTALL
// ============================================================
let _pwaPrompt = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  _pwaPrompt = e;
  $("installBtn").hidden = false;
});
$("installBtn")?.addEventListener("click", async () => {
  if (!_pwaPrompt) return;
  _pwaPrompt.prompt();
  const { outcome } = await _pwaPrompt.userChoice;
  if (outcome === "accepted") {
    toast("App installed!", "success");
    $("installBtn").hidden = true;
  }
  _pwaPrompt = null;
});

// ============================================================
//   RECENT ROOMS
// ============================================================
async function loadRecentRooms() {
  const rooms = await getRecentRooms(5);
  const sec   = $("recentSection");
  const list  = $("recentList");
  if (!rooms.length) { sec.classList.add("hidden"); return; }
  sec.classList.remove("hidden");
  list.innerHTML = "";
  rooms.forEach(r => {
    const el = document.createElement("div");
    el.className = "recent-item";
    el.innerHTML = `
      <span class="ri-code">${r.roomId}</span>
      <span class="ri-time">${timeAgo(r.lastUsed)}</span>
      <span class="ri-arrow">→</span>`;
    el.addEventListener("click", () => {
      $("roomCodeInput").value = r.roomId.replace(/-/g,"");
      $("roomCodeInput").focus();
    });
    list.appendChild(el);
  });
  $("clearRecentBtn")?.addEventListener("click", async () => {
    await clearRecentRooms();
    sec.classList.add("hidden");
  });
}

function timeAgo(ts) {
  const s = Math.floor((Date.now()-ts)/1000);
  if (s < 60)    return s + "s ago";
  if (s < 3600)  return Math.floor(s/60) + "m ago";
  if (s < 86400) return Math.floor(s/3600) + "h ago";
  return Math.floor(s/86400) + "d ago";
}

// ============================================================
//   STATS
// ============================================================
async function loadStats() {
  const s   = await getStats();
  const bar = $("statsBar");
  if (s.sent === 0 && s.received === 0) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  $("statSent").textContent  = s.sent;
  $("statRecvd").textContent = s.received;
  const mb = (s.totalBytes / (1024*1024)).toFixed(1);
  $("statBytes").textContent = mb + " MB";
}

// ============================================================
//   ROOM ID GENERATION
// ============================================================
function genId() {
  const C = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const p = n => Array.from({length:n}, ()=>C[Math.floor(Math.random()*C.length)]).join("");
  return `${p(3)}-${p(3)}`;
}

function goToRoom(roomId, role) {
  sessionStorage.setItem("db_room", roomId);
  sessionStorage.setItem("db_role", role);
  window.location.href = `room2.html?room=${roomId}&role=${role}`;
}

// ============================================================
//   CREATE ROOM
// ============================================================
$("createRoomBtn")?.addEventListener("click", async () => {
  showOverlay("CREATING ROOM...");
  try {
    const roomId  = genId();
    const usePass = $("usePassword").checked;
    const passVal = $("roomPassword").value;
    const expiry  = parseInt($("roomExpiry").value, 10);

    let passwordHash = null;
    if (usePass && passVal) {
      passwordHash = await PeerEncryption.hashPassword(passVal);
    }

    await createRoom(roomId, { passwordHash, expiryMinutes: expiry });
    await saveRecentRoom(roomId, { hasPassword: !!passwordHash });
    hideOverlay();
    goToRoom(roomId, "host");
  } catch(e) {
    hideOverlay();
    toast("Firebase error: " + e.message, "error", 6000);
    console.error(e);
  }
});

$("usePassword")?.addEventListener("change", e => {
  $("passwordGroup").classList.toggle("hidden", !e.target.checked);
});

// ============================================================
//   JOIN ROOM
// ============================================================
async function doJoin() {
  const raw  = $("roomCodeInput").value.trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  const errEl= $("joinError");
  errEl.classList.add("hidden");

  // Normalize to "XXX-XXX"
  const code = raw.length === 6 ? `${raw.slice(0,3)}-${raw.slice(3)}` : raw;
  if (code.replace("-","").length < 4) {
    errEl.classList.remove("hidden"); return;
  }

  showOverlay("LOCATING ROOM...");
  try {
    const room = await getRoom(code);
    if (!room) {
      hideOverlay();
      errEl.textContent = "// ERROR: Room not found or has expired";
      errEl.classList.remove("hidden"); return;
    }

    if (room.hasPassword) {
      hideOverlay();
      $("joinPassGroup").classList.remove("hidden");
      sessionStorage.setItem("db_pending_room", code);
      $("joinPassword").focus();
      toast("Room is password-protected", "warn");
      return;
    }

    await saveRecentRoom(code);
    hideOverlay();
    goToRoom(code, "guest");
  } catch(e) {
    hideOverlay();
    toast("Error: " + e.message, "error");
  }
}

$("joinRoomBtn")?.addEventListener("click", doJoin);
$("roomCodeInput")?.addEventListener("keydown", e => {
  if (e.key === "Enter") doJoin();
  $("joinError").classList.add("hidden");
});

// Password-protected join
$("joinPassword")?.addEventListener("keydown", async e => {
  if (e.key !== "Enter") return;
  const code = sessionStorage.getItem("db_pending_room");
  if (!code) return;
  showOverlay("VERIFYING...");
  try {
    const room = await getRoom(code);
    const ok   = await PeerEncryption.verifyPassword($("joinPassword").value, room.passwordHash);
    if (!ok) {
      hideOverlay();
      toast("Wrong password", "error"); return;
    }
    await saveRecentRoom(code);
    hideOverlay();
    goToRoom(code, "guest");
  } catch(e) {
    hideOverlay();
    toast("Error: " + e.message, "error");
  }
});

// ============================================================
//   QR SCANNER
// ============================================================
let _qrStream = null;
$("scanQrBtn")?.addEventListener("click", () => {
  $("qrModal").classList.remove("hidden");
  _startQr();
});
$("closeQrModal")?.addEventListener("click", () => {
  $("qrModal").classList.add("hidden");
  _stopQr();
});
$("qrLinkJoinBtn")?.addEventListener("click", () => {
  const link = $("qrLinkInput").value.trim();
  try {
    const url  = new URL(link);
    const room = url.searchParams.get("room");
    if (room) {
      $("qrModal").classList.add("hidden");
      _stopQr();
      $("roomCodeInput").value = room;
      doJoin();
    } else {
      toast("No room code found in link", "error");
    }
  } catch {
    toast("Invalid URL", "error");
  }
});

function _startQr() {
  if (!navigator.mediaDevices?.getUserMedia) return;
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
    .then(s => { _qrStream = s; $("qrVideo").srcObject = s; })
    .catch(() => toast("Camera unavailable", "warn"));
}
function _stopQr() {
  _qrStream?.getTracks().forEach(t=>t.stop());
  _qrStream = null;
  $("qrVideo").srcObject = null;
}

// ============================================================
//   INIT
// ============================================================
async function init() {
  // Register SW
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("../service-worker.js").catch(() => {});
  }

  // Pre-fill from URL
  const params  = new URLSearchParams(window.location.search);
  const urlRoom = params.get("room");
  if (urlRoom) {
    const inp = $("roomCodeInput");
    if (inp) { inp.value = urlRoom.replace(/-/g,""); }
    toast(`Room code ready: ${urlRoom}`, "info");
  }

  startClock();
  await initTheme();
  await loadRecentRooms();
  await loadStats();
}

document.addEventListener("DOMContentLoaded", init);
