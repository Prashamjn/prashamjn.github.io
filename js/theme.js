// ============================================================
// theme.js — Phase 3: 3-Theme System
// ============================================================

const THEMES = {
  ipl: {
    id: "ipl",
    name: "IPL Classic",
    icon: "🏟️",
    vars: {
      "--bg":       "#04060e",
      "--bg2":      "#070a15",
      "--glass":    "rgba(255,255,255,0.04)",
      "--glass2":   "rgba(255,255,255,0.07)",
      "--border":   "rgba(255,255,255,0.07)",
      "--border2":  "rgba(255,255,255,0.13)",
      "--green":    "#00d4aa",
      "--blue":     "#3b82f6",
      "--purple":   "#8b5cf6",
      "--gold":     "#f59e0b",
      "--red":      "#ef4444",
      "--orange":   "#f97316",
      "--text":     "#eef2ff",
      "--text2":    "rgba(238,242,255,0.55)",
      "--text3":    "rgba(238,242,255,0.28)",
      "--accent":   "#00d4aa",
      "--accent2":  "#f59e0b",
      "--grad-hero":"linear-gradient(135deg,#00d4aa 0%,#3b82f6 50%,#8b5cf6 100%)"
    }
  },
  neon: {
    id: "neon",
    name: "Neon Gen Z",
    icon: "⚡",
    vars: {
      "--bg":       "#0a0010",
      "--bg2":      "#120018",
      "--glass":    "rgba(255,0,255,0.04)",
      "--glass2":   "rgba(255,0,255,0.08)",
      "--border":   "rgba(255,0,255,0.12)",
      "--border2":  "rgba(255,0,255,0.22)",
      "--green":    "#ff00ff",
      "--blue":     "#00ffee",
      "--purple":   "#bf00ff",
      "--gold":     "#ffff00",
      "--red":      "#ff2d55",
      "--orange":   "#ff6b35",
      "--text":     "#fff0ff",
      "--text2":    "rgba(255,240,255,0.6)",
      "--text3":    "rgba(255,240,255,0.3)",
      "--accent":   "#ff00ff",
      "--accent2":  "#ffff00",
      "--grad-hero":"linear-gradient(135deg,#ff00ff 0%,#00ffee 50%,#bf00ff 100%)"
    }
  },
  glass: {
    id: "glass",
    name: "Glass Premium",
    icon: "💎",
    vars: {
      "--bg":       "#0c1020",
      "--bg2":      "#111828",
      "--glass":    "rgba(255,255,255,0.06)",
      "--glass2":   "rgba(255,255,255,0.1)",
      "--border":   "rgba(255,255,255,0.1)",
      "--border2":  "rgba(255,255,255,0.18)",
      "--green":    "#34d399",
      "--blue":     "#60a5fa",
      "--purple":   "#a78bfa",
      "--gold":     "#fbbf24",
      "--red":      "#f87171",
      "--orange":   "#fb923c",
      "--text":     "#f8fafc",
      "--text2":    "rgba(248,250,252,0.6)",
      "--text3":    "rgba(248,250,252,0.3)",
      "--accent":   "#60a5fa",
      "--accent2":  "#fbbf24",
      "--grad-hero":"linear-gradient(135deg,#60a5fa 0%,#a78bfa 50%,#34d399 100%)"
    }
  }
};

const ThemeManager = {
  current: "ipl",

  init() {
    const saved = localStorage.getItem("iplTheme") || "ipl";
    this.apply(saved);
    this._renderSwitcher();
  },

  apply(themeId) {
    const theme = THEMES[themeId] || THEMES.ipl;
    this.current = themeId;
    localStorage.setItem("iplTheme", themeId);

    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));

    // Body class for theme-specific overrides
    document.body.dataset.theme = themeId;

    // Update switcher active state
    document.querySelectorAll(".theme-btn").forEach(btn => {
      btn.classList.toggle("theme-btn-active", btn.dataset.theme === themeId);
    });
  },

  _renderSwitcher() {
    const container = document.getElementById("themeSwitcher");
    if (!container) return;
    container.innerHTML = Object.values(THEMES).map(t => `
      <button class="theme-btn ${this.current === t.id ? "theme-btn-active" : ""}"
        data-theme="${t.id}"
        onclick="ThemeManager.apply('${t.id}')"
        title="${t.name}">
        ${t.icon}
      </button>
    `).join("");
  }
};
