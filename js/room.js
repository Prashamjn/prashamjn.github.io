/* ============================================================
   room.js — Room Dashboard
   DropBeam Phase 3
============================================================ */

import { MeshRoom } from "./webrtc.js";
import {
  addPeerToRoom, listenRoom,
  pushChatMessage, listenChat,
  closeRoom,
} from "./firebase2.js";
import {
  fmtBytes, fmtSpeed, fileEmoji,
  previewType, timeAgo, MAX_FILE_BYTES
} from "./chunkManager.js";
import {
  getSetting, setSetting,
  getHistory, deleteHistory, clearHistory,
  saveRecentRoom,
} from "./storage.js";

// ============================================================
//   STATE
// ============================================================
let roomId   = null;
let myId     = null;
let myName   = null;
let myRole   = null;
let mesh     = null;

const peers  = new Map();  // id → { name, online }
const blobs  = new Map();  // transferId → { blob, meta }
let pending  = null;       // currentIncoming { fromId, meta }
let msgCount = 0;
let actHas   = false;
let histFilter = "all";
let qrDone   = false;
let qrStream = null;

const EMOJI_LIST = ["😀","😂","😎","🔥","💡","✅","⚡","🎯","🚀","👍","❤️","🤔","😮","👋","🎉","💯","🤝","⭐","📁","🔐","💻","🌊","🎨","📦","⚙️","🐍","☕","🌐"];

// ============================================================
//   UTILS
// ============================================================
const $ = id => document.getElementById(id);

function toast(msg, type = "info", dur = 3000) {
  const stack = $("toastStack");
  const cols  = { info:"var(--text2)", success:"var(--green)", error:"var(--red)", warn:"var(--amber)" };
  const icons = { info:"ℹ", success:"✓", error:"✗", warn:"⚠" };
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<span class="t-ico" style="color:${cols[type]}">${icons[type]}</span>
    <span class="t-msg">${msg}</span>
    <button class="t-close">✕</button>`;
  stack.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  const close = () => { t.classList.remove("show"); setTimeout(()=>t.remove(),350); };
  t.querySelector(".t-close").addEventListener("click", close);
  setTimeout(close, dur);
}

function timeStr(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
}

// ============================================================
//   THEME
// ============================================================
async function initTheme() {
  const saved = await getSetting("theme","dark");
  document.documentElement.setAttribute("data-theme", saved);
  $("themeIcon").textContent = saved === "dark" ? "◐" : "◑";
  $("themeToggle")?.addEventListener("click", async () => {
    const c = document.documentElement.getAttribute("data-theme");
    const n = c === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", n);
    await setSetting("theme", n);
    $("themeIcon").textContent = n === "dark" ? "◐" : "◑";
  });
}

// ============================================================
//   CONNECTION STATUS
// ============================================================
function setConn(state, label) {
  const dot    = $("ciDot");
  const txt    = $("ciText");
  const mobDot = $("mobileConnDot");
  const mobTxt = $("mobileConnText");
  if (dot)    dot.className    = "ci-dot " + state;
  if (txt)    txt.textContent  = label.toUpperCase();
  if (mobDot) mobDot.className = "ci-dot " + state;
  if (mobTxt) mobTxt.textContent = label.toUpperCase();
}

// ============================================================
//   USERS
// ============================================================
function renderUsers() {
  const list       = $("usersList");
  const badge      = $("peerBadge");
  const cnt        = $("peerCountVal");
  const roleEl     = $("myRoleVal");          // fixed: was myRoleDisp
  const mobileCnt  = $("mobilePeerCount");
  const connPeers  = mesh?.connectedPeers() || [];

  if (!list) return; // guard: DOM not ready

  let html = `
    <div class="user-item">
      <div class="u-avatar me-av">${(myName || "?").charAt(0)}</div>
      <div class="u-info">
        <div class="u-name">${myName || "You"} <span style="opacity:.4;font-size:.65rem">(you)</span></div>
        <div class="u-role">${myRole === "host" ? "HOST" : "GUEST"}</div>
      </div>
      <span class="u-dot on"></span>
    </div>`;

  connPeers.forEach(p => {
    html += `
    <div class="user-item">
      <div class="u-avatar peer-av">${(p.name || "?").charAt(0)}</div>
      <div class="u-info">
        <div class="u-name">${p.name}</div>
        <div class="u-role">PEER</div>
      </div>
      <span class="u-dot on"></span>
    </div>`;
  });

  if (connPeers.length === 0) {
    html += `<div style="padding:8px 10px;font-size:.68rem;color:var(--text3)">// no peers yet</div>`;
  }

  list.innerHTML = html;
  const total = connPeers.length + 1;
  if (badge)     badge.textContent    = total.toString().padStart(2, "0");
  if (cnt)       cnt.textContent      = connPeers.length;
  if (roleEl)    roleEl.textContent   = myRole === "host" ? "HOST" : "GUEST";
  if (mobileCnt) mobileCnt.textContent = total;
  renderPeerTarget();
}

