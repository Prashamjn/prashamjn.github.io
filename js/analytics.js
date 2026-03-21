// ============================================================
// analytics.js — Player Analytics Modal + Smart Suggestions
// NOTE: IDEAL_COMPOSITION is defined in rules.js (loaded first)
//       Do NOT redeclare it here — that caused the SyntaxError.
// ============================================================

// ─────────────────────────────────────────────
// PLAYER ANALYTICS MODAL
// openPlayerAnalytics() is called from inline onclick in room.html
// It must be defined at global (window) scope — which it is here.
// ─────────────────────────────────────────────

function openPlayerAnalytics(playerId) {
  const player = AppState.players.find(p => p.id === playerId);
  if (!player) return;

  const roomData = AppState.lastRoomSnapshot;
  const saleInfo = roomData?.playersSold?.[playerId];

  const modal = document.getElementById("analyticsModal");
  if (!modal) return;

  const roleColor = ROLE_COLORS[player.role] || "#fff";
  const roleIcon  = ROLE_ICONS[player.role]  || "🏏";
  const isBowler  = player.role === "Bowler";
  const stats     = player.stats || {};

  const battingStats = !isBowler ? `
    <div class="stat-row"><span class="stat-label">Matches</span><span class="stat-val">${stats.matches || "—"}</span></div>
    <div class="stat-row"><span class="stat-label">Runs</span><span class="stat-val">${stats.runs?.toLocaleString() || "—"}</span></div>
    <div class="stat-row"><span class="stat-label">Strike Rate</span><span class="stat-val">${stats.strikeRate || "—"}</span></div>
    <div class="stat-row"><span class="stat-label">Average</span><span class="stat-val">${stats.average || "—"}</span></div>
    <div class="stat-row"><span class="stat-label">100s / 50s</span><span class="stat-val">${stats.hundreds ?? "—"} / ${stats.fifties ?? "—"}</span></div>
  ` : "";

  const bowlingStats = (player.role === "Bowler" || player.role === "All-rounder") ? `
    <div class="stat-row"><span class="stat-label">Wickets</span><span class="stat-val">${stats.wickets || "—"}</span></div>
    <div class="stat-row"><span class="stat-label">Economy</span><span class="stat-val">${stats.economy || "—"}</span></div>
  ` : "";

  modal.innerHTML = `
    <div class="am-backdrop" onclick="closePlayerAnalytics()"></div>
    <div class="am-card" style="--rc:${roleColor}">
      <button class="am-close" onclick="closePlayerAnalytics()">✕</button>
      <div class="am-header">
        <div class="am-avatar" style="border-color:${roleColor}">${getInitials(player.name)}</div>
        <div class="am-hero">
          <div class="am-flag">${getCountryFlag(player.country)}</div>
          <h2 class="am-name">${escapeHtml(player.name)}</h2>
          <div class="am-chips">
            <span class="chip-role" style="color:${roleColor};border-color:${roleColor}44;background:${roleColor}11">${roleIcon} ${player.role}</span>
            <span class="chip-country">${escapeHtml(player.country)}</span>
            ${player.isOverseas ? `<span class="chip-overseas">🌍 Overseas</span>` : `<span class="chip-domestic">🇮🇳 Domestic</span>`}
            <span class="chip-cat">${escapeHtml(player.category || "")}</span>
          </div>
        </div>
      </div>
      <div class="am-ratings">
        ${renderRatingBar("Batting",    player.battingRating,   "#f59e0b")}
        ${renderRatingBar("Bowling",    player.bowlingRating,   "#3b82f6")}
        ${renderRatingBar("Fielding",   player.fieldingRating,  "#10b981")}
        ${renderRatingBar("Experience", player.experienceScore, "#8b5cf6")}
        ${renderRatingBar("Overall",    player.rating,          roleColor)}
      </div>
      <div class="am-price-row">
        <div class="am-price-box">
          <div class="apb-label">Base Price</div>
          <div class="apb-val">₹${player.basePrice} Cr</div>
        </div>
        ${saleInfo ? `
          <div class="am-price-box am-sold-box">
            <div class="apb-label">Sold For</div>
            <div class="apb-val">₹${saleInfo.price} Cr</div>
          </div>
          <div class="am-price-box">
            <div class="apb-label">Bought By</div>
            <div class="apb-val">${escapeHtml(saleInfo.boughtByName)}</div>
          </div>
        ` : `
          <div class="am-price-box" style="opacity:.5">
            <div class="apb-label">Status</div>
            <div class="apb-val">Not sold yet</div>
          </div>
        `}
      </div>
      ${(battingStats || bowlingStats) ? `
        <div class="am-stats-section">
          <div class="am-stats-title">📊 IPL Career Stats</div>
          <div class="am-stats-grid">${battingStats}${bowlingStats}</div>
        </div>` : ""}
      <div class="am-value-section">${getValueAssessment(player, saleInfo)}</div>
    </div>
  `;

  modal.style.display = "flex";
  requestAnimationFrame(() => {
    modal.classList.add("am-visible");
    // Animate rating bars after modal is visible
    setTimeout(() => {
      modal.querySelectorAll(".rr-fill[data-width]").forEach(el => {
        el.style.width = el.dataset.width + "%";
      });
    }, 50);
  });
}

