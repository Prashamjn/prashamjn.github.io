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
  getHistory, clearHistory,
  saveRecentRoom,
} from "./storage.js";

// ============================================================
//   STATE
// ============================================================
let roomId     = null;
let myId       = null;
let myName     = null;
let myRole     = null;
let mesh       = null;

const peers    = new Map();   // peerId → { name, online }
const blobs    = new Map();   // transferId → { blob, meta }
let   pending  = null;        // incoming file waiting for accept/reject
let   msgCount = 0;
let   actHas   = false;
let   histFilter = "all";
let   qrDone   = false;

const EMOJI_LIST = [
  "😀","😂","😎","🔥","💡","✅","⚡","🎯","🚀","👍",
  "❤️","🤔","😮","👋","🎉","💯","🤝","⭐","📁","🔐",
  "💻","🌊","🎨","📦","⚙️","🐍","☕","🌐","🎵","🏆"
];

// ============================================================
//   UTILS
// ============================================================
const $ = id => document.getElementById(id);

function toast(msg, type = "info", dur = 3000) {
  const stack = $("toastStack");
  if (!stack) return;
  const cols  = { info:"var(--text2)", success:"var(--green)", error:"var(--red)", warn:"var(--amber)" };
  const icons = { info:"ℹ", success:"✓", error:"✗", warn:"⚠" };
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `
    <span class="t-ico" style="color:${cols[type] || cols.info}">${icons[type] || "·"}</span>
    <span class="t-msg">${msg}</span>
    <button class="t-close">✕</button>`;
  stack.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  const close = () => { t.classList.remove("show"); setTimeout(() => t.remove(), 350); };
  t.querySelector(".t-close").addEventListener("click", close);
  setTimeout(close, dur);
}

function timeStr(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function linkify(s) {
  return s.replace(/(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--green)">$1</a>');
}

// ============================================================
//   THEME
// ============================================================
async function initTheme() {
  const saved = await getSetting("theme", "dark");
  document.documentElement.setAttribute("data-theme", saved);
  const icon = $("themeIcon");
  if (icon) icon.textContent = saved === "dark" ? "◐" : "◑";
  $("themeToggle")?.addEventListener("click", async () => {
    const c = document.documentElement.getAttribute("data-theme");
    const n = c === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", n);
    await setSetting("theme", n);
    const ic = $("themeIcon");
    if (ic) ic.textContent = n === "dark" ? "◐" : "◑";
  });
}

// ============================================================
//   CONNECTION STATUS
// ============================================================
function setConn(state, label) {
  const els = [
    { dot: $("ciDot"),         txt: $("ciText")         },
    { dot: $("mobileConnDot"), txt: $("mobileConnText") },
  ];
  els.forEach(({ dot, txt }) => {
    if (dot) dot.className    = "ci-dot " + state;
    if (txt) txt.textContent  = label.toUpperCase();
  });
}

// ============================================================
//   USERS LIST
// ============================================================
function renderUsers() {
  const list      = $("usersList");
  const badge     = $("peerBadge");
  const cnt       = $("peerCountVal");
  const roleEl    = $("myRoleVal");
  const mobileCnt = $("mobilePeerCount");
  if (!list) return;

  const connPeers = mesh?.connectedPeers() || [];

  let html = `
    <div class="user-item">
      <div class="u-avatar me-av">${(myName || "?").charAt(0).toUpperCase()}</div>
      <div class="u-info">
        <div class="u-name">${escHtml(myName || "You")}
          <span style="opacity:.4;font-size:.62rem">(you)</span>
        </div>
        <div class="u-role">${myRole === "host" ? "HOST" : "GUEST"}</div>
      </div>
      <span class="u-dot on"></span>
    </div>`;

  connPeers.forEach(p => {
    html += `
    <div class="user-item">
      <div class="u-avatar peer-av">${(p.name || "?").charAt(0).toUpperCase()}</div>
      <div class="u-info">
        <div class="u-name">${escHtml(p.name || "Peer")}</div>
        <div class="u-role">PEER</div>
      </div>
      <span class="u-dot on"></span>
    </div>`;
  });

  if (!connPeers.length) {
    html += `<div style="padding:8px 10px;font-size:.68rem;color:var(--text3)">// no peers yet</div>`;
  }

  list.innerHTML = html;
  const total = connPeers.length + 1;
  if (badge)     badge.textContent     = total.toString().padStart(2, "0");
  if (cnt)       cnt.textContent       = connPeers.length;
  if (roleEl)    roleEl.textContent    = myRole === "host" ? "HOST" : "GUEST";
  if (mobileCnt) mobileCnt.textContent = total;
  renderPeerTarget();
}

// ============================================================
//   PEER TARGET SELECTOR
// ============================================================
const selPeers = new Set();

function renderPeerTarget() {
  const connPeers = mesh?.connectedPeers() || [];
  const wrap  = $("peerTarget");
  const list  = $("peerTargetList");
  if (!wrap || !list) return;
  if (!connPeers.length) { wrap.classList.add("hidden"); return; }
  wrap.classList.remove("hidden");

  list.innerHTML =
    `<div class="pt-chip sel" data-id="all">EVERYONE</div>` +
    connPeers.map(p =>
      `<div class="pt-chip" data-id="${p.id}">${escHtml(p.name.toUpperCase())}</div>`
    ).join("");

  list.querySelectorAll(".pt-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      if (chip.dataset.id === "all") {
        selPeers.clear();
        list.querySelectorAll(".pt-chip").forEach(c => c.classList.remove("sel"));
        chip.classList.add("sel");
      } else {
        list.querySelector("[data-id='all']")?.classList.remove("sel");
        chip.classList.toggle("sel");
        if (chip.classList.contains("sel")) selPeers.add(chip.dataset.id);
        else selPeers.delete(chip.dataset.id);
        if (!selPeers.size) list.querySelector("[data-id='all']")?.classList.add("sel");
      }
    });
  });
}

