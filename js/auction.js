// ============================================================
// auction.js — Phase 4: Fixed timer + consecutive-bid block
// ============================================================

let _lastSoldPlayerId   = null;
let _lastUnsoldPlayerId = null;
let _lastTimerKey       = null;
let _soldHandling       = false;

// ─── Host Controls ───────────────────────────────────────────

async function startAuction(roomData) {
  const { roomId } = AppState;
  const queue = roomData.playerQueue || [];
  if (queue.length === 0) { showToast("No players in queue!", "error"); return; }
  setButtonLoading("startAuctionBtn", true);
  const firstPlayer = AppState.players.find(p => p.id === queue[0]);
  if (!firstPlayer) return;
  await updateRoom(roomId, {
    status:"auction", auctionState:"running",
    auction: buildAuctionSlot(firstPlayer)
  });
  await sendSystemChat(roomId, `🚀 Auction started! First up: ${firstPlayer.name}`);
  await logEvent(EVT.START, { firstPlayerId: firstPlayer.id, firstPlayerName: firstPlayer.name });
}

async function pauseAuction() {
  stopTimer();
  await updateRoom(AppState.roomId, { auctionState:"paused" });
  await sendSystemChat(AppState.roomId, "⏸️ Auction paused by host");
  await logEvent(EVT.PAUSE, {});
  showToast("Auction paused", "info");
}

async function resumeAuction() {
  _lastTimerKey = null;
  // Force a fresh timerResetAt on resume so all clients restart timer
  await updateRoom(AppState.roomId, {
    auctionState: "running",
    "auction.timerResetAt": firebase.firestore.FieldValue.serverTimestamp(),
    "auction.timerDuration": AUCTION_TIMER
  });
  await sendSystemChat(AppState.roomId, "▶️ Auction resumed");
  await logEvent(EVT.RESUME, {});
  showToast("Auction resumed", "success");
}

async function endAuction() {
  // Use a custom confirm via toast instead of browser confirm()
  // which can be blocked in certain iframe/popup contexts
  const confirmed = await showConfirmDialog(
    "End the auction?",
    "This will mark the auction as finished for all players.",
    "🏁 End Now",
    "Cancel"
  );
  if (!confirmed) return;

  stopTimer();

  const roomData = AppState.lastRoomSnapshot;
  if (!roomData) {
    showToast("Cannot end — room data not loaded", "error");
    return;
  }

  try {
    // Compute AI scores first (non-blocking — don't let failure block ending)
    try { await computeAndSaveTeamScores(roomData); } catch(e) { console.warn("Score compute failed:", e); }

    // Save to user history (non-blocking)
    try { await saveAuctionSummaryToProfile(roomData); } catch(e) { console.warn("Profile save failed:", e); }

    // Mark room finished
    await updateRoom(AppState.roomId, {
      status:       "finished",
      auctionState: "ended",
      auction:      null
    });

    await sendSystemChat(AppState.roomId, "🏁 Auction ended by host!");
    try { await logEvent(EVT.END, {}); } catch(e) {}
    playFinalSound();
    showToast("Auction ended successfully 🏁", "success");
  } catch(err) {
    console.error("End auction error:", err);
    showToast("Failed to end auction: " + (err.message || "Unknown error"), "error");
  }
}

async function skipCurrentPlayer(roomData) {
  if (_soldHandling) return;
  stopTimer();
  const auction = roomData?.auction;
  if (!auction || auction.status !== "live") return;
  await updateRoom(AppState.roomId, { "auction.status":"unsold" });
  setTimeout(() => advanceToNextPlayer(AppState.lastRoomSnapshot), 1800);
}

async function startReAuction(roomData) {
  const unsold = roomData.unsoldPlayers || [];
  if (unsold.length === 0) { showToast("No unsold players!", "info"); return; }
  const shuffled    = [...unsold].sort(() => Math.random() - 0.5);
  const firstPlayer = AppState.players.find(p => p.id === shuffled[0]);
  if (!firstPlayer) return;
  _lastTimerKey = null; _lastSoldPlayerId = null;
  await updateRoom(AppState.roomId, {
    status:"auction", auctionState:"running",
    playerQueue: shuffled, unsoldPlayers: [], reAuctionQueue: shuffled,
    auction: buildAuctionSlot(firstPlayer)
  });
  await sendSystemChat(AppState.roomId, `🔄 Re-auction: ${unsold.length} players`);
}

async function saveCheckpoint() {
  const data = AppState.lastRoomSnapshot;
  if (!data) return;
  await saveAuctionCheckpoint(AppState.roomId, data);
  showToast("✅ Auction state saved!", "success");
}

// ─── Build Auction Slot ──────────────────────────────────────

