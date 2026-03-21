// ============================================================
// ui.js — Phase 6: Fixed Results + Captain Selection
// ============================================================

const ROLE_COLORS = { "Batsman":"#f59e0b","Bowler":"#3b82f6","All-rounder":"#8b5cf6","WK":"#10b981" };
const ROLE_ICONS  = { "Batsman":"🏏","Bowler":"🎯","All-rounder":"⚡","WK":"🧤" };
const CATEGORY_ICONS = { "Marquee":"⭐","Batsmen":"🏏","Bowlers":"🎯","All-rounders":"⚡","Wicketkeepers":"🧤" };
const GRADE_COLORS = { "S":"#00d4aa","A":"#3b82f6","B":"#8b5cf6","C":"#f59e0b","D":"#f97316","F":"#ef4444" };

// ─── Toast ────────────────────────────────────────────────────
function showToast(message, type="info") {
  const c = document.getElementById("toastContainer"); if(!c) return;
  const t = document.createElement("div"); t.className = `toast toast-${type}`;
  const icons = { success:"✅",error:"❌",warning:"⚠️",info:"ℹ️" };
  t.innerHTML = `<span class="toast-icon">${icons[type]||"ℹ️"}</span><span>${message}</span>`;
  c.appendChild(t);
  requestAnimationFrame(()=>t.classList.add("toast-show"));
  setTimeout(()=>{ t.classList.remove("toast-show"); setTimeout(()=>t.remove(),350); },3800);
}

// ─── Lobby ────────────────────────────────────────────────────
function renderLobby(data) {
  const grid = document.getElementById("membersGrid"); if(!grid) return;
  const members = data.members||{};
  grid.innerHTML = Object.values(members).map(m=>{
    const isMe = m.id===AppState.userId;
    return `<div class="member-card ${isMe?"member-me":""} ${m.isHost?"member-host":""}">
      <div class="member-avatar" style="background:${avatarGradient(m.name)}">${getInitials(m.name)}</div>
      <div class="member-name">${escapeHtml(m.name)}${isMe?`<span class="you-badge">You</span>`:""}</div>
      ${m.isHost?`<div class="host-badge">👑 Host</div>`:""}
      <div class="member-budget">₹${m.budget} Cr</div>
    </div>`;
  }).join("");
  const ce=document.getElementById("memberCount"); if(ce) ce.textContent=Object.keys(members).length;
}

function renderStartButton(data) {
  const c=document.getElementById("hostControls"); if(!c) return;
  const unsold=data.unsoldPlayers||[];
  if(AppState.isHost){
    c.innerHTML=`<div class="host-btn-group">
      <button id="startAuctionBtn" class="btn btn-primary btn-large pulse-glow" onclick="startAuction(AppState.lastRoomSnapshot)">🚀 Start Auction</button>
      ${unsold.length>0?`<button class="btn btn-secondary btn-large" onclick="startReAuction(AppState.lastRoomSnapshot)">🔄 Re-Auction (${unsold.length})</button>`:""}
      <button class="btn btn-secondary" onclick="saveCheckpoint()" style="width:auto;padding:.65rem 1.25rem">💾 Save State</button>
    </div>
    <p class="hint-text">Queue: <strong>${data.queueMode||"stars"}</strong> · ${data.playerQueue?.length||0} players</p>`;
  } else {
    c.innerHTML=`<div class="waiting-host"><div class="spinner"></div><p>Waiting for host to start…</p></div>`;
  }
}

// ─── Host Controls ────────────────────────────────────────────
function renderHostControls(data) {
  const panel=document.getElementById("hostControlPanel"); if(!panel) return;
  if(!AppState.isHost){panel.style.display="none";return;}
  panel.style.display="flex";
  const isPaused=data.auctionState==="paused";
  const isLive=data.auction?.status==="live";
  panel.innerHTML=`<div class="hcp-title">👑 Host Controls</div>
    <div class="hcp-btns">
      ${isPaused
        ?`<button class="btn btn-success hcp-btn" onclick="resumeAuction()">▶️ Resume</button>`
        :`<button class="btn btn-warning hcp-btn" onclick="pauseAuction()" ${!isLive?"disabled":""}>⏸️ Pause</button>`}
      <button class="btn btn-secondary hcp-btn" onclick="skipCurrentPlayer(AppState.lastRoomSnapshot)" ${!isLive||isPaused?"disabled":""}>⏭️ Skip</button>
      <button class="btn btn-secondary hcp-btn" onclick="saveCheckpoint()">💾 Save</button>
      <button class="btn btn-danger hcp-btn" onclick="endAuction()">🏁 End</button>
    </div>`;
}