// ============================================================
//   WAITING / CONNECTED STATE
// ============================================================
function showConnected(yes) {
  $("waitState")?.classList.toggle("hidden", yes);
  $("connState")?.classList.toggle("hidden", !yes);
}

function roomLink() {
  const base = location.pathname.replace("room2.html", "dropbeam.html");
  return `${location.origin}${base}?room=${roomId}`;
}

function updateWaitCode(code) {
  const el = $("waitRoomCode");
  if (el) el.textContent = code;
}

// ============================================================
//   ACTIVITY FEED
// ============================================================
function addActivity(text, col = "var(--green)") {
  const feed = $("actFeed");
  if (!feed) return;
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
const txCards = new Map();

function makeTxCard(tid, dir, fileName, fileSize, peerName) {
  const icon  = fileEmoji(fileName);
  const badge = dir === "send" ? "SENDING" : "RECEIVING";
  const bCls  = dir === "send" ? "b-sending" : "b-receiving";
  const fCls  = dir === "send" ? "tx-fill-s" : "tx-fill-r";
  const arrow = dir === "send" ? "→" : "←";

  const el = document.createElement("div");
  el.id = `tx-${tid}`;
  el.className = "tx-item active";
  el.innerHTML = `
    <div class="tx-head">
      <span class="tx-icon">${icon}</span>
      <div class="tx-meta">
        <div class="tx-name" title="${escHtml(fileName)}">${escHtml(fileName)}</div>
        <div class="tx-sub">${fmtBytes(fileSize)} · ${arrow} ${escHtml(peerName)}</div>
      </div>
      <div class="tx-badges">
        <span class="tx-badge ${bCls}" id="badge-${tid}">${badge}</span>
      </div>
    </div>
    <div class="tx-bar-wrap">
      <div class="tx-track">
        <div class="tx-fill ${fCls}" id="fill-${tid}" style="width:0%"></div>
      </div>
      <div class="tx-stats">
        <span id="pct-${tid}">0%</span>
        <span id="spd-${tid}"></span>
      </div>
    </div>`;

  const container = $("activeTransfers");
  if (container) container.prepend(el);

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
  if (c.fill)  c.fill.style.width = pct + "%";
  if (c.pct)   c.pct.textContent  = pct + "%";
  if (c.spd)   c.spd.textContent  = fmtSpeed(speed);
}

function finishTxCard(tid, ok = true, direction = "send") {
  const c = txCards.get(tid);
  if (!c) return;
  if (c.fill)  { c.fill.style.width = "100%"; c.fill.className = "tx-fill tx-fill-d"; }
  if (c.pct)   c.pct.textContent   = "100%";
  if (c.spd)   c.spd.textContent   = "";
  if (c.badge) {
    c.badge.textContent = ok ? "DONE ✓" : "FAILED";
    c.badge.className   = "tx-badge " + (ok ? "b-done" : "b-error");
  }
  c.el.classList.remove("active");

  if (direction === "send") {
    // Sent cards fade after 6s
    setTimeout(() => {
      c.el.style.cssText += ";opacity:0;transform:translateX(8px);transition:all .4s";
      setTimeout(() => { c.el.remove(); txCards.delete(tid); }, 400);
    }, 6000);
  }
  // Receive cards stay until user dismisses
}

// ============================================================
//   DROP ZONE  (supports multiple files)
// ============================================================
function initDropZone() {
  const zone    = $("dropZone");
  const overlay = $("dzOverlay");
  const input   = $("fileInput");
  const inner   = $("dzInner");
  const browse  = $("browseTrigger");

  // Allow multiple file selection
  if (input) input.setAttribute("multiple", "");

  browse?.addEventListener("click", e => { e.stopPropagation(); input?.click(); });
  inner?.addEventListener("click",  () => input?.click());

  input?.addEventListener("change", e => {
    const files = [...(e.target.files || [])];
    files.forEach(f => sendFile(f));
    input.value = "";
  });

  zone?.addEventListener("dragover",  e => { e.preventDefault(); overlay?.classList.add("active"); });
  zone?.addEventListener("dragleave", e => {
    if (!zone.contains(e.relatedTarget)) overlay?.classList.remove("active");
  });
  zone?.addEventListener("drop", e => {
    e.preventDefault();
    overlay?.classList.remove("active");
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    files.forEach(f => sendFile(f));
    // Show count toast if multiple
    if (files.length > 1) toast(`${files.length} files queued to send`, "info");
  });
}

async function sendFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    toast(`${file.name} exceeds 500 MB limit`, "error");
    return;
  }
  const connPeers = mesh?.connectedPeers() || [];
  if (!connPeers.length) { toast("No peers connected", "warn"); return; }

  const targets = selPeers.size > 0 ? [...selPeers] : connPeers.map(p => p.id);

  for (const pid of targets) {
    const pname = connPeers.find(p => p.id === pid)?.name || "peer";
    const tid   = await mesh.offerFile(file, pid);
    makeTxCard(tid, "send", file.name, file.size, pname);
    addActivity(`Offering <strong>${escHtml(file.name)}</strong> → ${escHtml(pname)}`, "var(--green)");
  }
  navigator.vibrate?.(40);
}

