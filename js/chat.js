// ============================================================
// chat.js — Phase 3: Real-time Chat
// ============================================================

const ChatState = {
  unsubscribe: null,
  lastSentAt:  0,
  COOLDOWN_MS: 1500
};

const QUICK_EMOJIS = ["🔥","💰","😤","🏏","👑","😂","🤑","💪","🎯","⚡"];

function initChat(roomId) {
  if (ChatState.unsubscribe) ChatState.unsubscribe();
  ChatState.unsubscribe = subscribeToChatMessages(roomId, renderChatMessages);

  document.getElementById("chatSendBtn")?.addEventListener("click", handleSendChat);
  document.getElementById("chatInput")?.addEventListener("keypress", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); }
  });

  const emojiRow = document.getElementById("emojiRow");
  if (emojiRow) {
    emojiRow.innerHTML = QUICK_EMOJIS.map(em =>
      `<button class="emoji-btn" onclick="sendQuickEmoji('${em}')">${em}</button>`
    ).join("");
  }
}

async function handleSendChat() {
  const input = document.getElementById("chatInput");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  if (Date.now() - ChatState.lastSentAt < ChatState.COOLDOWN_MS) { showToast("Slow down! ⏱️", "warning"); return; }
  if (text.length > 120) { showToast("Max 120 chars", "warning"); return; }
  ChatState.lastSentAt = Date.now();
  input.value = "";
  input.focus();
  try { await sendChatMessage(AppState.roomId, AppState.userId, AppState.userName, text); } catch(e) {}
}

async function sendQuickEmoji(emoji) {
  if (Date.now() - ChatState.lastSentAt < 800) return;
  ChatState.lastSentAt = Date.now();
  try { await sendChatMessage(AppState.roomId, AppState.userId, AppState.userName, emoji); } catch(e) {}
}

function renderChatMessages(messages) {
  const feed = document.getElementById("chatFeed");
  if (!feed) return;
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
  feed.innerHTML = messages.map(msg => {
    const isMe     = msg.userId === AppState.userId;
    const isSys    = msg.isSystem;
    const isEmoji  = /^(\p{Emoji})+$/u.test(msg.text) && msg.text.length <= 8;
    const time     = msg.ts?.seconds ? new Date(msg.ts.seconds*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : "";
    if (isSys) return `<div class="chat-msg-sys">${escapeHtml(msg.text)}</div>`;
    return `
      <div class="chat-msg ${isMe?"chat-msg-me":"chat-msg-other"} ${isEmoji?"chat-msg-emoji":""}">
        ${!isMe ? `<div class="chat-sender">${escapeHtml(msg.userName)}</div>` : ""}
        <div class="chat-bubble">${escapeHtml(msg.text)}</div>
        <div class="chat-time">${time}</div>
      </div>`;
  }).join("");
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}