// ─── Current Player Card ──────────────────────────────────────
let _lastRenderedPlayerId=null;
function renderCurrentPlayer(auction,data){
  const card=document.getElementById("currentPlayerCard"); if(!card) return;
  const rc=ROLE_COLORS[auction.playerRole]||"#fff";
  const isNew=auction.playerId!==_lastRenderedPlayerId;
  _lastRenderedPlayerId=auction.playerId;
  const player=AppState.players.find(p=>p.id===auction.playerId);
  const qLen=(data.playerQueue||[]).length;
  card.innerHTML=`<div class="player-stage ${isNew?"player-enter":""}" style="--rc:${rc}" onclick="openPlayerAnalytics('${auction.playerId}')">
    <div class="player-click-hint">👆 Tap for stats</div>
    <div class="player-queue-badge">${qLen} left</div>
    <div class="player-category-chip">${CATEGORY_ICONS[auction.playerCategory]||"🏏"} ${escapeHtml(auction.playerCategory||auction.playerRole)}</div>
    <div class="player-avatar-wrap">
      <div class="player-glow-ring" style="box-shadow:0 0 40px ${rc}55"></div>
      <div class="player-circle" style="border-color:${rc}">${getInitials(auction.playerName)}</div>
      <div class="player-flag-badge">${getCountryFlag(auction.playerCountry)}</div>
    </div>
    <h2 class="player-big-name">${escapeHtml(auction.playerName)}</h2>
    <div class="player-chips-row">
      <span class="chip-role" style="color:${rc};border-color:${rc}44;background:${rc}11">${ROLE_ICONS[auction.playerRole]||"🏏"} ${auction.playerRole}</span>
      <span class="chip-country">${escapeHtml(auction.playerCountry)}</span>
      ${auction.playerIsOverseas?`<span class="chip-overseas">🌍 Overseas</span>`:`<span class="chip-domestic">🇮🇳 Domestic</span>`}
    </div>
    ${player?`<div class="player-rating-row"><div class="rating-bar-wrap"><div class="rating-bar-fill" style="width:${player.rating}%;background:${rc}"></div></div><span class="rating-val" style="color:${rc}">${player.rating}</span></div>`:""}
    <div class="base-price-tag">Base ₹${auction.playerBasePrice} Cr · ${auction.bidCount||0} bids</div>
  </div>`;
}

// ─── Bid Controls ─────────────────────────────────────────────
let _prevBid=0;
function renderBidControls(auction,data){
  const me=data.members?.[AppState.userId];
  const isHighest=auction.highestBidderId===AppState.userId;
  const nextBid=auction.currentBid+BID_INCREMENT;
  const isLive=auction.status==="live";
  const isPaused=AppState.auctionPaused;
  const bidEl=document.getElementById("currentBidDisplay");
  if(bidEl&&auction.currentBid!==_prevBid){
    animateNumber(bidEl,_prevBid,auction.currentBid,"₹"," Cr");
    _prevBid=auction.currentBid;
    bidEl.classList.add("bid-bump");
    setTimeout(()=>bidEl?.classList.remove("bid-bump"),400);
  }
  const bidderEl=document.getElementById("highestBidder");
  if(bidderEl){
    if(auction.highestBidderName){
      bidderEl.className=`bidder-display ${isHighest?"bidder-winning":""}`;
      bidderEl.innerHTML=`<span class="bidder-label">Highest bid by</span><span class="bidder-name ${isHighest?"bidder-me":""}">${escapeHtml(auction.highestBidderName)}${isHighest?" 🏆 You!":""}</span>`;
    }else{
      bidderEl.className="bidder-display";
      bidderEl.innerHTML=`<span class="bidder-label">🎯 No bids yet — be first!</span>`;
    }
  }
  const lockNotice=document.getElementById("bidLockNotice");
  if(lockNotice) lockNotice.style.display=(isLive&&isHighest)?"flex":"none";
  const bidBtn=document.getElementById("placeBidBtn");
  if(bidBtn){
    const player=AppState.players.find(p=>p.id===auction.playerId);
    const {allowed,reason}=isLive&&me?canMemberBid(me,player,nextBid):{allowed:false,reason:""};
    bidBtn.disabled=!isLive||!allowed||isPaused||isHighest;
    if(!isLive){bidBtn.textContent=auction.status==="sold"?"🔨 Sold!":"❌ Unsold";bidBtn.className="btn btn-bid btn-disabled";}
    else if(isPaused){bidBtn.textContent="⏸️ Paused";bidBtn.className="btn btn-bid btn-disabled";}
    else if(!allowed){bidBtn.textContent=reason.substring(0,30)+"…";bidBtn.className="btn btn-bid btn-blocked";}
    else if(isHighest){bidBtn.textContent="🏆 You're Winning — Wait for others";bidBtn.className="btn btn-bid btn-winning";}
    else{bidBtn.textContent=`⚡ Bid ₹${nextBid} Cr`;bidBtn.className="btn btn-bid";}
  }
  const skipBtn=document.getElementById("skipPlayerBtn");
  if(skipBtn) skipBtn.style.display=AppState.isHost&&isLive?"inline-block":"none";
  if(me) renderSquadStatus(me);
}

