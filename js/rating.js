// ============================================================
// rating.js — Phase 3: AI Team Rating & Evaluation Engine
// ============================================================

// Weights for the composite scoring formula
const RATING_WEIGHTS = {
  battingDepth:    0.28,   // quality of batsmen
  bowlingStrength: 0.28,   // quality of bowlers
  allRounderValue: 0.18,   // all-rounders contribution
  squadBalance:    0.14,   // role distribution completeness
  budgetEfficiency:0.12    // value for money spent
};

// Ideal squad composition for balance scoring
const IDEAL_COMPOSITION = {
  Batsman:     7,
  Bowler:      5,
  "All-rounder": 4,
  WK:          2
};

/**
 * Evaluate a single member's team and return a full rating object.
 * @param {object} member   — Firestore member object { budget, team:[] }
 * @param {object} playersSold — { playerId: { price } }
 * @returns {object} rating
 */
function evaluateTeam(member, playersSold) {
  const teamIds = member.team || [];
  const roster  = teamIds.map(pid => AppState.players.find(p => p.id === pid)).filter(Boolean);

  if (roster.length === 0) {
    return {
      overall: 0, grade: "F", label: "Empty Squad",
      batting: 0, bowling: 0, allRounder: 0, balance: 0, efficiency: 0,
      roster, awards: []
    };
  }

  // ── Batting depth (top 5 batsmen/wk by battingRating) ──
  const batters = roster
    .filter(p => p.role === "Batsman" || p.role === "WK")
    .sort((a, b) => b.battingRating - a.battingRating)
    .slice(0, 5);
  const battingScore = batters.length
    ? batters.reduce((s, p) => s + p.battingRating, 0) / (batters.length * 100) * 100
    : 0;

  // ── Bowling strength (top 4 bowlers/all-rounders by bowlingRating) ──
  const bowlers = roster
    .filter(p => p.role === "Bowler" || p.role === "All-rounder")
    .sort((a, b) => b.bowlingRating - a.bowlingRating)
    .slice(0, 4);
  const bowlingScore = bowlers.length
    ? bowlers.reduce((s, p) => s + p.bowlingRating, 0) / (bowlers.length * 100) * 100
    : 0;

  // ── All-rounder value ──
  const arPlayers = roster.filter(p => p.role === "All-rounder");
  const arScore   = arPlayers.length
    ? Math.min(100, (arPlayers.reduce((s, p) => s + (p.battingRating + p.bowlingRating) / 2, 0) / arPlayers.length) * (1 + arPlayers.length * 0.05))
    : 20; // penalty for zero all-rounders

  // ── Squad balance (compared to ideal distribution) ──
  const roleCounts = { Batsman: 0, Bowler: 0, "All-rounder": 0, WK: 0 };
  roster.forEach(p => { if (roleCounts[p.role] !== undefined) roleCounts[p.role]++; });
  const balancePenalties = Object.entries(IDEAL_COMPOSITION).map(([role, ideal]) => {
    const diff = Math.abs((roleCounts[role] || 0) - ideal);
    return diff * 8; // 8 points per missing player
  });
  const balanceScore = Math.max(0, 100 - balancePenalties.reduce((a, b) => a + b, 0));

  // ── Budget efficiency (value vs price paid) ──
  let totalValue = 0, totalSpent = 0;
  roster.forEach(p => {
    const paid = playersSold?.[p.id]?.price || p.basePrice;
    const pRating = (p.battingRating + p.bowlingRating) / 2;
    // Fair value = rating / 100 * 10 Cr (max ₹10 Cr per player conceptually)
    const fairValue = (pRating / 100) * 10;
    const ratio     = paid > 0 ? fairValue / paid : 1;
    totalValue += Math.min(2, ratio); // cap ratio at 2x
    totalSpent += paid;
  });
  const efficiencyScore = Math.min(100, (totalValue / roster.length) * 60 + (member.budget / STARTING_BUDGET) * 40);

  // ── Overseas balance penalty ──
  const overseasCount = roster.filter(p => p.isOverseas).length;
  const overseasPenalty = overseasCount > 8 ? (overseasCount - 8) * 5 : 0;

  // ── Experience bonus ──
  const avgExperience = roster.reduce((s, p) => s + (p.experienceScore || 70), 0) / roster.length;
  const expBonus = (avgExperience - 70) * 0.3; // up to ~9 bonus points

  // ── Weighted composite ──
  const raw =
    battingScore    * RATING_WEIGHTS.battingDepth    +
    bowlingScore    * RATING_WEIGHTS.bowlingStrength +
    arScore         * RATING_WEIGHTS.allRounderValue +
    balanceScore    * RATING_WEIGHTS.squadBalance    +
    efficiencyScore * RATING_WEIGHTS.budgetEfficiency;

  const overall = Math.max(0, Math.min(100, Math.round(raw - overseasPenalty + expBonus)));

  // ── Grade + label ──
  const { grade, label } = getGradeLabel(overall, balanceScore, efficiencyScore, arPlayers.length);

  return {
    overall, grade, label,
    batting:    Math.round(battingScore),
    bowling:    Math.round(bowlingScore),
    allRounder: Math.round(arScore),
    balance:    Math.round(balanceScore),
    efficiency: Math.round(efficiencyScore),
    overseasCount,
    roleCounts,
    roster,
    totalSpent,
    avgPlayerRating: Math.round(roster.reduce((s, p) => s + p.rating, 0) / roster.length)
  };
}

