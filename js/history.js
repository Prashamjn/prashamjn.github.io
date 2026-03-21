// ============================================================
// history.js — Phase 3: Auction History & Replay System
// ============================================================

const HistoryState = {
  events:        [],    // all history events
  unsubscribe:   null,
  replayIndex:   0,
  replayPlaying: false,
  replayTimer:   null
};

// Event types
const EVT = {
  BID:    "bid",
  SOLD:   "sold",
  UNSOLD: "unsold",
  START:  "start",
  PAUSE:  "pause",
  RESUME: "resume",
  END:    "end"
};

// ─────────────────────────────────────────────
// Log Events to Firestore
// ─────────────────────────────────────────────

async function logEvent(type, payload) {
  if (!AppState.roomId) return;
  try {
    await logBidEvent(AppState.roomId, { type, ...payload, loggedBy: AppState.userId });
  } catch (e) {}
}

// Called from auction.js after each bid
async function logBid(auction, bidderId, bidderName, amount) {
  await logEvent(EVT.BID, {
    playerId:     auction.playerId,
    playerName:   auction.playerName,
    bidderId,
    bidderName,
    amount,
    prevBid:      auction.currentBid
  });
}

async function logSold(auction) {
  await logEvent(EVT.SOLD, {
    playerId:    auction.playerId,
    playerName:  auction.playerName,
    boughtBy:    auction.highestBidderId,
    boughtByName: auction.highestBidderName,
    finalPrice:  auction.currentBid
  });
}

async function logUnsold(auction) {
  await logEvent(EVT.UNSOLD, {
    playerId:   auction.playerId,
    playerName: auction.playerName
  });
}

// ─────────────────────────────────────────────
// Subscribe to Live History
// ─────────────────────────────────────────────

function initHistoryListener(roomId) {
  if (HistoryState.unsubscribe) HistoryState.unsubscribe();
  HistoryState.unsubscribe = subscribeToHistory(roomId, (events) => {
    HistoryState.events = events;
    renderHistoryTimeline(events);
  });
}

// ─────────────────────────────────────────────
// Render History Timeline
// ─────────────────────────────────────────────