// ============================================================
//   PEER TARGET SELECTOR
// ============================================================
const selPeers = new Set();

function renderPeerTarget() {
  const peers = mesh?.connectedPeers() || [];
  const wrap  = $("peerTarget");
  const list  = $("peerTargetList");
  if (!peers.length) { wrap.classList.add("hidden"); return; }
  wrap.classList.remove("hidden");

  list.innerHTML = `<div class="pt-chip sel" data-id="all">EVERYONE</div>` +
    peers.map(p => `<div class="pt-chip" data-id="${p.id}">${p.name.toUpperCase()}</div>`).join("");

  list.querySelectorAll(".pt-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      if (chip.dataset.id === "all") {
        selPeers.clear();
        list.querySelectorAll(".pt-chip").forEach(c => c.classList.remove("sel"));
        chip.classList.add("sel");
      } else {
        list.querySelector("[data-id='all']").classList.remove("sel");
        chip.classList.toggle("sel");
        if (chip.classList.contains("sel")) selPeers.add(chip.dataset.id);
        else selPeers.delete(chip.dataset.id);
        if (selPeers.size === 0) list.querySelector("[data-id='all']").classList.add("sel");
      }
    });
  });
}

// ============================================================
//   WAITING / CONNECTED UI
// ============================================================
function showConnected(yes) {
  $("waitState").classList.toggle("hidden", yes);
  $("connState").classList.toggle("hidden", !yes);
}

function updateWaitCode(code) {
  const el = $("waitRoomCode");
  if (el) el.textContent = code;
  $("waitCopyCode")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(code);
    toast("Room code copied", "success");
  });
  $("waitCopyLink")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(roomLink());
    toast("Link copied", "success");
  });
}

function roomLink() {
  return `${location.origin}${location.pathname.replace("room2.html","dropbeam.html")}?room=${roomId}`;
}

// ============================================================
//   ACTIVITY FEED
// ============================================================
function addActivity(text, col = "var(--green)") {
  const feed = $("actFeed");
  if (!actHas) { feed.innerHTML = ""; actHas = true; }
  const el = document.createElement("div");
  el.className = "af-entry";
  el.innerHTML = `
    <span class="af-sig" style="background:${col}"></span>
    <span class="af-body">${text}</span>
    <span class="af-ts">${timeStr()}</span>`;
  feed.prepend(el);
}

// ============================================================
//   TRANSFER CARDS
// ============================================================
const txCards = new Map(); // transferId → { el, fill, statEl, speedEl, badgeEl }