function renderSquadStatus(me){
  const el=document.getElementById("squadStatus"); if(!el) return;
  const s=getSquadSummary(me); const warnings=getSquadWarnings(me);
  el.innerHTML=`<div class="squad-grid">
    <div class="sq-item"><span class="sq-val">${s.total}/${IPL_RULES.MAX_SQUAD}</span><span class="sq-label">Squad</span></div>
    <div class="sq-item"><span class="sq-val">${s.overseas}/${IPL_RULES.MAX_OVERSEAS}</span><span class="sq-label">Overseas</span></div>
    <div class="sq-item"><span class="sq-val">₹${me.budget}</span><span class="sq-label">Budget</span></div>
    <div class="sq-item"><span class="sq-val">${s.batsmen}/${s.bowlers}/${s.allRounders}/${s.wks}</span><span class="sq-label">B/Bw/AR/WK</span></div>
  </div>${warnings.map(w=>`<div class="squad-warn">⚠️ ${w}</div>`).join("")}`;
}

// ─── Queue Preview ────────────────────────────────────────────
function renderQueuePreview(data){
  const c=document.getElementById("queuePreview"); if(!c) return;
  const upcoming=(data.playerQueue||[]).slice(1,4).map(id=>AppState.players.find(p=>p.id===id)).filter(Boolean);
  if(!upcoming.length){c.innerHTML=`<div class="no-upcoming">🏁 Final player!</div>`;return;}
  c.innerHTML=`<div class="queue-preview-label">Up Next</div><div class="queue-preview-list">${upcoming.map((p,i)=>`
    <div class="queue-item" style="opacity:${1-i*.22}" onclick="openPlayerAnalytics('${p.id}')">
      <div class="qi-avatar" style="border-color:${ROLE_COLORS[p.role]}">${getInitials(p.name)}</div>
      <div class="qi-info"><div class="qi-name">${escapeHtml(p.name)}</div><div class="qi-meta">${ROLE_ICONS[p.role]} ${p.role} · ₹${p.basePrice}Cr · ⭐${p.rating}</div></div>
      ${p.isOverseas?`<span class="qi-flag">🌍</span>`:""}
    </div>`).join("")}</div>`;
}