function renderRatingBar(label, value, color) {
  return `
    <div class="rating-row">
      <span class="rr-label">${label}</span>
      <div class="rr-track">
        <div class="rr-fill" style="width:0%;background:${color}" data-width="${value || 0}"></div>
      </div>
      <span class="rr-val" style="color:${color}">${value || 0}</span>
    </div>`;
}

function getValueAssessment(player, saleInfo) {
  if (!saleInfo) return "";
  const price   = saleInfo.price;
  const fairVal = (player.rating / 100) * 10;
  const ratio   = price / fairVal;
  let icon, label, color;
  if (ratio < 0.6)      { icon = "🔥"; label = "Incredible value — huge steal!";  color = "var(--green)"; }
  else if (ratio < 0.9) { icon = "✅"; label = "Good value for money";             color = "var(--green)"; }
  else if (ratio < 1.1) { icon = "⚖️"; label = "Fair market price";               color = "var(--gold)"; }
  else if (ratio < 1.5) { icon = "⚠️"; label = "Slightly overpaid";              color = "var(--orange)"; }
  else                  { icon = "❌"; label = "Significantly overpaid";           color = "var(--red)"; }
  return `
    <div class="value-badge" style="border-color:${color}22;background:${color}11">
      <span class="vb-icon">${icon}</span>
      <span class="vb-text" style="color:${color}">${label}</span>
      <span class="vb-ratio">Fair value: ~₹${fairVal.toFixed(1)} Cr</span>
    </div>`;
}

function closePlayerAnalytics() {
  const modal = document.getElementById("analyticsModal");
  if (!modal) return;
  modal.classList.remove("am-visible");
  setTimeout(() => { modal.style.display = "none"; modal.innerHTML = ""; }, 350);
}

// ─────────────────────────────────────────────
// SMART SUGGESTION SYSTEM
// renderSmartSuggestion() called from auction.js
// ─────────────────────────────────────────────

function generateSmartSuggestion(member, currentAuction) {
  if (!member) return null;
  const teamIds = member.team || [];
  const roster  = teamIds.map(pid => AppState.players.find(p => p.id === pid)).filter(Boolean);
  const budget  = member.budget;

  const roles = { "Batsman": 0, "Bowler": 0, "All-rounder": 0, "WK": 0 };
  roster.forEach(p => { if (roles[p.role] !== undefined) roles[p.role]++; });

  const suggestions = [];

  if (roles["WK"] === 0 && budget >= 1)
    suggestions.push({ priority: "high",   msg: "🧤 You have NO wicketkeeper! Bid urgently.", icon: "🚨" });
  if (roles["Bowler"] < 2 && budget >= 1)
    suggestions.push({ priority: "high",   msg: `🎯 Only ${roles["Bowler"]} bowler(s). Need at least 3.`, icon: "⚡" });
  if (roles["Batsman"] < 3 && budget >= 1)
    suggestions.push({ priority: "medium", msg: `🏏 Only ${roles["Batsman"]} batsman. Consider strengthening.`, icon: "📈" });
  if (roles["All-rounder"] === 0 && budget >= 1)
    suggestions.push({ priority: "medium", msg: "⚡ No all-rounders! They add crucial depth.", icon: "🔄" });

  const remaining = (AppState.lastRoomSnapshot?.playerQueue || []).length;
  const budgetPerPlayer = remaining > 0 ? budget / remaining : 0;
  if (budgetPerPlayer < 2 && remaining > 5)
    suggestions.push({ priority: "high", msg: `💰 Budget tight! ~₹${budgetPerPlayer.toFixed(1)} Cr per player left.`, icon: "⚠️" });

  if (currentAuction && currentAuction.status === "live") {
    const curPlayer = AppState.players.find(p => p.id === currentAuction.playerId);
    if (curPlayer) {
      const nextBid = currentAuction.currentBid + BID_INCREMENT;
      // IDEAL_COMPOSITION is declared in rules.js (loaded before this file)
      const isFill = roles[curPlayer.role] < (IDEAL_COMPOSITION[curPlayer.role] || 2);
      if (isFill && member.budget >= nextBid)
        suggestions.push({ priority: "opportunity", msg: `💡 ${curPlayer.name} fills your ${curPlayer.role} gap!`, icon: "🎯" });
    }
  }

  return suggestions[0] || null;
}

function renderSmartSuggestion(member, auction) {
  const el = document.getElementById("smartSuggestion");
  if (!el) return;
  const s = generateSmartSuggestion(member, auction);
  if (!s) { el.style.display = "none"; return; }
  const colors = { high: "var(--red)", medium: "var(--gold)", opportunity: "var(--green)" };
  const color  = colors[s.priority] || "var(--text2)";
  el.style.display    = "flex";
  el.style.borderColor = color + "33";
  el.innerHTML = `<span class="ss-icon">${s.icon}</span><span class="ss-text" style="color:${color}">${s.msg}</span>`;
}