function makeTxCard(tid, dir, fileName, fileSize, peerName) {
  const icon  = fileEmoji(fileName);
  const badge = dir === "send" ? "SENDING" : "RECEIVING";
  const bCls  = dir === "send" ? "b-sending" : "b-receiving";
  const fCls  = dir === "send" ? "tx-fill-s" : "tx-fill-r";

  const el = document.createElement("div");
  el.id = `tx-${tid}`;
  el.className = "tx-item active";
  el.innerHTML = `
    <div class="tx-head">
      <span class="tx-icon">${icon}</span>
      <div class="tx-meta">
        <div class="tx-name">${fileName}</div>
        <div class="tx-sub">${fmtBytes(fileSize)} · ${dir === "send" ? "→" : "←"} ${peerName}</div>
      </div>
      <div class="tx-badges">
        <span class="tx-badge ${bCls}" id="badge-${tid}">${badge}</span>
      </div>
    </div>
    <div class="tx-bar-wrap">
      <div class="tx-track"><div class="tx-fill ${fCls}" id="fill-${tid}" style="width:0%"></div></div>
      <div class="tx-stats">
        <span id="pct-${tid}">0%</span>
        <span id="spd-${tid}"></span>
      </div>
    </div>`;

  $("activeTransfers").prepend(el);
  txCards.set(tid, {
    el,
    fill:  $(`fill-${tid}`),
    pct:   $(`pct-${tid}`),
    spd:   $(`spd-${tid}`),
    badge: $(`badge-${tid}`),
  });
  return el;
}

function updateTxCard(tid, pct, speed) {
  const c = txCards.get(tid);
  if (!c) return;
  c.fill.style.width = pct + "%";
  c.pct.textContent  = pct + "%";
  c.spd.textContent  = fmtSpeed(speed);
}

function finishTxCard(tid, ok = true, direction = "send") {
  const c = txCards.get(tid);
  if (!c) return;
  c.fill.style.width  = "100%";
  c.fill.className    = "tx-fill tx-fill-d";
  c.pct.textContent   = "100%";
  c.spd.textContent   = "";
  c.badge.textContent = ok ? "DONE ✓" : "FAILED";
  c.badge.className   = "tx-badge " + (ok ? "b-done" : "b-error");
  c.el.classList.remove("active");

  if (direction === "send") {
    // Sent files: fade out after 6 seconds
    setTimeout(() => {
      c.el.style.opacity   = "0";
      c.el.style.transform = "translateX(8px)";
      c.el.style.transition = "all .4s";
      setTimeout(() => { c.el.remove(); txCards.delete(tid); }, 400);
    }, 6000);
  }
  // Receive cards stay until user clicks Dismiss — handled in onFileComplete
}

// ============================================================
//   DROP ZONE
// ============================================================
function initDropZone() {
  const zone    = $("dropZone");
  const overlay = $("dzOverlay");
  const input   = $("fileInput");
  const inner   = $("dzInner");
  const browse  = $("browseTrigger");

  browse?.addEventListener("click", e => { e.stopPropagation(); input.click(); });
  inner?.addEventListener("click", () => input.click());

  input?.addEventListener("change", e => {
    [...e.target.files].forEach(f => sendFile(f));
    input.value = "";
  });

  zone?.addEventListener("dragover",  e => { e.preventDefault(); overlay.classList.add("active"); });
  zone?.addEventListener("dragleave", e => { if (!zone.contains(e.relatedTarget)) overlay.classList.remove("active"); });
  zone?.addEventListener("drop",      e => {
    e.preventDefault(); overlay.classList.remove("active");
    [...e.dataTransfer.files].forEach(f => sendFile(f));
  });
}

async function sendFile(file) {
  if (file.size > MAX_FILE_BYTES) {
    toast(`${file.name} exceeds 500 MB`, "error"); return;
  }
  const connPeers = mesh?.connectedPeers() || [];
  if (!connPeers.length) { toast("No peers connected", "warn"); return; }

  const targets = selPeers.size > 0 ? [...selPeers] : connPeers.map(p=>p.id);

  for (const pid of targets) {
    const pname = connPeers.find(p=>p.id===pid)?.name || "peer";
    const tid   = await mesh.offerFile(file, pid);
    makeTxCard(tid, "send", file.name, file.size, pname);
    addActivity(`Offering <strong>${file.name}</strong> → ${pname}`, "var(--green)");
  }
  navigator.vibrate?.(40);
}

