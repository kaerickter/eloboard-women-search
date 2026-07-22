(function () {
  "use strict";
  const CLIENT_KEY = "eloboard.collaboration.clientId";
  const ROOM_KEY_PREFIX = "eloboard.collaboration.room.";
  let clientId = sessionStorage.getItem(CLIENT_KEY);
  if (!clientId) {
    clientId = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)) + Date.now().toString(36);
    sessionStorage.setItem(CLIENT_KEY, clientId);
  }

  function roomFromUrl() { return new URL(location.href).searchParams.get("room")?.trim().toUpperCase() || ""; }
  function savedRoom(feature) {
    try { return localStorage.getItem(ROOM_KEY_PREFIX + feature)?.trim().toUpperCase() || ""; }
    catch { return ""; }
  }
  function rememberRoom(feature, code) {
    try {
      if (code) localStorage.setItem(ROOM_KEY_PREFIX + feature, code);
      else localStorage.removeItem(ROOM_KEY_PREFIX + feature);
    } catch {}
  }
  function setRoomInUrl(code) {
    const url = new URL(location.href);
    if (code) url.searchParams.set("room", code); else url.searchParams.delete("room");
    history.replaceState(null, "", url);
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }

  class RealtimeRoom {
    constructor(options) {
      this.feature = options.feature;
      this.getState = options.getState;
      this.applyState = options.applyState;
      this.code = "";
      this.version = 0;
      this.pending = new Map();
      this.socket = window.io ? window.io() : null;
      this.mount();
      this.bindSocket();
    }
    mount() {
      this.root = document.createElement("section");
      this.root.className = "collaboration-bar";
      this.root.setAttribute("aria-label", "실시간 공동 편집");
      this.root.innerHTML = `<strong>함께 편집</strong><input class="collaboration-input" maxlength="8" placeholder="방 코드" aria-label="방 코드"><button class="collaboration-action primary collaboration-create" type="button">새 방 만들기</button><button class="collaboration-action collaboration-join" type="button">참여</button><div class="collaboration-room" hidden><span class="collaboration-code"></span><span class="collaboration-presence">접속 1명</span><button class="collaboration-action collaboration-copy" type="button">링크 복사</button><button class="collaboration-action danger collaboration-reset" type="button">방 초기화</button></div><span class="collaboration-status"><i class="collaboration-dot"></i>연결 준비 중</span>`;
      const nav = document.querySelector("nav");
      (nav?.parentNode || document.body).insertBefore(this.root, nav ? nav.nextSibling : document.body.firstChild);
      this.input = this.root.querySelector(".collaboration-input");
      this.createButton = this.root.querySelector(".collaboration-create");
      this.joinButton = this.root.querySelector(".collaboration-join");
      this.roomPanel = this.root.querySelector(".collaboration-room");
      this.statusNode = this.root.querySelector(".collaboration-status");
      this.presenceNode = this.root.querySelector(".collaboration-presence");
      this.createButton.addEventListener("click", () => this.create());
      this.joinButton.addEventListener("click", () => this.join(this.input.value));
      this.input.addEventListener("keydown", event => { if (event.key === "Enter") this.join(this.input.value); });
      this.root.querySelector(".collaboration-copy").addEventListener("click", () => this.copyLink());
      this.root.querySelector(".collaboration-reset").addEventListener("click", () => this.reset());
    }
    bindSocket() {
      if (!this.socket) return this.setStatus("실시간 모듈을 불러오지 못했습니다.", false);
      this.socket.on("connect", () => {
        this.setStatus(this.code ? "실시간 연결됨" : "방을 만들거나 참여해 주세요.", true);
        const requested = this.code || roomFromUrl() || savedRoom(this.feature);
        if (requested) this.join(requested, true);
      });
      this.socket.on("disconnect", () => this.setStatus("연결이 끊겨 재접속 중…", false));
      this.socket.on("room:presence", payload => { this.presenceNode.textContent = `접속 ${Number(payload?.count || 1)}명`; });
      this.socket.on("room:patch", payload => {
        if (!payload?.state || payload.clientId === clientId) return;
        const incomingVersion = Number(payload.version || 0);
        if (incomingVersion <= this.version) return;
        this.version = incomingVersion;
        this.applyState(payload.state, { remote: true, path: payload.path });
        this.setStatus("다른 사용자의 변경을 반영했습니다.", true);
      });
      this.socket.on("room:snapshot", payload => {
        if (!payload?.state) return;
        const incomingVersion = Number(payload.version || 0);
        if (incomingVersion < this.version) return;
        this.version = incomingVersion;
        this.applyState(payload.state, { remote: true, reset: Boolean(payload.reset) });
        this.setStatus(payload.reset ? "방이 초기화되었습니다." : "최신 상태를 불러왔습니다.", true);
      });
    }
    setStatus(message, online) {
      this.statusNode.innerHTML = `<i class="collaboration-dot${online ? " online" : ""}"></i>${escapeHtml(message)}`;
    }
    setBusy(busy) { this.createButton.disabled = busy; this.joinButton.disabled = busy; }
    activate(result) {
      this.code = result.code;
      this.version = Number(result.version || 0);
      this.input.value = this.code;
      this.roomPanel.hidden = false;
      this.root.querySelector(".collaboration-code").textContent = `방 ${this.code}`;
      rememberRoom(this.feature, this.code);
      setRoomInUrl(this.code);
      this.applyState(result.state, { remote: true, joined: true });
      this.setStatus("실시간 연결됨", true);
    }
    create() {
      if (!this.socket?.connected) return this.setStatus("서버에 연결 중입니다. 잠시 후 다시 시도해 주세요.", false);
      this.setBusy(true);
      this.socket.emit("room:create", { feature: this.feature, state: this.getState() }, result => {
        this.setBusy(false);
        if (!result?.ok) return this.setStatus(result?.error || "방을 만들지 못했습니다.", false);
        this.activate(result);
      });
    }
    join(rawCode, quiet = false) {
      const code = String(rawCode || "").trim().toUpperCase();
      if (!/^[A-HJ-NP-Z2-9]{4,8}$/.test(code)) return this.setStatus("방 코드를 확인해 주세요.", false);
      if (!this.socket?.connected) return;
      this.input.value = code;
      this.setBusy(true);
      this.socket.emit("room:join", { feature: this.feature, code }, result => {
        this.setBusy(false);
        if (!result?.ok) {
          if (quiet && code === savedRoom(this.feature)) {
            rememberRoom(this.feature, "");
            if (roomFromUrl() === code) setRoomInUrl("");
          }
          this.setStatus(result?.error || "방에 참여하지 못했습니다.", false);
          return;
        }
        this.activate(result);
      });
    }
    sendSet(path, value, delay = 80) {
      if (!this.code) return;
      clearTimeout(this.pending.get(path));
      this.pending.set(path, setTimeout(() => {
        this.pending.delete(path);
        this.emitPatch({ path, value, kind: "set" });
      }, delay));
    }
    increment(path, delta) { if (this.code) this.emitPatch({ path, delta, kind: "increment" }); }
    emitPatch(change) {
      const opId = clientId + ":" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      this.socket.emit("room:patch", { ...change, feature: this.feature, code: this.code, clientId, opId, baseVersion: this.version }, result => {
        if (!result?.ok) return this.setStatus(result?.error || "변경 사항을 저장하지 못했습니다.", false);
        const incomingVersion = Number(result.version || this.version);
        if (incomingVersion >= this.version) {
          this.version = incomingVersion;
          if (change.kind === "increment" && result.state) this.applyState(result.state, { remote: false, acknowledged: true, path: change.path });
        }
        this.setStatus("모두에게 저장됨", true);
      });
    }
    async copyLink() {
      const url = new URL(location.href); url.searchParams.set("room", this.code);
      try { await navigator.clipboard.writeText(url.href); this.setStatus("공유 링크를 복사했습니다.", true); }
      catch { window.prompt("아래 링크를 복사해 주세요.", url.href); }
    }
    reset() {
      if (!this.code || !window.confirm("이 방의 모든 내용을 초기 상태로 되돌릴까요? 이 작업은 참여자 모두에게 적용됩니다.")) return;
      this.socket.emit("room:reset", { feature: this.feature, code: this.code }, result => {
        if (!result?.ok) this.setStatus(result?.error || "방을 초기화하지 못했습니다.", false);
      });
    }
  }

  RealtimeRoom.preserveFocus = function (render) {
    const active = document.activeElement;
    const path = active?.dataset?.collabPath;
    const start = active?.selectionStart;
    const end = active?.selectionEnd;
    render();
    if (!path) return;
    const next = document.querySelector(`[data-collab-path="${CSS.escape(path)}"]`);
    if (!next) return;
    next.focus({ preventScroll: true });
    if (typeof next.setSelectionRange === "function" && Number.isInteger(start)) next.setSelectionRange(start, end);
  };
  window.RealtimeRoom = RealtimeRoom;
})();
