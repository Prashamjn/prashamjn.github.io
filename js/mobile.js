// ============================================================
// mobile.js — Mobile Tab Navigation for Auction Room
// Controls which panel is visible on small screens
// ============================================================

const MobileNav = {
  activeTab: "center",  // center | left | right
  isAuctionActive: false,

  init() {
    // Insert the tab nav bar into the DOM
    this._buildTabNav();
    // Set default active tab
    this.switchTab("center");
    // Handle resize — switch back to multi-column mode on desktop
    window.addEventListener("resize", () => this._handleResize(), { passive: true });
    this._handleResize();
  },

  _buildTabNav() {
    // Only insert if not already present
    if (document.getElementById("mobileTabNav")) return;

    const nav = document.createElement("nav");
    nav.id = "mobileTabNav";
    nav.className = "mobile-tab-nav";
    nav.setAttribute("aria-label", "Section navigation");
    nav.innerHTML = `
      <button class="mob-tab-btn" data-tab="left" onclick="MobileNav.switchTab('left')" aria-label="Chat">
        <span class="mti">💬</span>
        <span>Chat</span>
      </button>
      <button class="mob-tab-btn mob-tab-bid mob-tab-active" data-tab="center" onclick="MobileNav.switchTab('center')" aria-label="Auction">
        <span class="mti">🔨</span>
        <span>Auction</span>
      </button>
      <button class="mob-tab-btn" data-tab="right" onclick="MobileNav.switchTab('right')" aria-label="Teams">
        <span class="mti">📊</span>
        <span>Teams</span>
      </button>
    `;
    document.body.appendChild(nav);
  },

  switchTab(tab) {
    this.activeTab = tab;

    // Only apply on mobile
    if (window.innerWidth >= 1024) return;

    const panels = {
      left:   document.querySelector(".panel-left"),
      center: document.querySelector(".panel-center"),
      right:  document.querySelector(".panel-right")
    };

    // Toggle panels
    Object.entries(panels).forEach(([key, el]) => {
      if (!el) return;
      if (key === tab) {
        el.classList.add("mob-active");
        el.style.display = "flex";
      } else {
        el.classList.remove("mob-active");
        el.style.display = "none";
      }
    });

    // Update tab button states
    document.querySelectorAll(".mob-tab-btn").forEach(btn => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle("mob-tab-active", isActive);
      if (btn.dataset.tab === "center") {
        btn.classList.toggle("mob-tab-bid", !isActive || tab === "center");
      }
    });

    // Auto-scroll chat to bottom when switching to it
    if (tab === "left") {
      setTimeout(() => {
        const feed = document.getElementById("chatFeed");
        if (feed) feed.scrollTop = feed.scrollHeight;
      }, 50);
    }

    // Focus bid button when switching to center
    if (tab === "center") {
      setTimeout(() => {
        const bidBtn = document.getElementById("placeBidBtn");
        if (bidBtn && !bidBtn.disabled) bidBtn.focus({ preventScroll: true });
      }, 100);
    }
  },

  /**
   * Show a badge on a tab to indicate new activity
   * e.g. new chat message while on auction tab
   */
  showTabBadge(tab, count) {
    const btn = document.querySelector(`.mob-tab-btn[data-tab="${tab}"]`);
    if (!btn) return;
    let badge = btn.querySelector(".mob-badge");
    if (count === 0) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "mob-badge";
      badge.style.cssText = `
        position:absolute;top:2px;right:8px;
        background:var(--red);color:#fff;
        font-size:.55rem;font-weight:900;
        padding:.1rem .3rem;border-radius:100px;
        min-width:14px;text-align:center;
        pointer-events:none;
      `;
      btn.style.position = "relative";
      btn.appendChild(badge);
    }
    badge.textContent = count > 9 ? "9+" : count;
  },

  clearTabBadge(tab) {
    this.showTabBadge(tab, 0);
  },

  /**
   * Show/hide the tab nav based on screen size and auction state
   */
  _handleResize() {
    const nav = document.getElementById("mobileTabNav");
    if (!nav) return;

    const isMobile = window.innerWidth < 1024;
    const inAuction = document.getElementById("auctionSection")?.style.display !== "none";

    nav.style.display = (isMobile && inAuction) ? "flex" : "none";

    if (!isMobile) {
      // Restore desktop panels
      const panels = document.querySelectorAll(".panel-left, .panel-center, .panel-right");
      panels.forEach(p => {
        p.classList.remove("mob-active");
        p.style.display = "";
      });
    } else if (inAuction) {
      // Re-apply active tab
      this.switchTab(this.activeTab);
    }
  },

  /**
   * Call this when auction starts / section changes
   */
  onAuctionStart() {
    this.isAuctionActive = true;
    this.switchTab("center");
    this._handleResize();
    // Show tab nav
    const nav = document.getElementById("mobileTabNav");
    if (nav && window.innerWidth < 1024) nav.style.display = "flex";
  },

  onAuctionEnd() {
    this.isAuctionActive = false;
    const nav = document.getElementById("mobileTabNav");
    if (nav) nav.style.display = "none";
  }
};

// ─── Chat badge counter ────────────────────────────────────────
let _chatUnread = 0;
const _origRenderChatMessages = window.renderChatMessages;

// Intercept chat renders to badge the tab when not on chat tab
document.addEventListener("DOMContentLoaded", () => {
  // Watch for new chat messages and badge the tab
  const chatFeed = document.getElementById("chatFeed");
  if (chatFeed) {
    const observer = new MutationObserver(() => {
      if (MobileNav.activeTab !== "left" && window.innerWidth < 1024) {
        _chatUnread++;
        MobileNav.showTabBadge("left", _chatUnread);
      }
    });
    observer.observe(chatFeed, { childList: true });
  }
});

// Clear badge when user opens chat
document.querySelector?.(".mob-tab-btn[data-tab='left']")?.addEventListener("click", () => {
  _chatUnread = 0;
  MobileNav.clearTabBadge("left");
});

// ─── Hook into app's section switch ───────────────────────────
// Patch showSection / hideSection to keep mobile nav in sync
const _origShowSection = window.showSection;
window.showSection = function(id) {
  if (_origShowSection) _origShowSection(id);
  if (id === "auctionSection") {
    setTimeout(() => MobileNav.onAuctionStart(), 50);
  } else if (id === "finishedSection" || id === "lobbySection") {
    MobileNav.onAuctionEnd();
  }
};