// ============================================================
//   INCOMING FILE MODAL
// ============================================================
function showIncoming(fromId, fromName, meta) {
  pending = { fromId, meta };
  $("incomingIcon").textContent  = fileEmoji(meta.fileName, meta.mimeType);
  $("incomingFrom").textContent  = fromName;
  $("incomingName").textContent  = meta.fileName;
  $("incomingSize").textContent  = fmtBytes(meta.fileSize);
  $("incomingType").textContent  = meta.mimeType || "unknown";
  $("incomingModal").classList.remove("hidden");
  navigator.vibrate?.([80, 40, 80]);
}

$("acceptBtn")?.addEventListener("click", () => {
  if (!pending) return;
  const { fromId, meta } = pending;
  mesh?.acceptFile(meta.transferId, fromId);
  $("incomingModal").classList.add("hidden");
  makeTxCard(meta.transferId, "recv", meta.fileName, meta.fileSize, peers.get(fromId)?.name || fromId.slice(0,6));
  addActivity(`Accepting <strong>${meta.fileName}</strong>`, "var(--blue)");
  pending = null;
});

$("rejectBtn")?.addEventListener("click", () => {
  if (!pending) return;
  mesh?.rejectFile(pending.meta.transferId, pending.fromId);
  $("incomingModal").classList.add("hidden");
  addActivity("File declined", "var(--red)");
  pending = null;
});

// ============================================================
//   FILE PREVIEW
// ============================================================
function showPreview(blob, fileName, mimeType) {
  const type = previewType(fileName, mimeType);
  const body = $("previewBody");
  $("previewFilename").textContent = fileName;
  body.innerHTML = "";

  if (type === "image") {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(blob);
    body.appendChild(img);
  } else if (type === "video") {
    const vid = document.createElement("video");
    vid.src = URL.createObjectURL(blob);
    vid.controls = true;
    body.appendChild(vid);
  } else {
    body.innerHTML = `<div class="preview-pdf-stub">// PREVIEW UNAVAILABLE<br/>Use download instead.</div>`;
  }

  $("previewModal").classList.remove("hidden");
  $("previewDlBtn").onclick = () => dlBlob(blob, fileName);
}

$("closePreviewBtn")?.addEventListener("click", () => $("previewModal").classList.add("hidden"));

function dlBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================
//   HISTORY
// ============================================================
async function loadHistory(filter = "all") {
  histFilter = filter;
  document.querySelectorAll(".filt").forEach(b => b.classList.toggle("active", b.dataset.f === filter));
  const items = await getHistory(filter);
  const list  = $("histList");

  if (!items.length) {
    list.innerHTML = `<div class="empty-msg">// NO_HISTORY_FOUND</div>`;
    return;
  }

  list.innerHTML = items.map(h => {
    const icon = fileEmoji(h.fileName, h.mimeType);
    const hasDl = h.blob && h.direction === "received";
    const hasPv = h.blob && previewType(h.fileName, h.mimeType);
    return `
    <div class="hist-item">
      <span class="hi-icon">${icon}</span>
      <div class="hi-meta">
        <div class="hi-name">${h.fileName}</div>
        <div class="hi-detail">${fmtBytes(h.fileSize)} · ${h.peerName} · ${timeAgo(h.timestamp)}</div>
      </div>
      <div class="hi-right">
        <span class="${h.direction === "sent" ? "hi-dir-s" : "hi-dir-r"}">${h.direction === "sent" ? "↑ SENT" : "↓ RECV"}</span>
        <span class="hi-sz">${fmtBytes(h.fileSize)}</span>
        ${hasDl ? `<button class="dl-btn" data-id="${h.id}" data-act="dl">DOWNLOAD</button>` : ""}
        ${hasPv ? `<button class="dl-btn" data-id="${h.id}" data-act="pv" style="margin-top:2px">PREVIEW</button>` : ""}
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const all  = await getHistory("all");
      const item = all.find(h => h.id === btn.dataset.id);
      if (!item?.blob) return;
      const b = item.blob instanceof Blob ? item.blob : new Blob([item.blob], { type: item.mimeType });
      if (btn.dataset.act === "dl") dlBlob(b, item.fileName);
      else showPreview(b, item.fileName, item.mimeType);
    });
  });
}

document.querySelectorAll(".filt").forEach(b => {
  b.addEventListener("click", () => loadHistory(b.dataset.f));
});
$("clearHistBtn")?.addEventListener("click", async () => {
  await clearHistory();
  loadHistory(histFilter);
});

// ============================================================
//   CHAT
// ============================================================
function appendMsg(who, sender, text, ts = Date.now(), isClip = false, clipContent = null) {
  const feed  = $("chatMessages");
  const empty = feed.querySelector(".chat-empty");
  if (empty) empty.remove();

  msgCount++;
  $("msgCountBadge").textContent = msgCount;

  const el  = document.createElement("div");
  const cls = who === "me" ? "msg-me" : who === "sys" ? "msg-sys" : "msg-peer";
  el.className = "msg-row " + cls;

  if (isClip && clipContent) {
    el.innerHTML = `
      <div class="msg-bubble">
        <div class="clip-msg">
          <div class="clip-msg-label">// SHARED_CLIPBOARD</div>
          <div>${escHtml(clipContent.substring(0, 400))}${clipContent.length>400?"...":""}</div>
        </div>
      </div>
      <div class="msg-meta">
        <span class="msg-sender">${who==="me"?"YOU":sender}</span>
        <span>${timeStr(ts)}</span>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="msg-bubble">${linkify(escHtml(text))}</div>
      ${who !== "sys" ? `<div class="msg-meta"><span class="msg-sender">${who==="me"?"YOU":sender}</span><span>${timeStr(ts)}</span></div>` : ""}`;
  }

  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;

  // Mobile unread badge: show when chat panel is not visible
  if (who !== "me" && who !== "sys") {
    const chatRail = document.querySelector(".chat-rail");
    if (!chatRail?.classList.contains("mobile-open")) {
      const badge = document.getElementById("mobileUnread");
      if (badge) {
        const cur = parseInt(badge.textContent || "0", 10);
        badge.textContent = cur + 1;
        badge.hidden = false;
      }
    }
  }
}

function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function linkify(s) {
  return s.replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" target="_blank" style="color:var(--green)">${"$1"}</a>`);
}

async function sendChat() {
  const input = $("chatInput");
  const text  = input.value.trim();
  if (!text) return;
  input.value = "";

  mesh?.sendChat(text);
  appendMsg("me", myName, text);

  // Also push to Firestore for late-joiners
  try {
    await pushChatMessage(roomId, { senderId: myId, senderName: myName, text, timestamp: Date.now() });
  } catch(_) {}
}

$("chatSendBtn")?.addEventListener("click", sendChat);
$("chatInput")?.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

// Emoji picker
$("emojiToggle")?.addEventListener("click", () => {
  const p    = $("emojiPicker");
  p.classList.toggle("hidden");
  if (!p.classList.contains("hidden")) {
    let grid = p.querySelector(".emoji-grid");
    if (!grid) {
      grid = document.createElement("div");
      grid.className = "emoji-grid";
      grid.innerHTML = EMOJI_LIST.map(e=>`<button>${e}</button>`).join("");
      p.appendChild(grid);
      grid.querySelectorAll("button").forEach(b => {
        b.addEventListener("click", () => {
          $("chatInput").value += b.textContent;
          $("chatInput").focus();
          p.classList.add("hidden");
        });
      });
    }
  }
});

// ============================================================
//   CLIPBOARD PANEL
// ============================================================
$("sendClipBtn")?.addEventListener("click", () => {
  const text = $("clipArea").value.trim();
  if (!text) { toast("Nothing to share", "warn"); return; }
  mesh?.sendClipboard(text, "text");
  appendMsg("me", myName, "", Date.now(), true, text);
  $("clipArea").value = "";
  addActivity("Shared clipboard content", "var(--green)");
  toast("Clipboard broadcast!", "success");
});

// ============================================================
//   QR CODE
// ============================================================
$("sidebarShowQR")?.addEventListener("click", () => {
  const box = $("qrBox");
  box.classList.toggle("hidden");
  if (!box.classList.contains("hidden") && !qrDone) {
    const link = roomLink();
    const qrEl = $("roomQrCode");
    qrEl.innerHTML = "";
    new QRCode(qrEl, {
      text: link, width:130, height:130,
      colorDark: document.documentElement.getAttribute("data-theme") === "dark" ? "#080c08" : "#0d1f0d",
      colorLight:"#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
    qrDone = true;
  }
});

$("sidebarCopyLink")?.addEventListener("click", () => {
  navigator.clipboard?.writeText(roomLink());
  toast("Link copied!", "success");
});
$("copyRidBtn")?.addEventListener("click", () => {
  navigator.clipboard?.writeText(roomId);
  toast("Room ID copied", "success");
});
$("headerRoomId")?.addEventListener("click", () => {
  navigator.clipboard?.writeText(roomId);
  toast("Copied!", "success");
});
$("copyLinkBtn")?.addEventListener("click", () => {
  navigator.clipboard?.writeText(roomLink());
  toast("Link copied!", "success");
});

// ============================================================
//   TABS
// ============================================================
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach(p => p.classList.add("hidden"));
    btn.classList.add("active");
    $(`pane-${btn.dataset.tab}`)?.classList.remove("hidden");
    if (btn.dataset.tab === "history") loadHistory(histFilter);
  });
});