// ============================================================
//   INCOMING FILE MODAL
// ============================================================
function showIncoming(fromId, fromName, meta) {
  pending = { fromId, meta };
  const icon = $("incomingIcon");
  const from = $("incomingFrom");
  const name = $("incomingName");
  const size = $("incomingSize");
  const type = $("incomingType");
  if (icon) icon.textContent = fileEmoji(meta.fileName, meta.mimeType);
  if (from) from.textContent = fromName;
  if (name) name.textContent = meta.fileName;
  if (size) size.textContent = fmtBytes(meta.fileSize);
  if (type) type.textContent = meta.mimeType || "unknown";
  $("incomingModal")?.classList.remove("hidden");
  navigator.vibrate?.([80, 40, 80]);
}

// ============================================================
//   DOWNLOAD  — cross-device safe (iOS + Android + Desktop)
// ============================================================
function dlBlob(blob, name) {
  // Method 1: Standard anchor download (works on desktop + Android Chrome)
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a short delay to allow download to start
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// iOS Safari doesn't support a.download — show file in new tab instead
function dlBlobSafe(blob, name) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  if (isIOS || isSafari) {
    // iOS/Safari: open blob in new tab — user taps Share → Save to Files
    const url = URL.createObjectURL(blob);
    const w   = window.open(url, "_blank");
    if (!w) {
      // Popup blocked — fallback to same-tab navigation
      location.href = url;
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast("Tap Share → Save to Files to save", "info", 5000);
  } else {
    dlBlob(blob, name);
  }
}

// ============================================================
//   FILE PREVIEW
// ============================================================
function showPreview(blob, fileName, mimeType) {
  const type = previewType(fileName, mimeType);
  const body = $("previewBody");
  const title = $("previewFilename");
  if (!body) return;
  if (title) title.textContent = fileName;
  body.innerHTML = "";

  if (type === "image") {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(blob);
    img.style.maxWidth = "100%";
    body.appendChild(img);
  } else if (type === "video") {
    const vid = document.createElement("video");
    vid.src      = URL.createObjectURL(blob);
    vid.controls = true;
    vid.style.maxWidth = "100%";
    body.appendChild(vid);
  } else {
    body.innerHTML = `<div class="preview-pdf-stub">
      // PREVIEW_UNAVAILABLE<br/>
      <small>Use DOWNLOAD to open this file type.</small>
    </div>`;
  }

  $("previewModal")?.classList.remove("hidden");
  const dlBtn = $("previewDlBtn");
  if (dlBtn) dlBtn.onclick = () => dlBlobSafe(blob, fileName);
}

// ============================================================
//   HISTORY
// ============================================================
async function loadHistory(filter = "all") {
  histFilter = filter;
  document.querySelectorAll(".filt").forEach(b =>
    b.classList.toggle("active", b.dataset.f === filter)
  );
  const items = await getHistory(filter);
  const list  = $("histList");
  if (!list) return;

  if (!items.length) {
    list.innerHTML = `<div class="empty-msg">// NO_HISTORY_FOUND</div>`;
    return;
  }

  list.innerHTML = items.map(h => {
    const icon  = fileEmoji(h.fileName, h.mimeType);
    const hasDl = h.blob && h.direction === "received";
    const hasPv = h.blob && previewType(h.fileName, h.mimeType);
    return `
    <div class="hist-item">
      <span class="hi-icon">${icon}</span>
      <div class="hi-meta">
        <div class="hi-name" title="${escHtml(h.fileName)}">${escHtml(h.fileName)}</div>
        <div class="hi-detail">${fmtBytes(h.fileSize)} · ${escHtml(h.peerName || "—")} · ${timeAgo(h.timestamp)}</div>
      </div>
      <div class="hi-right">
        <span class="${h.direction === "sent" ? "hi-dir-s" : "hi-dir-r"}">
          ${h.direction === "sent" ? "↑ SENT" : "↓ RECV"}
        </span>
        <span class="hi-sz">${fmtBytes(h.fileSize)}</span>
        ${hasDl ? `<button class="dl-btn" data-id="${h.id}" data-act="dl">DOWNLOAD</button>` : ""}
        ${hasPv ? `<button class="dl-btn" data-id="${h.id}" data-act="pv">PREVIEW</button>` : ""}
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const all  = await getHistory("all");
      const item = all.find(h => h.id === btn.dataset.id);
      if (!item?.blob) return;
      const b = item.blob instanceof Blob
        ? item.blob
        : new Blob([item.blob], { type: item.mimeType });
      if (btn.dataset.act === "dl") dlBlobSafe(b, item.fileName);
      else showPreview(b, item.fileName, item.mimeType);
    });
  });
}

// ============================================================
//   CHAT
// ============================================================
function appendMsg(who, sender, text, ts = Date.now(), isClip = false, clipContent = null) {
  const feed  = $("chatMessages");
  if (!feed) return;
  const empty = feed.querySelector(".chat-empty");
  if (empty) empty.remove();

  msgCount++;
  const badge = $("msgCountBadge");
  if (badge) badge.textContent = msgCount;

  const el  = document.createElement("div");
  const cls = who === "me" ? "msg-me" : who === "sys" ? "msg-sys" : "msg-peer";
  el.className = "msg-row " + cls;

  if (isClip && clipContent) {
    el.innerHTML = `
      <div class="msg-bubble">
        <div class="clip-msg">
          <div class="clip-msg-label">// SHARED_CLIPBOARD</div>
          <div>${escHtml(clipContent.substring(0, 400))}${clipContent.length > 400 ? "…" : ""}</div>
        </div>
      </div>
      <div class="msg-meta">
        <span class="msg-sender">${who === "me" ? "YOU" : escHtml(sender)}</span>
        <span>${timeStr(ts)}</span>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="msg-bubble">${linkify(escHtml(text))}</div>
      ${who !== "sys" ? `
        <div class="msg-meta">
          <span class="msg-sender">${who === "me" ? "YOU" : escHtml(sender)}</span>
          <span>${timeStr(ts)}</span>
        </div>` : ""}`;
  }

  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;

  // Mobile unread badge
  if (who !== "me" && who !== "sys") {
    const chatRail = document.querySelector(".chat-rail");
    if (!chatRail?.classList.contains("mobile-open")) {
      const ub = $("mobileUnread");
      if (ub) {
        ub.textContent = (parseInt(ub.textContent || "0", 10) + 1).toString();
        ub.hidden = false;
      }
    }
  }
}

async function sendChat() {
  const input = $("chatInput");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  mesh?.sendChat(text);
  appendMsg("me", myName, text);

  try {
    await pushChatMessage(roomId, {
      senderId: myId, senderName: myName, text, timestamp: Date.now()
    });
  } catch (_) {}
}

// ============================================================
//   QR CODE
// ============================================================
function initQR() {
  $("showQrBtn")?.addEventListener("click", () => {
    const box = $("qrBox");
    if (!box) return;
    box.classList.toggle("hidden");
    if (!box.classList.contains("hidden") && !qrDone) {
      const link = roomLink();
      const qrEl = $("roomQrCode");
      if (!qrEl) return;
      qrEl.innerHTML = "";
      try {
        new QRCode(qrEl, {
          text:  link,
          width: 130, height: 130,
          colorDark:    document.documentElement.getAttribute("data-theme") === "dark"
                          ? "#080c08" : "#0d1f0d",
          colorLight:   "#ffffff",
          correctLevel: QRCode.CorrectLevel.H,
        });
        qrDone = true;
      } catch (e) {
        qrEl.innerHTML = `<p style="font-size:.7rem;color:var(--text2);padding:8px">
          QR library not loaded.<br/>Copy the link instead.
        </p>`;
      }
    }
  });
}

// ============================================================
//   MOBILE TOGGLES
// ============================================================
function initMobileToggles() {
  const leftRail = document.querySelector(".left-rail");
  const chatRail = document.querySelector(".chat-rail");
  const overlay  = $("mobileOverlay");

  function closeAll() {
    leftRail?.classList.remove("mobile-open");
    chatRail?.classList.remove("mobile-open");
    overlay?.classList.add("hidden");
  }

  $("mobilePeersBtn")?.addEventListener("click", () => {
    const open = leftRail?.classList.contains("mobile-open");
    closeAll();
    if (!open) { leftRail?.classList.add("mobile-open"); overlay?.classList.remove("hidden"); }
  });

  $("mobileChatBtn")?.addEventListener("click", () => {
    const open = chatRail?.classList.contains("mobile-open");
    closeAll();
    if (!open) {
      chatRail?.classList.add("mobile-open");
      overlay?.classList.remove("hidden");
      const ub = $("mobileUnread");
      if (ub) { ub.textContent = "0"; ub.hidden = true; }
    }
  });

  $("mobileTransferBtn")?.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach(p => p.classList.add("hidden"));
    document.querySelector('.tab[data-tab="transfer"]')?.classList.add("active");
    $("pane-transfer")?.classList.remove("hidden");
    closeAll();
  });

  $("closePeersPanel")?.addEventListener("click", closeAll);
  $("closeChatPanel")?.addEventListener("click",  closeAll);
  overlay?.addEventListener("click", closeAll);
}

// ============================================================
//   TABS
// ============================================================
function initTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.add("hidden"));
      btn.classList.add("active");
      $(`pane-${btn.dataset.tab}`)?.classList.remove("hidden");
      if (btn.dataset.tab === "history") loadHistory(histFilter);
    });
  });

  document.querySelectorAll(".filt").forEach(b => {
    b.addEventListener("click", () => loadHistory(b.dataset.f));
  });
}

// ============================================================
//   ALL EVENT LISTENERS  (inside DOMContentLoaded)
// ============================================================
document.addEventListener("DOMContentLoaded", () => {

  // Accept / Reject incoming file
  $("acceptBtn")?.addEventListener("click", () => {
    if (!pending) return;
    const { fromId, meta } = pending;
    mesh?.acceptFile(meta.transferId, fromId);
    $("incomingModal")?.classList.add("hidden");
    makeTxCard(
      meta.transferId, "recv",
      meta.fileName, meta.fileSize,
      peers.get(fromId)?.name || fromId.slice(0, 6)
    );
    addActivity(`Accepting <strong>${escHtml(meta.fileName)}</strong>`, "var(--blue)");
    pending = null;
  });

  $("rejectBtn")?.addEventListener("click", () => {
    if (!pending) return;
    mesh?.rejectFile(pending.meta.transferId, pending.fromId);
    $("incomingModal")?.classList.add("hidden");
    addActivity("File declined", "var(--red)");
    pending = null;
  });

  // Preview modal close
  $("closePreviewBtn")?.addEventListener("click", () =>
    $("previewModal")?.classList.add("hidden")
  );

  // Copy buttons
  $("copyLinkBtn")?.addEventListener("click", () => {
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

  // Wait state copy buttons
  $("waitCopyCode")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(roomId);
    toast("Room code copied", "success");
  });

  $("waitCopyLink")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(roomLink());
    toast("Link copied", "success");
  });

  // Chat
  $("chatSendBtn")?.addEventListener("click", sendChat);
  $("chatInput")?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  // Emoji picker
  $("emojiToggle")?.addEventListener("click", () => {
    const p = $("emojiPicker");
    if (!p) return;
    p.classList.toggle("hidden");
    if (!p.classList.contains("hidden") && !p.querySelector(".emoji-grid")) {
      const grid = document.createElement("div");
      grid.className = "emoji-grid";
      grid.innerHTML = EMOJI_LIST.map(e => `<button>${e}</button>`).join("");
      p.appendChild(grid);
      grid.querySelectorAll("button").forEach(b => {
        b.addEventListener("click", () => {
          const inp = $("chatInput");
          if (inp) { inp.value += b.textContent; inp.focus(); }
          p.classList.add("hidden");
        });
      });
    }
  });

  // Clipboard broadcast
  $("sendClipBtn")?.addEventListener("click", () => {
    const text = $("clipArea")?.value.trim();
    if (!text) { toast("Nothing to share", "warn"); return; }
    mesh?.sendClipboard(text, "text");
    appendMsg("me", myName, "", Date.now(), true, text);
    if ($("clipArea")) $("clipArea").value = "";
    addActivity("Shared clipboard content", "var(--green)");
    toast("Clipboard broadcast!", "success");
  });

  // History clear
  $("clearHistBtn")?.addEventListener("click", async () => {
    await clearHistory();
    loadHistory(histFilter);
  });

  // Leave room
  $("leaveBtn")?.addEventListener("click", async () => {
    if (mesh) await mesh.destroy();
    if (myRole === "host") { try { await closeRoom(roomId); } catch (_) {} }
    window.location.href = "dropbeam.html";
  });

  // Init subsystems that need DOM
  initQR();
  initMobileToggles();
  initTabs();
  initDropZone();
});

window.addEventListener("beforeunload", () => mesh?.destroy());

// ============================================================
//   MAIN INIT
// ============================================================
async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("../service-worker.js").catch(() => {});
  }

  const params = new URLSearchParams(window.location.search);
  roomId = params.get("room") || sessionStorage.getItem("db_room");
  myRole = params.get("role") || sessionStorage.getItem("db_role") || "guest";

  if (!roomId) { window.location.href = "dropbeam.html"; return; }

  myId   = crypto.randomUUID();
  const ADJS  = ["Fast","Bold","Dark","Cool","Sharp","Deep","Swift","Raw","Keen","Iron"];
  const NOUNS = ["Node","Beam","Link","Wave","Echo","Byte","Grid","Flux","Core","Pulse"];
  myName = `${ADJS[Math.floor(Math.random() * ADJS.length)]}${NOUNS[Math.floor(Math.random() * NOUNS.length)]}`;

  // Populate static UI
  const hRid = $("headerRoomId");
  const wRid = $("waitRoomCode");
  const exp  = $("expiryVal");
  if (hRid) hRid.textContent = roomId;
  if (wRid) wRid.textContent = roomId;
  if (exp)  exp.textContent  = "SESSION";

  await initTheme();
  updateWaitCode(roomId);
  setConn("connecting", "Connecting");
  addActivity(`Joined room <strong>${roomId}</strong> as ${myRole}`, "var(--green)");

  await saveRecentRoom(roomId);

  // Register in Firestore
  try {
    await addPeerToRoom(roomId, myId, myName);
  } catch (e) {
    console.error("Firebase:", e);
    // Check if it's an ad-blocker issue
    if (e.message?.includes("BLOCKED") || e.name === "TypeError") {
      toast("Firebase blocked — disable ad blocker for this page", "warn", 8000);
    } else {
      toast("Firebase error — check config in firebase2.js", "error", 8000);
    }
  }

  // Listen for peers joining — only smaller ID initiates offer
  listenRoom(roomId, async data => {
    const roomPeers = data.peers || [];
    for (const p of roomPeers) {
      if (p.id === myId) continue;
      if (mesh?.links.has(p.id)) continue;
      if (myId < p.id) {
        mesh?.connectTo(p.id, p.name).catch(console.error);
      }
    }
  });

  // Build MeshRoom
  mesh = new MeshRoom(roomId, myId, myName, myRole === "host", {

    onPeerJoined(id, name) {
      peers.set(id, { name, online: true });
      renderUsers();
      showConnected(true);
      setConn("connected", "Connected");
      appendMsg("sys", "", `${name} connected`);
      addActivity(`<strong>${escHtml(name)}</strong> established P2P link`, "var(--green)");
      toast(`${name} joined`, "success");
      const eb = $("encBadge");
      if (eb) eb.classList.add("active");
      loadHistory();
    },

    onPeerLeft(id, name) {
      peers.delete(id);
      renderUsers();
      if (!mesh?.connectedPeerIds().length) {
        showConnected(false);
        setConn("connecting", "Waiting");
      }
      appendMsg("sys", "", `${name || "peer"} disconnected`);
      addActivity(`<strong>${escHtml(name || "peer")}</strong> left`, "var(--red)");
    },

    onEncReady(id) {
      const pname = peers.get(id)?.name || "peer";
      addActivity(`🔐 E2E encryption ready with <strong>${escHtml(pname)}</strong>`, "var(--green)");
      const eb = $("encBadge");
      if (eb) eb.textContent = "🔐 ENC:ON";
    },

    onFileIncoming(fromId, fromName, meta) {
      showIncoming(fromId, fromName, meta);
      addActivity(`Incoming <strong>${escHtml(meta.fileName)}</strong> from ${escHtml(fromName)}`, "var(--blue)");
    },

    onFileProgress(tid, pct, speed) {
      updateTxCard(tid, pct, speed);
    },

    onFileComplete(tid, blob, meta, fromId) {
      finishTxCard(tid, true, "recv");
      blobs.set(tid, { blob, meta });
      const fn   = meta.fileName;
      const from = peers.get(fromId)?.name || fromId.slice(0, 6);

      // Create a blob URL for the download link
      const objUrl = URL.createObjectURL(blob);
      const pv     = previewType(fn, meta.mimeType);

      setTimeout(() => {
        const card = $(`tx-${tid}`);
        if (!card) return;
        const acts = document.createElement("div");
        acts.className = "tx-actions";
        acts.innerHTML = `
          <a class="dl-now-btn" href="${objUrl}" download="${escHtml(fn)}" id="dl-${tid}">
            ↓ DOWNLOAD NOW
          </a>
          ${pv ? `<button class="sm-btn" id="pv-${tid}">👁 PREVIEW</button>` : ""}
          <button class="sm-btn sm-btn-dismiss" id="dis-${tid}">DISMISS ✕</button>`;
        card.appendChild(acts);

        // Wire buttons
        document.getElementById(`pv-${tid}`)?.addEventListener("click", () =>
          showPreview(blob, fn, meta.mimeType)
        );
        document.getElementById(`dis-${tid}`)?.addEventListener("click", () => {
          URL.revokeObjectURL(objUrl);
          const tc = txCards.get(tid);
          if (tc) {
            tc.el.style.cssText += ";opacity:0;transform:translateX(8px);transition:all .3s";
            setTimeout(() => { tc.el.remove(); txCards.delete(tid); }, 300);
          }
        });

        // Try auto-click after element is in DOM
        setTimeout(() => {
          const dlLink = document.getElementById(`dl-${tid}`);
          if (dlLink) {
            // Use dlBlobSafe for iOS
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            if (isIOS) {
              dlBlobSafe(blob, fn);
            } else {
              dlLink.click();
            }
          }
        }, 300);
      }, 100);

      addActivity(`<strong>${escHtml(fn)}</strong> received from ${escHtml(from)}`, "var(--green)");
      toast(`${fn} ready — tap DOWNLOAD NOW`, "success", 5000);
      loadHistory();
      navigator.vibrate?.([100, 50, 100]);
    },

    onFileSendProgress(tid, pct, speed) {
      updateTxCard(tid, pct, speed);
    },

    onFileSendComplete(tid) {
      finishTxCard(tid, true, "send");
      addActivity("File sent successfully", "var(--green)");
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
      addActivity(`<strong>${escHtml(fromName)}</strong> shared clipboard`, "var(--green)");
    },

    onError(id, msg) {
      addActivity(`Error: ${escHtml(msg)}`, "var(--red)");
    },
  });

  mesh.startListening();
  renderUsers();

  console.log(`[DropBeam] Room: ${roomId} | Me: ${myName} (${myId}) | Role: ${myRole}`);
}

document.addEventListener("DOMContentLoaded", init);
