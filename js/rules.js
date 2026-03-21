// ============================================================
// rules.js — IPL Squad Rules Engine + shared constants
// SINGLE SOURCE OF TRUTH for IDEAL_COMPOSITION (fixes duplicate-const error)
// ============================================================

const IPL_RULES = {
  MAX_SQUAD:       25,
  MIN_SQUAD:       18,
  MAX_OVERSEAS:     8,
  STARTING_BUDGET: 100
};

// Ideal squad composition used by both rules.js and analytics.js
// Declared here once — analytics.js references this, does NOT redeclare it
const IDEAL_COMPOSITION = {
  "Batsman":     7,
  "Bowler":      5,
  "All-rounder": 4,
  "WK":          2
};

function canMemberBid(member, player, nextBidAmount) {
  if (!member || !player) return { allowed: false, reason: "Invalid state" };

  const teamIds       = member.team || [];
  const overseasCount = teamIds.filter(pid => {
    const p = AppState.players.find(x => x.id === pid);
    return p && p.isOverseas;
  }).length;

  if (member.budget < nextBidAmount)
    return { allowed: false, reason: `💸 Insufficient budget! You have ₹${member.budget} Cr` };

  if (teamIds.length >= IPL_RULES.MAX_SQUAD)
    return { allowed: false, reason: `🚫 Squad full! Max ${IPL_RULES.MAX_SQUAD} players` };

  if (player.isOverseas && overseasCount >= IPL_RULES.MAX_OVERSEAS)
    return { allowed: false, reason: `🌍 Overseas limit! Max ${IPL_RULES.MAX_OVERSEAS}` };

  return { allowed: true, reason: "" };
}

function getSquadSummary(member) {
  const teamIds = member.team || [];
  const players = teamIds.map(pid => AppState.players.find(p => p.id === pid)).filter(Boolean);
  return {
    total:       players.length,
    batsmen:     players.filter(p => p.role === "Batsman").length,
    bowlers:     players.filter(p => p.role === "Bowler").length,
    allRounders: players.filter(p => p.role === "All-rounder").length,
    wks:         players.filter(p => p.role === "WK").length,
    overseas:    players.filter(p => p.isOverseas).length,
    spent:       IPL_RULES.STARTING_BUDGET - member.budget
  };
}

function getSquadWarnings(member) {
  const s = getSquadSummary(member);
  const w = [];
  if (s.total >= IPL_RULES.MAX_SQUAD)       w.push("Squad full");
  if (s.overseas >= IPL_RULES.MAX_OVERSEAS)  w.push("Overseas full");
  return w;
}
