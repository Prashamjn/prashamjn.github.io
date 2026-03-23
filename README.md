# DropBeam Phase 3 — Terminal Edition
## Secure P2P File Sharing · WebRTC · AES-256-GCM

```
Design: Terminal Brutalism · JetBrains Mono + Bebas Neue
Stack:  Vanilla JS · WebRTC Mesh · Firebase Firestore · IndexedDB · Service Worker
```

---

## 📁 Files

| File               | Purpose                                      |
|--------------------|----------------------------------------------|
| `dropbeam.html`       | Home — create/join rooms                     |
| `room2.html`        | Room — full transfer dashboard               |
| `dropbeam.css`        | Design system (dark + light terminal themes) |
| `mind.js`           | Home page logic                              |
| `room.js`          | Room orchestration                           |
| `webrtc.js`        | Multi-peer mesh WebRTC engine                |
| `firebase2.js`      | Firestore signaling wrapper                  |
| `encryption.js`    | ECDH + AES-256-GCM E2E encryption            |
| `chunkManager.js`  | File chunking, binary framing, assembly      |
| `storage.js`       | IndexedDB (history, resume, settings)        |
| `service-worker.js`| PWA offline caching                          |
| `manifest.json`    | PWA installable manifest                     |

---

## ⚙️ Firebase Setup (Required)

### 1. Create Project
1. Go to https://console.firebase.google.com
2. Click **Add project** → name it → Create
3. Skip Analytics

### 2. Enable Firestore
1. Build → **Firestore Database** → Create database
2. Choose **Start in test mode**
3. Pick nearest region → Enable

### 3. Get Config
1. Project Settings ⚙️ → **Your apps** → Web `</>`
2. Register app → copy `firebaseConfig`

### 4. Paste into firebase2.js
```javascript
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "your-app.firebaseapp.com",
  projectId:         "your-project-id",
  storageBucket:     "your-app.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc"
};
```

### 5. Firestore Rules (Dev)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

### 6. Firestore Rules (Production)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId} {
      allow create, read, update: if true;
      allow delete: if false;
    }
    match /rooms/{roomId}/{sub}/{doc} {
      allow read, write: if true;
    }
  }
}
```

---

## 🚀 Run Locally

**Must use HTTP server** (ES modules require it):

```bash
# npx (easiest)
cd dropbeam4
npx serve .
# → http://localhost:3000

# Python
python3 -m http.server 8080
# → http://localhost:8080
```

Open in **two separate browser windows** to test P2P.

---

## 🔗 Test Flow

1. **Window 1 (Host):** Click "INITIALIZE ROOM" → opens room2.html
2. **Window 2 (Guest):** Enter the 6-char code → click "CONNECT"
3. Watch Firebase negotiate the WebRTC connection (~2–5s)
4. Status shows "CONNECTED" — encryption handshake completes
5. Drop files on either side
6. Other side sees Accept/Reject modal
7. Accept → real-time encrypted transfer
8. Preview images/video, or download

---

## 🌐 Deploy to GitHub Pages

```bash
git init && git add .
git commit -m "DropBeam Phase 3"
git remote add origin https://github.com/YOU/dropbeam.git
git push -u origin main
```

In repo: **Settings → Pages → Source: main → Save**

Add `YOUR_USER.github.io` to Firebase authorized domains:
`Firebase Console → Authentication → Settings → Authorized domains`

---

## 🔐 Encryption Flow

```
1. Both peers generate ECDH P-256 key pairs on DataChannel open
2. Public keys exchanged in plaintext via DataChannel
3. Both independently compute AES-256-GCM shared key via ECDH
   (private keys never leave the device)

Per chunk:
4. random 12-byte IV generated
5. AES-GCM encrypt(chunk, sharedKey, IV) → ciphertext
6. Frame = [IV][ciphertext] prepended before binary framing

On receive:
7. Split IV from first 12 bytes
8. AES-GCM decrypt(ciphertext, sharedKey, IV)
9. Accumulate decrypted chunks → Blob
```

---

## 📦 Chunk + Resume Logic

```
Adaptive chunk sizing:
  < 5 MB  → 64 KB  (low memory)
  5-100 MB → 128 KB (balanced)
  > 100 MB → 256 KB (fast throughput)

Binary frame:
  [4B: tidLen][tid bytes][4B: chunkIndex][encrypted payload]

Resume:
  - Receiver saves received chunk indices to IndexedDB every 30 chunks
  - On reconnect, receiver sends RESUME_REQ with fromChunk index
  - Sender re-sends only from that index
```

---

## 🐛 Troubleshooting

| Problem | Fix |
|---------|-----|
| "Firebase error" | Check `firebaseConfig` in firebase2.js |
| Peers don't connect | Set Firestore to test mode |
| Stuck at "Connecting" | TURN server needed (different networks) |
| CORS errors | Use `http://localhost`, not `file://` |
| Transfer hangs | Try smaller files first |
| No camera for QR | Use paste link field instead |
