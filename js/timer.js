// ============================================================
// timer.js — Phase 5: DEFINITIVE timer fix
// ============================================================
//
// ROOT CAUSE (why timer stayed at 15 even in v4):
//
// When Firestore writes a FieldValue.serverTimestamp(), the SDK
// first fires a LOCAL snapshot with timerResetAt = null (the
// "pending write" snapshot). The timer key for that snapshot is:
//   "p001|0|0|false"  ← resetSec = 0 because timestamp is null
//
// Then the server snapshot arrives with the real timestamp, e.g.:
//   timerResetAt.seconds = 1718000000
//   timerKey = "p001|1718000000|1|false"
//
// BUT — the dedup check `uniqueKey === TimerState.lastKey` blocks
// the restart because _lastTimerKey was already set by the pending
// snapshot above. So the timer never restarted.
//
// THE FIX:
//   1. Ignore any snapshot where timerResetAt is null/0 (pending write).
//      Wait for the real server timestamp before starting the timer.
//   2. Use performance.now()-based elapsed tracking instead of relying
//      solely on server seconds — more accurate for fast bids.
//   3. Force-restart the timer whenever timerResetAt.seconds changes,
//      regardless of other key components.
// ============================================================

const TimerState = {
  interval:       null,
  seconds:        0,
  totalDuration:  15,
  lastKey:        null,
  lastResetSec:   -1,    // -1 = nothing started yet
  startedAtPerf:  0,     // performance.now() when timer started
  startedWithSec: 0      // timer seconds when started
};

/**
 * Main entry point — called from handleAuctionState() every snapshot.
 */
function startSyncedTimer(timerResetAt, timerDuration, uniqueKey, isPaused, onExpire) {

  // ── PAUSE ──
  if (isPaused) {
    clearInterval(TimerState.interval);
    TimerState.interval = null;
    updateTimerDisplay(TimerState.seconds, TimerState.totalDuration);
    return;
  }

  const resetSec = timerResetAt?.seconds || 0;

  // ── KEY INSIGHT: Skip null/pending timestamps ──
  // If resetSec is 0, Firestore hasn't delivered the real server
  // timestamp yet (still in the pending-write phase). We bail out
  // and wait for the next snapshot which will have the real time.
  if (resetSec === 0) {
    // Still show the full timer display so the UI doesn't look broken
    updateTimerDisplay(timerDuration || AUCTION_TIMER, timerDuration || AUCTION_TIMER);
    return;
  }

  // ── DEDUP: Only restart if resetSec actually changed ──
  // We use resetSec (not uniqueKey) as the primary guard because
  // uniqueKey includes bidCount which can differ between the pending
  // and confirmed snapshots even when representing the same bid.
  if (resetSec === TimerState.lastResetSec) {
    // Same timer window — the setInterval is already running correctly
    return;
  }

  // ── NEW TIMER WINDOW ──
  clearInterval(TimerState.interval);
  TimerState.interval     = null;
  TimerState.lastKey      = uniqueKey;
  TimerState.lastResetSec = resetSec;
  TimerState.totalDuration = timerDuration || AUCTION_TIMER;

  // Calculate elapsed time: how many seconds have passed on THIS
  // device since the server wrote the timestamp. We use the local
  // clock as an approximation (±1-2 second accuracy is fine).
  const localNowSec = Math.floor(Date.now() / 1000);
  const elapsed     = Math.max(0, localNowSec - resetSec);
  const remaining   = Math.max(0, TimerState.totalDuration - elapsed);

  // If we've completely missed the window (e.g., device was asleep),
  // expire immediately without showing a flickering timer.
  if (remaining === 0) {
    TimerState.seconds = 0;
    updateTimerDisplay(0, TimerState.totalDuration);
    if (typeof onExpire === "function") onExpire();
    return;
  }

  TimerState.seconds       = remaining;
  TimerState.startedAtPerf = performance.now();
  TimerState.startedWithSec = remaining;

  updateTimerDisplay(remaining, TimerState.totalDuration);

  // ── SETINTERVAL COUNTDOWN ──
  // Use performance.now() to compute elapsed rather than trusting
  // that setInterval fires exactly every 1000ms (it doesn't on
  // throttled/background tabs). This prevents drift.
  TimerState.interval = setInterval(() => {
    const perfElapsed = (performance.now() - TimerState.startedAtPerf) / 1000;
    const current     = Math.max(0, Math.round(TimerState.startedWithSec - perfElapsed));

    TimerState.seconds = current;
    updateTimerDisplay(current, TimerState.totalDuration);

    if (current <= 5 && current > 0) playTickSound();

    if (current <= 0) {
      clearInterval(TimerState.interval);
      TimerState.interval = null;
      if (typeof onExpire === "function") onExpire();
    }
  }, 250); // Poll 4× per second for smooth display without drift
}

function stopTimer() {
  clearInterval(TimerState.interval);
  TimerState.interval     = null;
  TimerState.lastKey      = null;
  TimerState.lastResetSec = -1;
}

// ─────────────────────────────────────────────
// Timer Display (SVG arc + number + label)
// ─────────────────────────────────────────────
function updateTimerDisplay(seconds, total) {
  const timerEl     = document.getElementById("auctionTimer");
  const timerCircle = document.getElementById("timerCircle");
  const timerLabel  = document.getElementById("timerLabel");
  if (!timerEl) return;

  timerEl.textContent = seconds;
  timerEl.className   = "timer-number";
  if (seconds <= 5)       timerEl.classList.add("timer-danger");
  else if (seconds <= 10) timerEl.classList.add("timer-warning");

  if (timerLabel) {
    if (seconds <= 5 && total === SMART_TIMER_BOOST) {
      timerLabel.textContent = "⚡ LAST CHANCE!";
      timerLabel.className   = "timer-label-urgent";
    } else {
      timerLabel.textContent = "Timer resets on each bid";
      timerLabel.className   = "";
    }
  }

  if (timerCircle) {
    const circumference = 2 * Math.PI * 45;
    const pct = total > 0 ? seconds / total : 0;
    timerCircle.style.strokeDasharray  = circumference;
    timerCircle.style.strokeDashoffset = circumference * (1 - pct);
    timerCircle.style.stroke = seconds <= 5 ? "#ef4444"
                              : seconds <= 10 ? "#f59e0b"
                              : "var(--green)";
  }
}

// ─────────────────────────────────────────────
// Web Audio Sound Engine
// ─────────────────────────────────────────────
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  return _audioCtx;
}

function playTone(freq, type, dur, peak) {
  if (!AppState.soundEnabled) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") ctx.resume();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(peak, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + dur);
  } catch(e) {}
}

function playBidSound()    { playTone(880, "sine", .15, .3); setTimeout(() => playTone(660, "sine", .15, .2), 80); }
function playTickSound()   { playTone(440, "square", .05, .08); }
function playSoldSound()   { playTone(1047, "sine", .4, .3); setTimeout(() => playTone(784, "sine", .4, .25), 150); setTimeout(() => playTone(523, "sine", .6, .3), 300); }
function playUnsoldSound() { playTone(220, "sawtooth", .3, .15); }
function playFinalSound()  { [1047, 880, 784, 659].forEach((f, i) => setTimeout(() => playTone(f, "sine", .5, .25), i * 120)); }