// ============================================================
//   LEAVE
// ============================================================
$("leaveBtn")?.addEventListener("click", async () => {
  if (mesh) await mesh.destroy();
  if (myRole === "host") { try { await closeRoom(roomId); } catch(_){} }
  window.location.href = "dropbeam.html";
});
window.addEventListener("beforeunload", () => mesh?.destroy());

// ============================================================
//   INIT
// ============================================================
async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("../service-worker.js").catch(()=>{});
  }

  const params = new URLSearchParams(window.location.search);
  roomId  = params.get("room") || sessionStorage.getItem("db_room");
  myRole  = params.get("role") || sessionStorage.getItem("db_role") || "guest";

  if (!roomId) { window.location.href = "dropbeam.html"; return; }

  // Generate identity
  myId   = crypto.randomUUID();
  const ADJS  = ["Fast","Bold","Dark","Cool","Sharp","Deep","Swift","Raw"];
  const NOUNS = ["Node","Beam","Link","Wave","Echo","Byte","Grid","Flux"];
  myName = `${ADJS[Math.floor(Math.random()*8)]}${NOUNS[Math.floor(Math.random()*8)]}`;

  // Populate UI
  $("headerRoomId").textContent = roomId;
  $("waitRoomCode").textContent = roomId;
  $("expiryVal").textContent    = "SESSION";

  await initTheme();
  updateWaitCode(roomId);
  setConn("connecting", "Connecting");
  addActivity(`Joined room <strong>${roomId}</strong> as ${myRole}`, "var(--green)");

  await saveRecentRoom(roomId);

  // Register in Firestore room doc
  try {
    await addPeerToRoom(roomId, myId, myName);
  } catch(e) {
    console.error("Firebase:", e);
    toast("Firebase error — check config in firebase2.js", "error", 8000);
  }

  // Listen for new peers joining via Firestore.
  // IMPORTANT: Only the peer with the lexicographically SMALLER ID creates the offer.
  // This prevents both peers simultaneously calling createOffer (InvalidStateError).
  listenRoom(roomId, async data => {
    const roomPeers = data.peers || [];
    for (const p of roomPeers) {
      if (p.id === myId) continue;                  // skip self
      if (mesh?.links.has(p.id)) continue;          // already connected
      if (myId < p.id) {
        // We are the "caller" — initiate the offer
        mesh?.connectTo(p.id, p.name).catch(console.error);
      }
      // else: we are the "callee" — we wait for their offer via listenSignals
    }
  });

  // Build mesh
  mesh = new MeshRoom(roomId, myId, myName, myRole === "host", {

    onPeerJoined(id, name) {
      peers.set(id, { name, online: true });
      renderUsers();
      showConnected(true);
      setConn("connected", "Connected");
      appendMsg("sys", "", `${name} connected`);
      addActivity(`<strong>${name}</strong> established P2P link`, "var(--green)");
      toast(`${name} joined`, "success");
      $("encBadge").classList.add("active");
      loadHistory();
    },

    onPeerLeft(id, name) {
      peers.delete(id);
      renderUsers();
      if ((mesh?.connectedPeerIds().length || 0) === 0) {
        showConnected(false);
        setConn("connecting", "Waiting");
      }
      appendMsg("sys", "", `${name || "peer"} disconnected`);
      addActivity(`<strong>${name || "peer"}</strong> left`, "var(--red)");
    },

    onEncReady(id) {
      addActivity(`🔐 E2E encryption ready with <strong>${peers.get(id)?.name}</strong>`, "var(--green)");
      $("encBadge").textContent = "🔐 ENC:ON";
    },

    onFileIncoming(fromId, fromName, meta) {
      showIncoming(fromId, fromName, meta);
      addActivity(`Incoming <strong>${meta.fileName}</strong> from ${fromName}`, "var(--blue)");
    },

    onFileProgress(tid, pct, speed)       { updateTxCard(tid, pct, speed); },

    onFileComplete(tid, blob, meta, fromId) {
      // Mark card as done, keep visible for receiver to download
      finishTxCard(tid, true, "recv");
      blobs.set(tid, { blob, meta });
      const fn   = meta.fileName;
      const from = peers.get(fromId)?.name || fromId.slice(0,6);

      // Pre-create the object URL so it's ready for instant download
      const objUrl = URL.createObjectURL(blob);

      // Add a prominent DOWNLOAD NOW button to the card
      // User must tap it — browsers block auto-downloads outside user gestures
      setTimeout(() => {
        const card = $(`tx-${tid}`);
        if (card) {
          const acts = document.createElement("div");
          acts.className = "tx-actions";
          const pv = previewType(fn, meta.mimeType);

          // Create a real <a> tag that looks like a button — this bypasses
          // the browser's popup blocker since it is a direct link click
          acts.innerHTML = `
            <a class="dl-now-btn" href="${objUrl}" download="${fn}" id="dl-${tid}">
              ↓ DOWNLOAD NOW
            </a>
            ${pv ? `<button class="sm-btn" id="pv-${tid}">👁 PREVIEW</button>` : ""}
            <button class="sm-btn sm-btn-dismiss" id="dis-${tid}">DISMISS ✕</button>`;
          card.appendChild(acts);

          // Preview button
          document.getElementById(`pv-${tid}`)?.addEventListener("click", () =>
            showPreview(blob, fn, meta.mimeType)
          );

          // Dismiss button — revoke URL to free memory
          document.getElementById(`dis-${tid}`)?.addEventListener("click", () => {
            URL.revokeObjectURL(objUrl);
            const txCard = txCards.get(tid);
            if (txCard) {
              txCard.el.style.opacity    = "0";
              txCard.el.style.transform  = "translateX(8px)";
              txCard.el.style.transition = "all .3s";
              setTimeout(() => { txCard.el.remove(); txCards.delete(tid); }, 300);
            }
          });

          // Auto-click the download link — works in most browsers when the
          // element is actually in the DOM and href is a blob URL
          setTimeout(() => {
            const dlLink = document.getElementById(`dl-${tid}`);
            if (dlLink) dlLink.click();
          }, 200);
        }
      }, 100);

      addActivity(`<strong>${fn}</strong> received from ${from}`, "var(--green)");
      toast(`${fn} ready — tap DOWNLOAD NOW`, "success", 5000);
      loadHistory();
      navigator.vibrate?.([100, 50, 100]);
    },

    onFileSendProgress(tid, pct, speed)    { updateTxCard(tid, pct, speed); },

    onFileSendComplete(tid) {
      finishTxCard(tid, true, "send");
      addActivity("Transfer complete", "var(--green)");
      toast("File sent!", "success");
      loadHistory();
    },

    onFileSendError(tid, msg) {
      finishTxCard(tid, false, "send");
      addActivity(`Transfer error: ${msg}`, "var(--red)");
      toast("Send error: " + msg, "error");
    },

    onChat(fromId, fromName, msg) {
      appendMsg("peer", fromName, msg.text, msg.ts);
    },

    onClipboard(fromId, fromName, msg) {
      appendMsg("peer", fromName, "", msg.ts, true, msg.content);
      addActivity(`<strong>${fromName}</strong> shared clipboard`, "var(--green)");
    },

    onError(id, msg) {
      addActivity(`Error: ${msg}`, "var(--red)");
    },
  });

  mesh.startListening();
  renderUsers();
  initDropZone();
  initMobileToggles();
  await loadHistory();

  console.log(`[DropBeam] Room: ${roomId} | Me: ${myName} (${myId}) | Role: ${myRole}`);
}