function buildAuctionSlot(player) {
  return {
    playerId:         player.id,
    playerName:       player.name,
    playerCountry:    player.country,
    playerRole:       player.role,
    playerBasePrice:  player.basePrice,
    playerIsOverseas: player.isOverseas,
    playerRating:     player.rating,
    playerCategory:   player.category,
    currentBid:       player.basePrice,
    highestBidderId:  null,
    highestBidderName: null,
    lastBidAt:        null,
    // ── KEY FIX: timerResetAt must always be a fresh server timestamp ──
    timerResetAt:     firebase.firestore.FieldValue.serverTimestamp(),
    timerDuration:    AUCTION_TIMER,
    bidCount:         0,
    startedAt:        firebase.firestore.FieldValue.serverTimestamp(),
    status:           "live"
  };
}

// ─── Handle Auction State ─────────────────────────────────────

function handleAuctionState(data) {
  const auction  = data.auction;
  if (!auction)  return;
  const isPaused = data.auctionState === "paused";

  renderCurrentPlayer(auction, data);
  renderBidControls(auction, data);

  const me = data.members?.[AppState.userId];
  if (me) renderSmartSuggestion(me, auction);

  // ── FIXED TIMER KEY ──
  // Include bidCount so the key changes on every bid, not just player change.
  // This guarantees the timer restarts whenever timerResetAt updates.
  const timerKey = `${auction.playerId}|${auction.timerResetAt?.seconds||0}|${auction.bidCount||0}|${isPaused}`;

  if (timerKey !== _lastTimerKey) {
    _lastTimerKey = timerKey;
    if (auction.status === "live") {
      startSyncedTimer(
        auction.timerResetAt,
        auction.timerDuration || AUCTION_TIMER,
        timerKey,
        isPaused,
        () => {
          // Only host triggers sold to avoid race conditions
          if (AppState.isHost && !_soldHandling) {
            markPlayerSoldOrUnsold(AppState.lastRoomSnapshot);
          }
        }
      );
    } else {
      stopTimer();
      updateTimerDisplay(0, AUCTION_TIMER);
    }
  }

  // Sold event
  if (auction.status === "sold" && auction.playerId !== _lastSoldPlayerId) {
    _lastSoldPlayerId = auction.playerId;
    showSoldAnimation(auction);
    playSoldSound();
    sendSystemChat(AppState.roomId,
      `🔨 ${auction.playerName} SOLD to ${auction.highestBidderName} for ₹${auction.currentBid} Cr!`);
    if (AppState.isHost) setTimeout(() => advanceToNextPlayer(AppState.lastRoomSnapshot), 3200);
  }

  // Unsold event
  if (auction.status === "unsold" && auction.playerId !== _lastUnsoldPlayerId) {
    _lastUnsoldPlayerId = auction.playerId;
    showSoldAnimation(auction);
    playUnsoldSound();
    sendSystemChat(AppState.roomId, `❌ ${auction.playerName} went UNSOLD`);
    if (AppState.isHost) setTimeout(() => advanceToNextPlayer(AppState.lastRoomSnapshot), 2500);
  }

  const pausedBanner = document.getElementById("pausedBanner");
  if (pausedBanner) pausedBanner.style.display = isPaused ? "flex" : "none";
}

// ─── PLACE BID (with consecutive-bid block) ──────────────────

async function handlePlaceBid() {
  const { roomId, userId, userName } = AppState;
  const roomData = AppState.lastRoomSnapshot;
  if (!roomData) return;

  const auction = roomData.auction;
  const me      = roomData.members?.[userId];

  if (!auction || auction.status !== "live") {
    showToast("No active auction!", "error"); return;
  }
  if (AppState.auctionPaused) {
    showToast("Auction is paused!", "warning"); return;
  }

  // ── CONSECUTIVE BID CHECK (client-side fast fail) ──
  // If this user is already the highest bidder, they must wait
  if (auction.highestBidderId === userId) {
    showToast("⏳ You're already winning! Wait for someone else to bid first.", "warning");
    return;
  }

  const newBid        = auction.currentBid + BID_INCREMENT;
  const currentPlayer = AppState.players.find(p => p.id === auction.playerId);
  const { allowed, reason } = canMemberBid(me, currentPlayer, newBid);
  if (!allowed) { showToast(reason, "error"); return; }

  const bidBtn = document.getElementById("placeBidBtn");
  if (bidBtn) bidBtn.disabled = true;

  try {
    const result = await placeBidTransaction(roomId, userId, userName, newBid);
    playBidSound();
    showBidFlash();
    await logBid(auction, userId, userName, newBid);
    if (result.boosted) showToast("⚡ Last-second bid! Timer → 5s", "warning");
  } catch(err) {
    const m = err.message;
    if (m === "Bid too low")               showToast("Someone was faster! Retry.", "warning");
    else if (m === "Auction paused")       showToast("Auction is paused!", "warning");
    else if (m === "consecutive_bid_blocked") showToast("⏳ You're already winning! Wait for someone else.", "warning");
    else { console.error(err); showToast("Bid failed. Try again!", "error"); }
  } finally {
    setTimeout(() => { if (bidBtn) bidBtn.disabled = false; }, 600);
  }
}

