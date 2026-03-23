/* ============================================================
   webrtc.js — Multi-Peer WebRTC Mesh
   DropBeam Phase 3

   Full-mesh: every peer connects directly to every other peer.
   Max recommended: 6 peers (15 connections).

   Each pair has:
   - One RTCPeerConnection
   - One DataChannel (ordered, reliable)
   - One PeerEncryption instance
============================================================ */

import {
  putSignal, listenSignals,
  pushIce, listenIce
} from "./firebase2.js";
import { PeerEncryption } from "./encryption.js";
import {
  FileSender, FileReceiver,
  decodeFrame, MT,
  pickChunkSize
} from "./chunkManager.js";
import { saveHistory, savePartial, deletePartial } from "./storage.js";

const STUN_TURN = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls:       "turn:openrelay.metered.ca:80",
      username:   "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls:       "turn:openrelay.metered.ca:443",
      username:   "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls:       "turn:openrelay.metered.ca:443",
      username:   "openrelayproject",
      credential: "openrelayproject",
      transport:  "tcp",
    },
  ],
};

// ============================================================
//   PeerLink — single RTCPeerConnection + DataChannel
// ============================================================
class PeerLink {
  constructor(localId, remoteId, roomId, isCaller, enc, handlers) {
    this.localId   = localId;
    this.remoteId  = remoteId;
    this.roomId    = roomId;
    this.isCaller  = isCaller;
    this.enc       = enc;
    this.handlers  = handlers;
    this.pc        = null;
    this.dc        = null;
    this.state     = "new";
  }