// ─── Leaderboard ──────────────────────────────────────────────
function renderLeaderboard(data){
  const c=document.getElementById("leaderboardList"); if(!c) return;
  const members=Object.values(data.members||{}).sort((a,b)=>(b.team?.length||0)-(a.team?.length||0));
  c.innerHTML=members.map((m,idx)=>{
    const isMe=m.id===AppState.userId;
    const spent=STARTING_BUDGET-m.budget; const count=(m.team||[]).length;
    const pct=(m.budget/STARTING_BUDGET)*100; const score=data.teamScores?.[m.id];
    return `<div class="lb-row ${isMe?"lb-row-me":""}">
      <div class="lb-rank">${["🥇","🥈","🥉"][idx]||`#${idx+1}`}</div>
      <div class="lb-avatar" style="background:${avatarGradient(m.name)}">${getInitials(m.name)}</div>
      <div class="lb-info">
        <div class="lb-name">${escapeHtml(m.name)}${isMe?` <span class="you-badge">You</span>`:""}${m.isHost?" 👑":""}</div>
        <div class="lb-sub"><span class="lb-budget">₹${m.budget} Cr</span><span class="lb-spent">Spent ₹${spent}</span>${score?`<span class="lb-grade" style="color:${GRADE_COLORS[score.grade]||"#fff"}">${score.grade}:${score.overall}</span>`:""}</div>
        <div class="lb-mini-bar"><div class="lb-mini-fill" style="width:${pct}%;background:${pct>50?"var(--green)":pct>20?"var(--gold)":"var(--red)"}"></div></div>
      </div>
      <div class="lb-stats"><div class="lb-count">${count} 🏏</div>${getSquadWarnings(m).map(w=>`<div class="lb-warn">${w}</div>`).join("")}</div>
    </div>`;
  }).join("");
}

function renderMyBudget(me){
  const el=document.getElementById("myBudgetDisplay"); if(!el) return;
  const pct=(me.budget/STARTING_BUDGET)*100;
  el.innerHTML=`<span class="budget-ico">💰</span><span class="budget-val">₹${me.budget} Cr</span>
    <div class="budget-mini-bar"><div class="budget-mini-fill" style="width:${pct}%;background:${pct>50?"var(--green)":pct>20?"var(--gold)":"var(--red)"}"></div></div>`;
}

// ─── Teams Panel ──────────────────────────────────────────────
function renderAllTeams(data){
  const c=document.getElementById("teamsContainer"); if(!c) return;
  c.innerHTML=Object.values(data.members||{}).map(m=>{
    const isMe=m.id===AppState.userId;
    const bought=(m.team||[]).map(pid=>AppState.players.find(p=>p.id===pid)).filter(Boolean);
    const s=getSquadSummary(m); const score=data.teamScores?.[m.id];
    return `<div class="team-panel ${isMe?"team-panel-me":""}">
      <div class="team-header">
        <div class="team-avatar" style="background:${avatarGradient(m.name)}">${getInitials(m.name)}</div>
        <div class="team-info">
          <div class="team-owner">${escapeHtml(m.name)}${isMe?" 👤":""}${m.isHost?" 👑":""}</div>
          <div class="team-stats-row"><span>₹${m.budget} Cr</span><span>${s.overseas}/${IPL_RULES.MAX_OVERSEAS} OS</span>${score?`<span style="color:${GRADE_COLORS[score.grade]}">Grade ${score.grade}</span>`:""}</div>
        </div>
        <div class="team-count">${bought.length}🏏</div>
      </div>
      <div class="team-role-bar">${renderRoleBar(s)}</div>
      <div class="team-players-list">${bought.length===0?`<div class="no-players-yet">No players yet</div>`:bought.map(p=>{
        const sale=data.playersSold?.[p.id];
        return `<div class="team-player-row" style="border-left:3px solid ${ROLE_COLORS[p.role]}" onclick="openPlayerAnalytics('${p.id}')">
          <span class="tpr-icon">${ROLE_ICONS[p.role]}</span><span class="tpr-name">${escapeHtml(p.name)}</span>
          ${p.isOverseas?`<span class="tpr-os">🌍</span>`:""}
          <span class="tpr-price">₹${sale?.price||p.basePrice}Cr</span>
        </div>`;
      }).join("")}</div>
    </div>`;
  }).join("");
}

function renderRoleBar(s){
  return [["Batsman","#f59e0b",s.batsmen],["Bowler","#3b82f6",s.bowlers],["All-rounder","#8b5cf6",s.allRounders],["WK","#10b981",s.wks]]
    .filter(([,,v])=>v>0).map(([,c,v])=>`<div class="role-bar-seg" style="background:${c};flex:${v}"></div>`).join("");
}

// ─── Sold Animation ───────────────────────────────────────────
function showSoldAnimation(auction){
  const overlay=document.getElementById("soldOverlay"); if(!overlay) return;
  const isSold=!!auction.highestBidderId;
  overlay.innerHTML=isSold
    ?`<div class="sold-card"><div class="sold-hammer">🔨</div><div class="sold-word">SOLD!</div><div class="sold-pname">${escapeHtml(auction.playerName)}</div><div class="sold-price">₹${auction.currentBid} Cr</div><div class="sold-to">to <strong>${escapeHtml(auction.highestBidderName)}</strong></div></div>`
    :`<div class="sold-card unsold-card"><div class="sold-hammer">❌</div><div class="sold-word unsold-word">UNSOLD</div><div class="sold-pname">${escapeHtml(auction.playerName)}</div><div class="sold-to">No takers</div></div>`;
  overlay.style.display="flex";
  requestAnimationFrame(()=>overlay.classList.add("sold-visible"));
  setTimeout(()=>{ overlay.classList.remove("sold-visible"); setTimeout(()=>{overlay.style.display="none";overlay.innerHTML="";},400); },2800);
}

// ══════════════════════════════════════════════════════════════
// FINAL RESULTS DASHBOARD — Phase 7 (Premium Redesign)
// ══════════════════════════════════════════════════════════════
function renderFinalResults(data) {
  const c = document.getElementById("finalResultsContainer");
  if (!c) return;

  if (!AppState.players || AppState.players.length === 0) {
    c.innerHTML = `<div class="res-loading"><div class="spinner"></div><p>Loading results…</p></div>`;
    setTimeout(() => { if (AppState.lastRoomSnapshot) renderFinalResults(AppState.lastRoomSnapshot); }, 1500);
    return;
  }

  const playersSold = data.playersSold || {};
  const captains    = data.captains    || {};

  // Always compute fresh scores client-side — don't rely on saved teamScores
  // This fixes the "0/Grade -" issue when teamScores wasn't saved to Firestore
  let ranked = [];
  try { ranked = rankAllTeams(data.members || {}, playersSold); }
  catch(e) {
    ranked = Object.values(data.members || {}).map(m => ({
      ...m, eval:{overall:0,grade:"F",label:"N/A",batting:0,bowling:0,allRounder:0,balance:0,efficiency:0},
      isWinner:false
    }));
  }

  // Merge Firestore teamScores (if available) with locally computed scores
  // Local scores take priority since they're always fresh
  ranked.forEach(m => {
    const stored = data.teamScores?.[m.id];
    if (stored && stored.overall > 0 && (!m.eval || m.eval.overall === 0)) {
      m.eval = { ...m.eval, ...stored };
    }
  });

  let awards = [];
  try { if (Object.keys(playersSold).length > 0) awards = generateAwards(data.members || {}, playersSold); }
  catch(e) {}

  const winner    = ranked[0];
  const totalSold = Object.keys(playersSold).length;
  const unsold    = data.unsoldPlayers || [];

  c.innerHTML = `

<!-- ════════ HERO BANNER ════════ -->
<div class="res-hero">
  <div class="res-hero-bg"></div>
  <div class="res-hero-content">
    <div class="res-trophy-row">
      <span class="res-trophy-anim">🏆</span>
    </div>
    <h1 class="res-headline">Auction Complete!</h1>
    <p class="res-subline">${totalSold} players sold · ${Object.keys(data.members||{}).length} teams competed</p>
    ${winner ? `
      <div class="res-winner-chip">
        <span class="rwc-crown">👑</span>
        <span class="rwc-label">Best Team</span>
        <span class="rwc-name">${escapeHtml(winner.name)}</span>
        <span class="rwc-score" style="color:${GRADE_COLORS[winner.eval?.grade]||"var(--green)"}">
          ${winner.eval?.overall ?? 0}/100
        </span>
      </div>` : ""}
    <div class="res-hero-actions">
      ${AppState.isHost ? `<button class="btn btn-secondary res-action-btn" onclick="startReplay('${AppState.roomId}')">🎬 Replay</button>` : ""}
      <a href="index.html" class="btn btn-primary res-action-btn">🏠 New Auction</a>
    </div>
  </div>
</div>

<!-- ════════ PODIUM ════════ -->
${ranked.length > 0 ? `
<div class="res-section">
  <div class="res-section-header">
    <span class="res-section-icon">🏅</span>
    <span class="res-section-title">Team Rankings</span>
    <span class="res-section-sub">AI-powered squad evaluation</span>
  </div>
  <div class="res-podium-row">
    ${ranked.slice(0,3).map((m, idx) => {
      const sc = m.eval || {};
      const gc = GRADE_COLORS[sc.grade] || "var(--text2)";
      const isMe = m.id === AppState.userId;
      const captain = captains[m.id] ? AppState.players.find(p=>p.id===captains[m.id]) : null;
      const bought = (m.team||[]).map(pid=>AppState.players.find(p=>p.id===pid)).filter(Boolean);
      const spent = STARTING_BUDGET - m.budget;
      const podiumH = [240, 200, 170][idx] || 170;
      const podiumEmoji = ["🥇","🥈","🥉"][idx];
      const labels = [];
      if(m.isWinner)        labels.push({t:"Best Team",     c:"#f59e0b"});
      if(m.isMostBalanced)  labels.push({t:"Most Balanced", c:"#10b981"});
      if(m.isBestValue)     labels.push({t:"Best Value",    c:"#3b82f6"});
      if(m.isRisky)         labels.push({t:"Risky Build",   c:"#ef4444"});
      return `
        <div class="res-podium-card ${isMe?"rpc-me":""} rpc-${idx+1}" style="--ph:${podiumH}px;--gc:${gc}">
          <div class="rpc-rank-badge">${podiumEmoji}</div>
          <div class="rpc-score-ring" style="--sc:${gc}">
            <svg class="rpc-ring-svg" viewBox="0 0 80 80">
              <circle class="rpc-ring-track" cx="40" cy="40" r="34"/>
              <circle class="rpc-ring-fill"  cx="40" cy="40" r="34"
                stroke="${gc}"
                stroke-dasharray="${2*Math.PI*34}"
                stroke-dashoffset="${2*Math.PI*34*(1-(sc.overall||0)/100)}"
              />
            </svg>
            <div class="rpc-ring-inner">
              <div class="rpc-ring-num" style="color:${gc}">${sc.overall??0}</div>
              <div class="rpc-ring-lbl">/ 100</div>
            </div>
          </div>
          <div class="rpc-avatar" style="background:${avatarGradient(m.name)}">${getInitials(m.name)}</div>
          <div class="rpc-name">${escapeHtml(m.name)}${isMe?`<span class="you-badge">You</span>`:""}${m.isHost?" 👑":""}</div>
          <div class="rpc-grade-pill" style="background:${gc}22;color:${gc};border:1px solid ${gc}44">Grade ${sc.grade||"-"} · ${sc.label||""}</div>
          ${captain?`<div class="rpc-captain">⭐ ${escapeHtml(captain.name)}</div>`:""}
          <div class="rpc-labels">${labels.map(l=>`<span class="rpc-label" style="color:${l.c};border-color:${l.c}33;background:${l.c}11">${l.t}</span>`).join("")}</div>
          <div class="rpc-stats-row">
            <div class="rpc-stat"><span class="rps-val">${bought.length}</span><span class="rps-lbl">Players</span></div>
            <div class="rpc-stat"><span class="rps-val">₹${spent}Cr</span><span class="rps-lbl">Spent</span></div>
            <div class="rpc-stat"><span class="rps-val">₹${m.budget}Cr</span><span class="rps-lbl">Left</span></div>
          </div>
          <div class="rpc-bars">
            ${resBar("Bat",sc.batting??0,"#f59e0b")}
            ${resBar("Bowl",sc.bowling??0,"#3b82f6")}
            ${resBar("AR",sc.allRounder??0,"#8b5cf6")}
            ${resBar("Bal",sc.balance??0,"#10b981")}
            ${resBar("Eff",sc.efficiency??0,"#f97316")}
          </div>
        </div>`;
    }).join("")}
  </div>
  ${ranked.length > 3 ? `
    <div class="res-others-row">
      ${ranked.slice(3).map((m,i)=>{
        const sc=m.eval||{}; const gc=GRADE_COLORS[sc.grade]||"var(--text2)";
        const bought=(m.team||[]).length; const isMe=m.id===AppState.userId;
        return `<div class="res-other-card ${isMe?"roc-me":""}">
          <div class="roc-rank">#${i+4}</div>
          <div class="roc-av" style="background:${avatarGradient(m.name)}">${getInitials(m.name)}</div>
          <div class="roc-info">
            <div class="roc-name">${escapeHtml(m.name)}${isMe?` <span class="you-badge">You</span>`:""}</div>
            <div class="roc-sub">${bought} players · Grade <span style="color:${gc}">${sc.grade||"-"}</span> · ${sc.overall??0}/100</div>
          </div>
          <div class="roc-score" style="color:${gc}">${sc.overall??0}</div>
        </div>`;
      }).join("")}
    </div>` : ""}
</div>` : ""}

<!-- ════════ CAPTAIN SELECTION ════════ -->
<div class="res-section">
  <div class="res-section-header">
    <span class="res-section-icon">⭐</span>
    <span class="res-section-title">Choose Your Captain</span>
    <span class="res-section-sub">Tap any player in your squad to crown them</span>
  </div>
  <div class="res-captain-grid">
    ${ranked.map(m => {
      const isMe = m.id === AppState.userId;
      const bought = (m.team||[]).map(pid=>AppState.players.find(p=>p.id===pid)).filter(Boolean);
      const myCap = captains[m.id];
      const capPlayer = myCap ? AppState.players.find(p=>p.id===myCap) : null;
      if(bought.length===0) return "";
      return `<div class="res-cap-card ${isMe?"rcc-me":""}">
        <div class="rcc-header">
          <div class="rcc-av" style="background:${avatarGradient(m.name)}">${getInitials(m.name)}</div>
          <div class="rcc-meta">
            <div class="rcc-name">${escapeHtml(m.name)}${isMe?" (You)":""}</div>
            ${capPlayer
              ? `<div class="rcc-chosen">⭐ <strong>${escapeHtml(capPlayer.name)}</strong> — Captain</div>`
              : isMe
                ? `<div class="rcc-prompt">Tap a player below to set as captain</div>`
                : `<div class="rcc-waiting">⏳ Not selected yet</div>`}
          </div>
        </div>
        <div class="rcc-grid">
          ${bought.map(p=>{
            const isCap = myCap===p.id;
            const rc = ROLE_COLORS[p.role]||"#fff";
            return `<div class="rcc-player ${isCap?"rcc-is-cap":""} ${isMe?"rcc-can-pick":""}"
              ${isMe?`onclick="selectCaptain('${m.id}','${p.id}')"`:""}
              title="${escapeHtml(p.name)}">
              <div class="rccp-icon" style="background:${rc}22;border:1px solid ${rc}33">${isCap?"⭐":ROLE_ICONS[p.role]}</div>
              <div class="rccp-name">${escapeHtml(p.name.split(" ")[0])}</div>
              <div class="rccp-role" style="color:${rc}">${p.role==="All-rounder"?"AR":p.role}</div>
              ${isCap?`<div class="rccp-cap-badge">C</div>`:""}
            </div>`;
          }).join("")}
        </div>
      </div>`;
    }).filter(Boolean).join("")}
  </div>
</div>

<!-- ════════ FULL SQUADS ════════ -->
<div class="res-section">
  <div class="res-section-header">
    <span class="res-section-icon">📋</span>
    <span class="res-section-title">Full Squad Breakdown</span>
    <span class="res-section-sub">Click any player for detailed stats</span>
  </div>
  <div class="res-squads-grid">
    ${ranked.map(m => {
      const bought = (m.team||[]).map(pid=>AppState.players.find(p=>p.id===pid)).filter(Boolean);
      const captain = captains[m.id];
      const isMe = m.id === AppState.userId;
      const sc = m.eval || {};
      const gc = GRADE_COLORS[sc.grade] || "var(--text2)";
      const byRole = {"Batsman":[],"All-rounder":[],"Bowler":[],"WK":[]};
      bought.forEach(p=>{ if(byRole[p.role]) byRole[p.role].push(p); });
      const capPlayer = captain ? AppState.players.find(p=>p.id===captain) : null;
      return `<div class="res-squad-card ${isMe?"rsq-me":""}">
        <div class="rsq-header" style="--gc:${gc}">
          <div class="rsq-av" style="background:${avatarGradient(m.name)}">${getInitials(m.name)}</div>
          <div class="rsq-info">
            <div class="rsq-name">${escapeHtml(m.name)}${isMe?" <span class='you-badge'>You</span>":""}</div>
            ${capPlayer?`<div class="rsq-cap">⭐ ${escapeHtml(capPlayer.name)}</div>`:""}
          </div>
          <div class="rsq-badge" style="background:${gc}22;color:${gc};border:1px solid ${gc}44">
            ${sc.grade||"-"} · ${sc.overall??0}
          </div>
        </div>
        ${Object.entries(byRole).map(([role,players])=>{
          if(!players.length) return "";
          return `<div class="rsq-role-block">
            <div class="rsq-role-title" style="color:${ROLE_COLORS[role]}">${ROLE_ICONS[role]} ${role}s <span style="opacity:.5">${players.length}</span></div>
            ${players.map(p=>{
              const sale=playersSold[p.id];
              const isCap=captain===p.id;
              const rc=ROLE_COLORS[p.role];
              return `<div class="rsq-player ${isCap?"rsq-cap-row":""}" onclick="openPlayerAnalytics('${p.id}')">
                <div class="rsqp-left">
                  ${isCap?`<span class="rsqp-star">⭐</span>`:`<span class="rsqp-dot" style="background:${rc}"></span>`}
                  <span class="rsqp-name">${escapeHtml(p.name)}</span>
                  ${p.isOverseas?`<span class="rsqp-os">🌍</span>`:""}
                  ${isCap?`<span class="captain-badge" style="margin-left:.25rem">C</span>`:""}
                </div>
                <span class="rsqp-price">₹${sale?.price||p.basePrice}Cr</span>
              </div>`;
            }).join("")}
          </div>`;
        }).join("")}
        ${bought.length===0?`<div class="rsq-empty">No players purchased</div>`:""}
      </div>`;
    }).join("")}
  </div>
</div>

<!-- ════════ AWARDS ════════ -->
${awards.length ? `
<div class="res-section">
  <div class="res-section-header">
    <span class="res-section-icon">🏅</span>
    <span class="res-section-title">Special Awards</span>
    <span class="res-section-sub">Standout moments from this auction</span>
  </div>
  <div class="res-awards-grid">
    ${awards.map(a=>`
      <div class="res-award-card">
        <div class="rac-icon">${a.icon}</div>
        <div class="rac-title">${escapeHtml(a.title)}</div>
        <div class="rac-desc">${escapeHtml(a.desc)}</div>
        <div class="rac-sub">${escapeHtml(a.sub)}</div>
      </div>`).join("")}
  </div>
</div>` : ""}

<!-- ════════ UNSOLD ════════ -->
${unsold.length ? `
<div class="res-section">
  <div class="res-section-header">
    <span class="res-section-icon">❌</span>
    <span class="res-section-title">Unsold Players (${unsold.length})</span>
    <span class="res-section-sub">No bids were placed</span>
  </div>
  <div class="res-unsold-chips">
    ${unsold.map(pid=>{
      const p=AppState.players.find(x=>x.id===pid);
      return p?`<span class="res-unsold-chip" onclick="openPlayerAnalytics('${p.id}')">${ROLE_ICONS[p.role]||""} ${escapeHtml(p.name)}</span>`:"";
    }).join("")}
  </div>
</div>` : ""}
  `;

  // Animate SVG rings after render
  requestAnimationFrame(() => {
    document.querySelectorAll(".rpc-ring-fill").forEach(el => {
      el.style.transition = "stroke-dashoffset 1s ease .3s";
    });
  });
}

function resBar(label, value, color) {
  return `<div class="rpc-bar-row">
    <span class="rpc-bar-lbl">${label}</span>
    <div class="rpc-bar-track"><div class="rpc-bar-fill" style="width:${Math.min(100,value||0)}%;background:${color}"></div></div>
    <span class="rpc-bar-val">${value||0}</span>
  </div>`;
}

// ─── Captain Selection (Firestore write) ─────────────────────
async function selectCaptain(memberId, playerId) {
  if (memberId !== AppState.userId) return;
  try {
    await updateRoom(AppState.roomId, { [`captains.${memberId}`]: playerId });
    const player = AppState.players.find(p=>p.id===playerId);
    showToast(`⭐ ${player?.name||"Player"} is your Captain!`, "success");
  } catch(e) {
    showToast("Failed to set captain. Try again.", "error");
  }
}

// ─── Helper bars ─────────────────────────────────────────────
function flbBar(label, value, color) {
  return `<div class="flb-bar-row">
    <span class="flb-bar-label">${label}</span>
    <div class="flb-bar-track"><div class="flb-bar-fill" style="width:${Math.min(100,value||0)}%;background:${color}"></div></div>
    <span class="flb-bar-val">${value||0}</span>
  </div>`;
}
function rcBar(label,value,color){return flbBar(label,value,color);}

// ─── Utilities ────────────────────────────────────────────────
function getInitials(n)    { return (n||"?").split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase(); }
function escapeHtml(s)     { const d=document.createElement("div"); d.textContent=s||""; return d.innerHTML; }
function getCountryFlag(c) { return {"India":"🇮🇳","Australia":"🇦🇺","England":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","South Africa":"🇿🇦","West Indies":"🏝️","Afghanistan":"🇦🇫","New Zealand":"🇳🇿","Pakistan":"🇵🇰","Sri Lanka":"🇱🇰"}[c]||"🌍"; }
function avatarGradient(n) { const h=n.split("").reduce((a,c)=>a+c.charCodeAt(0),0)%360; return `linear-gradient(135deg,hsl(${h},70%,40%),hsl(${(h+60)%360},70%,30%))`; }
function animateNumber(el,from,to,prefix="",suffix="") {
  if(from===to){el.textContent=prefix+to+suffix;return;}
  const dur=500,start=performance.now();
  const run=t=>{const p=Math.min((t-start)/dur,1),e=1-Math.pow(1-p,3),v=from+(to-from)*e;el.textContent=prefix+Math.round(v*10)/10+suffix;if(p<1)requestAnimationFrame(run);else el.textContent=prefix+to+suffix;};
  requestAnimationFrame(run);
}

// ─── Custom Confirm Dialog ─────────────────────────────────────
function showConfirmDialog(title, message, confirmText="Confirm", cancelText="Cancel") {
  return new Promise(resolve => {
    const existing=document.getElementById("confirmDialog"); if(existing) existing.remove();
    const overlay=document.createElement("div"); overlay.id="confirmDialog";
    overlay.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:9999;";
    overlay.innerHTML=`<div style="background:linear-gradient(145deg,rgba(30,35,55,.98),rgba(20,25,40,.99));border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:2rem;max-width:360px;width:calc(100%-2rem);box-shadow:0 24px 64px rgba(0,0,0,.6);animation:popIn .3s cubic-bezier(.34,1.56,.64,1) both;text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:.75rem">⚠️</div>
      <div style="font-family:var(--fb,sans-serif);font-size:1.6rem;letter-spacing:.04em;margin-bottom:.5rem;color:#eef2ff">${escapeHtml(title)}</div>
      <div style="font-size:.88rem;color:rgba(238,242,255,.55);margin-bottom:1.75rem;line-height:1.5">${escapeHtml(message)}</div>
      <div style="display:flex;gap:.75rem;justify-content:center">
        <button id="dialogCancel" style="flex:1;padding:.8rem;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#eef2ff;font-family:inherit;font-size:.9rem;font-weight:700;cursor:pointer">${escapeHtml(cancelText)}</button>
        <button id="dialogConfirm" style="flex:1;padding:.8rem;background:linear-gradient(135deg,#ef4444,#c0392b);border:none;border-radius:10px;color:#fff;font-family:inherit;font-size:.9rem;font-weight:800;cursor:pointer;box-shadow:0 4px 16px rgba(239,68,68,.4)">${escapeHtml(confirmText)}</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const cleanup=r=>{overlay.style.opacity="0";overlay.style.transition="opacity .2s";setTimeout(()=>overlay.remove(),200);resolve(r);};
    overlay.querySelector("#dialogCancel").addEventListener("click",()=>cleanup(false));
    overlay.querySelector("#dialogConfirm").addEventListener("click",()=>cleanup(true));
    overlay.addEventListener("click",e=>{if(e.target===overlay)cleanup(false);});
  });
}