function renderHistoryTimeline(events) {
  const container = document.getElementById("historyTimeline");
  if (!container) return;

  if (events.length === 0) {
    container.innerHTML = `<div class="hist-empty">No events yet. Start bidding!</div>`;
    return;
  }

  // Group by player — show last 40 events
  const shown = events.slice(-40).reverse();
  container.innerHTML = shown.map(ev => {
    const time = ev.ts?.seconds
      ? new Date(ev.ts.seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "";

    if (ev.type === EVT.BID) {
      const isMe = ev.bidderId === AppState.userId;
      return `
        <div class="hist-event hist-bid ${isMe ? "hist-me" : ""}">
          <span class="hist-icon">⚡</span>
          <div class="hist-body">
            <span class="hist-actor">${escapeHtml(ev.bidderName)}</span>
            bid <strong>₹${ev.amount} Cr</strong> on
            <span class="hist-player">${escapeHtml(ev.playerName)}</span>
          </div>
          <span class="hist-time">${time}</span>
        </div>`;
    }
    if (ev.type === EVT.SOLD) {
      return `
        <div class="hist-event hist-sold">
          <span class="hist-icon">🔨</span>
          <div class="hist-body">
            <span class="hist-player">${escapeHtml(ev.playerName)}</span>
            SOLD to <strong>${escapeHtml(ev.boughtByName)}</strong> @ ₹${ev.finalPrice} Cr
          </div>
          <span class="hist-time">${time}</span>
        </div>`;
    }
    if (ev.type === EVT.UNSOLD) {
      return `
        <div class="hist-event hist-unsold">
          <span class="hist-icon">❌</span>
          <div class="hist-body">
            <span class="hist-player">${escapeHtml(ev.playerName)}</span> went UNSOLD
          </div>
          <span class="hist-time">${time}</span>
        </div>`;
    }
    return ""; // skip system events in timeline
  }).join("");
}

// ─────────────────────────────────────────────
// REPLAY SYSTEM
// ─────────────────────────────────────────────

async function startReplay(roomId) {
  const events = await getAuctionHistory(roomId);
  if (events.length === 0) {
    showToast("No history to replay yet!", "info"); return;
  }
  HistoryState.events = events;
  HistoryState.replayIndex = 0;

  openReplayModal();
  renderReplayFrame(0);
}

function openReplayModal() {
  const modal = document.getElementById("replayModal");
  if (!modal) return;
  modal.style.display = "flex";
  requestAnimationFrame(() => modal.classList.add("am-visible"));
}

function closeReplayModal() {
  stopReplay();
  const modal = document.getElementById("replayModal");
  if (!modal) return;
  modal.classList.remove("am-visible");
  setTimeout(() => { modal.style.display = "none"; }, 350);
}

function renderReplayFrame(index) {
  const events   = HistoryState.events;
  const total    = events.length;
  const ev       = events[index];
  if (!ev) return;

  const container = document.getElementById("replayContent");
  if (!container) return;

  const time = ev.ts?.seconds
    ? new Date(ev.ts.seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  let icon = "📋", headline = "", sub = "", badgeClass = "";
  if (ev.type === EVT.BID) {
    icon = "⚡"; badgeClass = "replay-bid";
    headline = `<strong>${escapeHtml(ev.bidderName)}</strong> bids ₹${ev.amount} Cr`;
    sub = `on ${escapeHtml(ev.playerName)}`;
  } else if (ev.type === EVT.SOLD) {
    icon = "🔨"; badgeClass = "replay-sold";
    headline = `${escapeHtml(ev.playerName)} SOLD!`;
    sub = `₹${ev.finalPrice} Cr → ${escapeHtml(ev.boughtByName)}`;
  } else if (ev.type === EVT.UNSOLD) {
    icon = "❌"; badgeClass = "replay-unsold";
    headline = `${escapeHtml(ev.playerName)} — UNSOLD`;
    sub = "No bids placed";
  }

  container.innerHTML = `
    <div class="replay-frame ${badgeClass}">
      <div class="rf-step">${index + 1} / ${total}</div>
      <div class="rf-icon">${icon}</div>
      <div class="rf-headline">${headline}</div>
      <div class="rf-sub">${sub}</div>
      <div class="rf-time">${time}</div>
    </div>
  `;

  // Update progress bar
  const bar = document.getElementById("replayProgress");
  if (bar) bar.style.width = `${((index + 1) / total) * 100}%`;

  // Update buttons
  document.getElementById("replayPrevBtn").disabled = index === 0;
  document.getElementById("replayNextBtn").disabled = index >= total - 1;
}

function replayPrev() {
  if (HistoryState.replayIndex > 0) {
    HistoryState.replayIndex--;
    renderReplayFrame(HistoryState.replayIndex);
  }
}

function replayNext() {
  if (HistoryState.replayIndex < HistoryState.events.length - 1) {
    HistoryState.replayIndex++;
    renderReplayFrame(HistoryState.replayIndex);
  }
}

function toggleAutoReplay() {
  if (HistoryState.replayPlaying) {
    stopReplay();
  } else {
    HistoryState.replayPlaying = true;
    document.getElementById("replayPlayBtn").textContent = "⏸️ Pause";
    HistoryState.replayTimer = setInterval(() => {
      if (HistoryState.replayIndex >= HistoryState.events.length - 1) {
        stopReplay(); return;
      }
      HistoryState.replayIndex++;
      renderReplayFrame(HistoryState.replayIndex);
    }, 1200);
  }
}

function stopReplay() {
  HistoryState.replayPlaying = false;
  clearInterval(HistoryState.replayTimer);
  const btn = document.getElementById("replayPlayBtn");
  if (btn) btn.textContent = "▶️ Play";
}