  async init() {
    const pc = new RTCPeerConnection(STUN_TURN);
    this.pc  = pc;

    pc.onicecandidate = async e => {
      if (e.candidate) {
        await pushIce(this.roomId, this.localId, this.remoteId, e.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      this.state = pc.connectionState;
      this.handlers.onState(this.remoteId, pc.connectionState);
    };

    pc.ondatachannel = e => this._setupDC(e.channel);

    if (this.isCaller) {
      const dc = pc.createDataChannel("beam", { ordered: true });
      dc.bufferedAmountLowThreshold = 512 * 1024; // 512 KB low watermark
      this._setupDC(dc);
      this.dc = dc;
    }
  }

  _setupDC(dc) {
    dc.binaryType = "arraybuffer";
    this.dc       = dc;
    dc.onopen    = () => {
      this.state = "open";
      this.handlers.onOpen(this.remoteId);
      this._sendKey();
    };
    dc.onclose   = () => this.handlers.onClose(this.remoteId);
    dc.onerror   = e => this.handlers.onError(this.remoteId, e.message || "channel error");
    dc.onmessage = e => this.handlers.onMessage(this.remoteId, e.data);
    // Flow control
    dc.onbufferedamountlow = () => this.handlers.onBufferLow?.(this.remoteId);
  }

  async _sendKey() {
    const pub = await this.enc.exportPublicKey();
    this.sendJSON({ type: MT.PUBKEY, pub, name: this.handlers.myName });
  }

  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await putSignal(this.roomId, this.localId, this.remoteId, {
      type: "offer", sdp: offer.sdp
    });
  }

  async handleOffer(sdp) {
    // Guard: only accept offer in a valid state
    if (this.pc.signalingState !== "stable" && this.pc.signalingState !== "have-remote-offer") {
      throw new Error(`Cannot handle offer in state: ${this.pc.signalingState}`);
    }
    await this.pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await putSignal(this.roomId, this.localId, this.remoteId, {
      type: "answer", sdp: answer.sdp
    });
  }

  async handleAnswer(sdp) {
    // Only set if we are in the right state (have-local-offer)
    if (this.pc.signalingState === "have-local-offer") {
      await this.pc.setRemoteDescription({ type: "answer", sdp });
    }
  }

  async addIce(cand) {
    try {
      if (this.pc?.remoteDescription) {
        await this.pc.addIceCandidate(new RTCIceCandidate(cand));
      }
    } catch (_) {}
  }

  sendJSON(obj) {
    if (this.dc?.readyState === "open") {
      this.dc.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  async sendBinary(buf) {
    if (!this.dc || this.dc.readyState !== "open") return;
    // Back-pressure: wait until buffer drains below 4 MB
    if (this.dc.bufferedAmount > 4 * 1024 * 1024) {
      await new Promise(r => {
        const prev = this.dc.onbufferedamountlow;
        this.dc.onbufferedamountlow = () => {
          if (prev) prev();
          this.dc.onbufferedamountlow = prev;
          r();
        };
      });
    }
    this.dc.send(buf);
  }

  destroy() {
    try { this.dc?.close(); } catch (_) {}
    try { this.pc?.close(); } catch (_) {}
  }
}

// ============================================================
//   MeshRoom — manages all peer links for a room
// ============================================================
export class MeshRoom {
  constructor(roomId, myId, myName, isHost, cbs = {}) {
    this.roomId  = roomId;
    this.myId    = myId;
    this.myName  = myName;
    this.isHost  = isHost;

    this.cbs = {
      onPeerJoined:        () => {},
      onPeerLeft:          () => {},
      onPeerState:         () => {},
      onEncReady:          () => {},
      onFileIncoming:      () => {},
      onFileProgress:      () => {},
      onFileComplete:      () => {},
      onFileSendProgress:  () => {},
      onFileSendComplete:  () => {},
      onFileSendError:     () => {},
      onChat:              () => {},
      onClipboard:         () => {},
      onError:             () => {},
      ...cbs,
    };

    // Maps
    this.links      = new Map(); // peerId → PeerLink
    this.peerNames  = new Map(); // peerId → name
    this.encs       = new Map(); // peerId → PeerEncryption
    this.receivers  = new Map(); // transferId → FileReceiver
    this.senders    = new Map(); // transferId → { sender, toPeer }

    this._unsubSig = null;
    this._unsubIce = null;
  }

  /** Begin listening for incoming signals and ICE */
  startListening() {
    this._unsubSig = listenSignals(this.roomId, this.myId, sig => this._onSignal(sig));
    this._unsubIce = listenIce(this.roomId, this.myId, cand => this._onIce(cand));
  }

  /** Initiate connection to a known remote peer (caller side) */
  async connectTo(remoteId, remoteName) {
    // Prevent duplicate connections
    if (this.links.has(remoteId)) return;
    // Prevent re-entry while already connecting to same peer
    if (this._connecting?.has(remoteId)) return;
    if (!this._connecting) this._connecting = new Set();
    this._connecting.add(remoteId);

    try {
      const enc = new PeerEncryption();
      await enc.init();
      this.encs.set(remoteId, enc);
      this.peerNames.set(remoteId, remoteName || remoteId.slice(0, 6));

      const link = new PeerLink(
        this.myId, remoteId, this.roomId,
        true, enc,
        this._handlers(remoteId)
      );
      this.links.set(remoteId, link);
      await link.init();
      await link.createOffer();
    } finally {
      this._connecting.delete(remoteId);
    }
  }

  // ---- Signaling handlers ----

  async _onSignal(sig) {
    const rid = sig.from;

    if (sig.type === "offer") {
      // RACE CONDITION GUARD:
      // If we also sent an offer to this peer (both sides called connectTo),
      // exactly one side must win. Rule: peer with SMALLER myId wins as caller.
      if (this.links.has(rid)) {
        const existing = this.links.get(rid);
        if (existing.isCaller) {
          if (this.myId < rid) {
            // Our offer wins — ignore incoming offer, wait for their answer
            return;
          } else {
            // Their offer wins — rollback our offer, become callee
            try {
              await existing.pc.setLocalDescription({ type: "rollback" });
            } catch (_) {}
            existing.destroy();
            this.links.delete(rid);
            // Fall through to handle their offer as callee
          }
        } else {
          // We are already callee for this peer — ignore duplicate offer
          return;
        }
      }

      // Skip if already in _connecting (still setting up our own offer)
      // and we are the winner (smaller ID) — their offer will be ignored above
      if (this._connecting?.has(rid) && this.myId < rid) return;

      const enc = new PeerEncryption();
      await enc.init();
      this.encs.set(rid, enc);
      this.peerNames.set(rid, this.peerNames.get(rid) || rid.slice(0, 6));

      const link = new PeerLink(
        this.myId, rid, this.roomId,
        false, enc,
        this._handlers(rid)
      );
      this.links.set(rid, link);
      await link.init();

      try {
        await link.handleOffer(sig.sdp);
      } catch (e) {
        console.error("[WebRTC] handleOffer failed:", e.message);
        this.links.delete(rid);
      }

    } else if (sig.type === "answer") {
      const link = this.links.get(rid);
      if (link && link.isCaller) {
        try {
          await link.handleAnswer(sig.sdp);
        } catch (e) {
          console.error("[WebRTC] handleAnswer failed:", e.message);
        }
      }
    }
  }

  async _onIce(cand) {
    await this.links.get(cand.from)?.addIce(cand);
  }

  // ---- Per-link event handlers ----

  _handlers(remoteId) {
    const mesh = this;
    return {
      myName: mesh.myName,
      onState(id, state) {
        mesh.cbs.onPeerState(id, state);
        if (["disconnected","failed","closed"].includes(state)) {
          mesh.links.delete(id);
          mesh.encs.delete(id);
          mesh.cbs.onPeerLeft(id, mesh.peerNames.get(id));
        }
      },
      onOpen(id) {
        mesh.cbs.onPeerJoined(id, mesh.peerNames.get(id));
      },
      onClose(id) {},
      onError(id, msg) { mesh.cbs.onError(id, msg); },
      onMessage(id, data) { mesh._onMessage(id, data); },
    };
  }

  // ---- Incoming DataChannel message ----

  async _onMessage(fromId, data) {
    // Binary = file chunk
    if (data instanceof ArrayBuffer) {
      await this._onChunk(fromId, data);
      return;
    }

    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {

      case MT.PUBKEY: {
        // Peer's public key arrived — derive shared secret
        if (msg.name) this.peerNames.set(fromId, msg.name);
        const enc = this.encs.get(fromId);
        if (enc) {
          await enc.deriveSharedKey(msg.pub);
          this.cbs.onEncReady(fromId);
        }
        break;
      }

      case MT.FILE_META: {
        const enc  = this.encs.get(fromId) || new PeerEncryption();
        const recv = new FileReceiver(msg, enc);
        this.receivers.set(msg.transferId, recv);
        this.cbs.onFileIncoming(fromId, this.peerNames.get(fromId), msg);
        break;
      }

      case MT.ACCEPT: {
        const entry = this.senders.get(msg.transferId);
        if (entry) this._startSending(entry.sender, entry.toPeer, msg.fromChunk || 0);
        break;
      }

      case MT.REJECT: {
        const entry = this.senders.get(msg.transferId);
        if (entry) {
          entry.sender.cancel();
          this.senders.delete(msg.transferId);
          this.cbs.onFileSendError(msg.transferId, "Declined by recipient");
        }
        break;
      }

      case MT.RESUME_REQ: {
        const entry = this.senders.get(msg.transferId);
        if (entry) this._startSending(entry.sender, entry.toPeer, msg.fromChunk);
        break;
      }

      case MT.COMPLETE: {
        this.senders.delete(msg.transferId);
        this.cbs.onFileSendComplete(msg.transferId);
        break;
      }

      case MT.CANCEL: {
        this.receivers.delete(msg.transferId);
        break;
      }

      case MT.CHAT:      this.cbs.onChat(fromId, this.peerNames.get(fromId), msg);      break;
      case MT.CLIPBOARD: this.cbs.onClipboard(fromId, this.peerNames.get(fromId), msg); break;
      case MT.PING:      this.links.get(fromId)?.sendJSON({ type: MT.PONG });           break;
    }
  }

  // ---- Binary chunk received ----

  async _onChunk(fromId, buffer) {
    const { transferId, chunkIndex, payload } = decodeFrame(buffer);
    const recv = this.receivers.get(transferId);
    if (!recv) return;

    await recv.receiveChunk(chunkIndex, payload);
    const { pct, speed } = recv.progress();
    this.cbs.onFileProgress(transferId, pct, speed);

    // Periodic partial save (every 30 chunks)
    if (chunkIndex % 30 === 0) {
      await savePartial({
        transferId,
        fileId:       transferId,
        fileName:     recv.meta.fileName,
        fileSize:     recv.meta.fileSize,
        mimeType:     recv.meta.mimeType,
        totalChunks:  recv.meta.totalChunks,
        chunkSize:    recv.meta.chunkSize,
        receivedIdxs: [...recv.received],
      }).catch(() => {});
    }

    // Check completion
    if (recv.isComplete) {
      const blob = recv.assemble();
      await deletePartial(transferId).catch(() => {});
      await saveHistory({
        id:        transferId,
        direction: "received",
        fileName:  recv.meta.fileName,
        fileSize:  recv.meta.fileSize,
        mimeType:  recv.meta.mimeType,
        peerName:  this.peerNames.get(fromId),
        roomId:    this.roomId,
        blob,
        encrypted: recv.enc.ready,
      });
      this.receivers.delete(transferId);
      this.cbs.onFileComplete(transferId, blob, recv.meta, fromId);
      // Ack
      this.links.get(fromId)?.sendJSON({ type: MT.COMPLETE, transferId });
    }
  }

  // ---- Sending ----

  async _startSending(sender, toPeer, startChunk = 0) {
    const link = this.links.get(toPeer);
    if (!link) return;

    try {
      await sender.sendChunks(
        buf => link.sendBinary(buf),
        (pct, speed, bytes) => this.cbs.onFileSendProgress(sender.transferId, pct, speed, bytes),
        startChunk
      );
      await saveHistory({
        id:        sender.transferId,
        direction: "sent",
        fileName:  sender.file.name,
        fileSize:  sender.file.size,
        mimeType:  sender.file.type,
        peerName:  this.peerNames.get(toPeer),
        roomId:    this.roomId,
        encrypted: sender.enc.ready,
      });
    } catch (e) {
      this.cbs.onFileSendError(sender.transferId, e.message);
    }
  }

  // ============================================================
  //   PUBLIC API
  // ============================================================

  /** Announce file to peer, returns transferId */
  async offerFile(file, toPeerId) {
    const enc    = this.encs.get(toPeerId) || new PeerEncryption();
    const cs     = pickChunkSize(file.size);
    const sender = new FileSender(file, enc, cs);
    this.senders.set(sender.transferId, { sender, toPeer: toPeerId });
    this.links.get(toPeerId)?.sendJSON(sender.metaMsg(toPeerId));
    return sender.transferId;
  }

  /** Broadcast file to multiple peers */
  async broadcastFile(file, peerIds) {
    const ids  = peerIds.length > 0 ? peerIds : this.connectedPeerIds();
    const tids = [];
    for (const pid of ids) {
      tids.push(await this.offerFile(file, pid));
    }
    return tids;
  }

  acceptFile(transferId, fromId) {
    this.links.get(fromId)?.sendJSON({ type: MT.ACCEPT, transferId, fromChunk: 0 });
  }

  rejectFile(transferId, fromId) {
    this.receivers.delete(transferId);
    this.links.get(fromId)?.sendJSON({ type: MT.REJECT, transferId });
  }

  pauseSend(tid)  { this.senders.get(tid)?.sender.pause(); }
  resumeSend(tid) { this.senders.get(tid)?.sender.resume(); }
  cancelSend(tid) {
    const e = this.senders.get(tid);
    if (e) { e.sender.cancel(); this.senders.delete(tid); }
  }

  sendChat(text) {
    const msg = JSON.stringify({ type: MT.CHAT, text, sender: this.myName, senderId: this.myId, ts: Date.now() });
    this.links.forEach(l => l.dc?.readyState === "open" && l.dc.send(msg));
  }

  sendClipboard(content, ctype = "text") {
    const msg = JSON.stringify({ type: MT.CLIPBOARD, content, ctype, sender: this.myName, senderId: this.myId, ts: Date.now() });
    this.links.forEach(l => l.dc?.readyState === "open" && l.dc.send(msg));
  }

  connectedPeerIds() {
    return [...this.links.entries()]
      .filter(([, l]) => l.dc?.readyState === "open")
      .map(([id]) => id);
  }

  connectedPeers() {
    return this.connectedPeerIds().map(id => ({ id, name: this.peerNames.get(id) || id.slice(0,6) }));
  }

  async destroy() {
    if (this._unsubSig) this._unsubSig();
    if (this._unsubIce) this._unsubIce();
    this.senders.forEach(e => e.sender.cancel());
    this.links.forEach(l => l.destroy());
    this.links.clear();
  }
}