function getGradeLabel(overall, balance, efficiency, arCount) {
  if (overall >= 88) return { grade: "S", label: "World Class" };
  if (overall >= 80) return { grade: "A", label: "Championship Calibre" };
  if (overall >= 70) return { grade: "B", label: "Strong Squad" };
  if (overall >= 58) return { grade: "C", label: "Average Team" };
  if (overall >= 42) return { grade: "D", label: "Needs Work" };
  return { grade: "F", label: "Undercooked" };
}

/**
 * Generate special awards across all teams.
 */
function generateAwards(members, playersSold) {
  const awards = [];
  const allSold = Object.values(playersSold || {});

  if (allSold.length === 0) return awards;

  // Most expensive player
  const mostExp = allSold.sort((a, b) => b.price - a.price)[0];
  if (mostExp) {
    const p = AppState.players.find(x => x.id === mostExp.playerId);
    awards.push({
      icon: "💰", title: "Most Expensive Player",
      desc: `${mostExp.playerName} — ₹${mostExp.price} Cr`,
      sub:  `Bought by ${mostExp.boughtByName}`
    });
  }

  // Steal of the Auction: highest (rating / price) ratio
  const steals = allSold.map(s => {
    const p = AppState.players.find(x => x.id === s.playerId);
    return { ...s, ratio: p ? (p.rating / s.price) : 0, rating: p?.rating || 0 };
  }).sort((a, b) => b.ratio - a.ratio);
  if (steals[0]) {
    awards.push({
      icon: "🎯", title: "Steal of the Auction",
      desc: `${steals[0].playerName} — ₹${steals[0].price} Cr (Rating: ${steals[0].rating})`,
      sub:  `Bought by ${steals[0].boughtByName}`
    });
  }

  // Biggest spender
  const spenders = Object.values(members).map(m => ({
    name: m.name,
    spent: STARTING_BUDGET - m.budget
  })).sort((a, b) => b.spent - a.spent);
  if (spenders[0]) {
    awards.push({
      icon: "💸", title: "Biggest Spender",
      desc: `${spenders[0].name} — ₹${spenders[0].spent} Cr spent`,
      sub:  `₹${STARTING_BUDGET - spenders[0].spent} Cr remaining`
    });
  }

  // Most frugal (most budget remaining with players bought)
  const frugal = Object.values(members)
    .filter(m => (m.team || []).length > 0)
    .sort((a, b) => b.budget - a.budget);
  if (frugal[0]) {
    awards.push({
      icon: "🏦", title: "Budget Savant",
      desc: `${frugal[0].name} — ₹${frugal[0].budget} Cr remaining`,
      sub:  `${frugal[0].team.length} players bought`
    });
  }

  // Most overseas players
  const mostOS = Object.values(members).map(m => {
    const os = (m.team || []).filter(pid => {
      const p = AppState.players.find(x => x.id === pid);
      return p?.isOverseas;
    }).length;
    return { name: m.name, os };
  }).sort((a, b) => b.os - a.os);
  if (mostOS[0]?.os > 0) {
    awards.push({
      icon: "🌍", title: "Global Scout",
      desc: `${mostOS[0].name} — ${mostOS[0].os} overseas players`,
      sub:  "Most international talent"
    });
  }

  return awards;
}

/**
 * Rank all teams and determine special category awards.
 */
function rankAllTeams(members, playersSold) {
  const rated = Object.values(members).map(m => ({
    ...m,
    eval: evaluateTeam(m, playersSold)
  })).sort((a, b) => b.eval.overall - a.eval.overall);

  // Special labels
  if (rated.length > 0) rated[0].isWinner = true;

  // Most balanced (highest balance score)
  const byBalance = [...rated].sort((a, b) => b.eval.balance - a.eval.balance);
  if (byBalance[0]) byBalance[0].isMostBalanced = true;

  // Best value (highest efficiency)
  const byEfficiency = [...rated].sort((a, b) => b.eval.efficiency - a.eval.efficiency);
  if (byEfficiency[0]) byEfficiency[0].isBestValue = true;

  // Risky team (lowest balance despite spending)
  const risky = [...rated].sort((a, b) => a.eval.balance - b.eval.balance);
  if (risky[0] && risky[0].eval.balance < 55) risky[0].isRisky = true;

  return rated;
}