// ─── Mark Sold / Unsold ──────────────────────────────────────

async function markPlayerSoldOrUnsold(roomData) {
  if (_soldHandling) return;
  _soldHandling = true;
  try {
    const auction = roomData?.auction;
    if (!auction || auction.status !== "live") return;
    const status = auction.highestBidderId ? "sold" : "unsold";
    await updateRoom(AppState.roomId, { "auction.status": status });
    if (status === "sold") await logSold(auction);
    else                   await logUnsold(auction);
  } finally {
    setTimeout(() => { _soldHandling = false; }, 5000);
  }
}

// ─── Advance to Next Player ──────────────────────────────────

async function advanceToNextPlayer(roomData) {
  if (!roomData) return;
  const { roomId } = AppState;
  const auction    = roomData.auction;
  if (!auction)   return;

  const updates = {};

  if (auction.status === "sold" && auction.highestBidderId) {
    const buyerId = auction.highestBidderId;
    const price   = auction.currentBid;
    const buyer   = roomData.members?.[buyerId];
    if (buyer) {
      updates[`members.${buyerId}.team`]   = [...(buyer.team||[]), auction.playerId];
      updates[`members.${buyerId}.budget`] = Math.max(0, buyer.budget - price);
    }
    updates[`playersSold.${auction.playerId}`] = {
      playerId: auction.playerId, playerName: auction.playerName,
      boughtBy: buyerId, boughtByName: auction.highestBidderName, price
    };
  }

  if (auction.status === "unsold") {
    const existing = roomData.unsoldPlayers || [];
    if (!existing.includes(auction.playerId))
      updates.unsoldPlayers = [...existing, auction.playerId];
  }

  const newQueue = (roomData.playerQueue || []).slice(1);
  updates.playerQueue = newQueue;
  _lastTimerKey   = null;
  _soldHandling   = false;

  if (newQueue.length === 0) {
    const unsold = updates.unsoldPlayers || roomData.unsoldPlayers || [];
    if (unsold.length > 0) {
      updates.status = "waiting"; updates.auctionState = "idle"; updates.auction = null;
      await updateRoom(roomId, updates);
      await sendSystemChat(roomId, `✅ Main auction done! ${unsold.length} unsold players can be re-auctioned.`);
    } else {
      const finalData = { ...roomData, ...updates };
      await computeAndSaveTeamScores(finalData);
      await saveAuctionSummaryToProfile(finalData);
      updates.status = "finished"; updates.auctionState = "ended"; updates.auction = null;
      await updateRoom(roomId, updates);
      playFinalSound();
    }
    return;
  }

  const nextPlayer = AppState.players.find(p => p.id === newQueue[0]);
  if (nextPlayer) updates.auction = buildAuctionSlot(nextPlayer);
  await updateRoom(roomId, updates);
}

// ─── Save auction summary to Firebase user profile ───────────

async function saveAuctionSummaryToProfile(roomData) {
  const user = getCurrentUser();
  if (!user || !roomData) return;
  try {
    const me = roomData.members?.[user.uid];
    if (!me) return;
    await saveRoomToUserHistory(user.uid, roomData.roomId, {
      hostName:    roomData.hostName,
      playersCount: (me.team||[]).length,
      budgetLeft:  me.budget,
      spent:       STARTING_BUDGET - me.budget,
      status:      roomData.status
    });
    await updateUserStats(user.uid, (me.team||[]).length, STARTING_BUDGET - me.budget);
  } catch(e) { console.error("Profile save error", e); }
}

// ─── AI Scores ───────────────────────────────────────────────

async function computeAndSaveTeamScores(roomData) {
  if (!roomData || !AppState.isHost) return;
  const ranked     = rankAllTeams(roomData.members||{}, roomData.playersSold||{});
  const teamScores = {};
  ranked.forEach(m => {
    teamScores[m.id] = {
      overall:        m.eval.overall,
      grade:          m.eval.grade,
      label:          m.eval.label,
      batting:        m.eval.batting,
      bowling:        m.eval.bowling,
      allRounder:     m.eval.allRounder,
      balance:        m.eval.balance,
      efficiency:     m.eval.efficiency,
      isWinner:       m.isWinner       || false,
      isMostBalanced: m.isMostBalanced || false,
      isBestValue:    m.isBestValue    || false,
      isRisky:        m.isRisky        || false
    };
  });
  try { await updateRoom(AppState.roomId, { teamScores }); } catch(e) {}
}

// ─── Visual helpers ──────────────────────────────────────────

function showBidFlash() {
  const el = document.getElementById("bidFlash"); if (!el) return;
  el.classList.add("flash-active");
  setTimeout(() => el.classList.remove("flash-active"), 500);
}