document.addEventListener("DOMContentLoaded", init);

// ============================================================
//   MOBILE SIDEBAR / CHAT TOGGLES
// ============================================================
function initMobileToggles() {
  const leftRail  = document.querySelector(".left-rail");
  const chatRail  = document.querySelector(".chat-rail");
  const overlay   = $("mobileOverlay");

  function closeAll() {
    leftRail?.classList.remove("mobile-open");
    chatRail?.classList.remove("mobile-open");
    if (overlay) overlay.classList.add("hidden");
  }

  $("mobilePeersBtn")?.addEventListener("click", () => {
    const isOpen = leftRail?.classList.contains("mobile-open");
    closeAll();
    if (!isOpen) {
      leftRail?.classList.add("mobile-open");
      overlay?.classList.remove("hidden");
    }
  });

  $("mobileChatBtn")?.addEventListener("click", () => {
    const isOpen = chatRail?.classList.contains("mobile-open");
    closeAll();
    if (!isOpen) {
      chatRail?.classList.add("mobile-open");
      overlay?.classList.remove("hidden");
      // Clear unread
      const badge = $("mobileUnread");
      if (badge) { badge.textContent = "0"; badge.hidden = true; }
    }
  });

  overlay?.addEventListener("click", closeAll);
}

// ---- Close panel buttons ----
document.addEventListener("DOMContentLoaded", () => {
  const leftRail = document.querySelector(".left-rail");
  const chatRail = document.querySelector(".chat-rail");
  const overlay  = document.getElementById("mobileOverlay");
  function closeAll() {
    leftRail?.classList.remove("mobile-open");
    chatRail?.classList.remove("mobile-open");
    overlay?.classList.add("hidden");
  }
  document.getElementById("closePeersPanel")?.addEventListener("click", closeAll);
  document.getElementById("closeChatPanel")?.addEventListener("click", closeAll);

  // Mobile tab button → switch to transfer tab
  document.getElementById("mobileTransferBtn")?.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach(p => p.classList.add("hidden"));
    document.querySelector('.tab[data-tab="transfer"]')?.classList.add("active");
    document.getElementById("pane-transfer")?.classList.remove("hidden");
    closeAll();
  });
});
