const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");

const FEATURES = new Set(["bingo", "kill-bet", "scoreboard"]);
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_FILE = process.env.ROOM_DATA_FILE || path.join(__dirname, "data", "collaboration-rooms.json");

function defaultState(feature) {
  if (feature === "bingo") return { size: 4, title: "빙고", cells: Array(25).fill(""), checked: Array(25).fill(false) };
  if (feature === "kill-bet") return { chickenKillValue: 1, panels: {} };
  return {
    title: "매치 카멜레온", players: 7, games: 9, names: Array(7).fill(""),
    scores: Array.from({ length: 7 }, () => Array(9).fill("")),
    comments: Array.from({ length: 7 }, () => Array(9).fill("")), assignedNumbers: null
  };
}

function text(value, limit) { return String(value ?? "").slice(0, limit); }
function number(value, min, max, fallback = min) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function normalizeState(feature, raw = {}) {
  if (feature === "bingo") {
    const size = Number(raw.size) === 5 ? 5 : 4;
    return {
      size, title: text(raw.title || "빙고", 28),
      cells: Array.from({ length: 25 }, (_, index) => text(raw.cells?.[index], 34)),
      checked: Array.from({ length: 25 }, (_, index) => Boolean(raw.checked?.[index]))
    };
  }
  if (feature === "kill-bet") {
    const allowedPanels = new Set(["4명-0", "4:4-0", "4:4-1", "4:4:4-0", "4:4:4-1", "4:4:4-2", "4:4:4:4-0", "4:4:4:4-1", "4:4:4:4-2", "4:4:4:4-3"]);
    const panels = {};
    for (const [panelId, panel] of Object.entries(raw.panels || {})) {
      if (!allowedPanels.has(panelId)) continue;
      panels[panelId] = {
        team: text(panel?.team, 24), chicken: number(panel?.chicken, 0, 999, 0),
        rows: Array.from({ length: 4 }, (_, index) => ({
          name: text(panel?.rows?.[index]?.name, 24),
          score: number(panel?.rows?.[index]?.score, -9999, 9999, 0),
          fail: number(panel?.rows?.[index]?.fail, -9999, 0, 0)
        }))
      };
    }
    return { chickenKillValue: number(raw.chickenKillValue, 0, 999, 1), panels };
  }
  const players = number(raw.players, 1, 30, 7);
  const games = number(raw.games, 1, 20, 9);
  const assigned = Array.isArray(raw.assignedNumbers) && raw.assignedNumbers.length === players
    ? raw.assignedNumbers.map((value) => number(value, 1, players, 1)) : null;
  return {
    title: text(raw.title || "매치 카멜레온", 40), players, games,
    names: Array.from({ length: players }, (_, row) => text(raw.names?.[row], 40)),
    scores: Array.from({ length: players }, (_, row) => Array.from({ length: games }, (_, col) => text(raw.scores?.[row]?.[col], 12))),
    comments: Array.from({ length: players }, (_, row) => Array.from({ length: games }, (_, col) => text(raw.comments?.[row]?.[col], 80))),
    assignedNumbers: assigned
  };
}

function validFeature(feature) { return FEATURES.has(feature); }
function validCode(code) { return /^[A-HJ-NP-Z2-9]{4,8}$/.test(String(code || "").toUpperCase()); }
function roomKey(feature, code) { return `${feature}:${code}`; }

class RoomStore {
  constructor() {
    this.pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined }) : null;
    this.fileData = {};
    this.fileWrite = Promise.resolve();
  }
  async init() {
    if (this.pool) {
      await this.pool.query(`CREATE TABLE IF NOT EXISTS collaboration_rooms (
        feature TEXT NOT NULL, code TEXT NOT NULL, state JSONB NOT NULL, version BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (feature, code)
      )`);
      console.log("Collaborative rooms: PostgreSQL persistence enabled");
      return;
    }
    try { this.fileData = JSON.parse(await fs.promises.readFile(ROOM_FILE, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") console.warn("Could not read room file:", error.message); }
    console.log("Collaborative rooms: local JSON persistence at " + ROOM_FILE);
  }
  async load(feature, code) {
    if (this.pool) {
      const result = await this.pool.query("SELECT state, version, updated_at FROM collaboration_rooms WHERE feature=$1 AND code=$2", [feature, code]);
      if (!result.rows[0]) return null;
      return { state: normalizeState(feature, result.rows[0].state), version: Number(result.rows[0].version), updatedAt: result.rows[0].updated_at };
    }
    const saved = this.fileData[roomKey(feature, code)];
    return saved ? { ...saved, state: normalizeState(feature, saved.state) } : null;
  }
  async save(feature, code, room) {
    const updatedAt = new Date().toISOString();
    room.updatedAt = updatedAt;
    if (this.pool) {
      await this.pool.query(`INSERT INTO collaboration_rooms(feature, code, state, version, updated_at) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(feature, code) DO UPDATE SET state=EXCLUDED.state, version=EXCLUDED.version, updated_at=EXCLUDED.updated_at`,
      [feature, code, room.state, room.version, updatedAt]);
      return;
    }
    this.fileData[roomKey(feature, code)] = { state: room.state, version: room.version, updatedAt };
    this.fileWrite = this.fileWrite.then(async () => {
      await fs.promises.mkdir(path.dirname(ROOM_FILE), { recursive: true });
      const temp = ROOM_FILE + ".tmp";
      await fs.promises.writeFile(temp, JSON.stringify(this.fileData, null, 2));
      await fs.promises.rename(temp, ROOM_FILE);
    }).catch((error) => console.error("Room persistence failed:", error));
    await this.fileWrite;
  }
}

function setAtPath(target, pathValue, value, kind) {
  const parts = String(pathValue || "").split(".").filter(Boolean);
  if (!parts.length || parts.length > 5 || parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) throw new Error("잘못된 변경 경로입니다.");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = /^\d+$/.test(parts[index]) ? Number(parts[index]) : parts[index];
    if (cursor[key] == null || typeof cursor[key] !== "object") cursor[key] = /^\d+$/.test(parts[index + 1]) ? [] : {};
    cursor = cursor[key];
  }
  const finalKey = /^\d+$/.test(parts.at(-1)) ? Number(parts.at(-1)) : parts.at(-1);
  cursor[finalKey] = kind === "increment" ? Number(cursor[finalKey] || 0) + Number(value || 0) : value;
}

function setupCollaboration(io) {
  const store = new RoomStore();
  const rooms = new Map();
  const pendingSaves = new Map();

  async function getRoom(feature, code) {
    const key = roomKey(feature, code);
    if (rooms.has(key)) return rooms.get(key);
    const loaded = await store.load(feature, code);
    if (loaded) rooms.set(key, loaded);
    return loaded;
  }
  function scheduleSave(feature, code, room) {
    const key = roomKey(feature, code);
    clearTimeout(pendingSaves.get(key));
    pendingSaves.set(key, setTimeout(() => {
      pendingSaves.delete(key);
      store.save(feature, code, room).catch((error) => console.error("Room save failed:", error));
    }, 120));
  }
  function generateCode() {
    let code = "";
    do { code = Array.from({ length: 6 }, () => ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)]).join(""); }
    while ([...rooms.keys()].some((key) => key.endsWith(":" + code)));
    return code;
  }
  function presence(feature, code) {
    const sockets = io.sockets.adapter.rooms.get(roomKey(feature, code));
    io.to(roomKey(feature, code)).emit("room:presence", { count: sockets?.size || 0 });
  }

  io.on("connection", (socket) => {
    socket.on("room:create", async (payload = {}, reply = () => {}) => {
      try {
        const feature = String(payload.feature || "");
        if (!validFeature(feature)) throw new Error("지원하지 않는 기능입니다.");
        let code;
        do { code = generateCode(); } while (await getRoom(feature, code));
        const room = { state: normalizeState(feature, payload.state || defaultState(feature)), version: 1, updatedAt: new Date().toISOString() };
        rooms.set(roomKey(feature, code), room);
        await store.save(feature, code, room);
        await socket.join(roomKey(feature, code));
        socket.data.room = { feature, code };
        reply({ ok: true, code, state: room.state, version: room.version });
        presence(feature, code);
      } catch (error) { reply({ ok: false, error: error.message || "방을 만들지 못했습니다." }); }
    });

    socket.on("room:join", async (payload = {}, reply = () => {}) => {
      try {
        const feature = String(payload.feature || "");
        const code = String(payload.code || "").toUpperCase();
        if (!validFeature(feature) || !validCode(code)) throw new Error("방 코드를 확인해 주세요.");
        const room = await getRoom(feature, code);
        if (!room) throw new Error("존재하지 않는 방입니다.");
        if (socket.data.room) await socket.leave(roomKey(socket.data.room.feature, socket.data.room.code));
        await socket.join(roomKey(feature, code));
        socket.data.room = { feature, code };
        reply({ ok: true, code, state: room.state, version: room.version });
        presence(feature, code);
      } catch (error) { reply({ ok: false, error: error.message || "방에 참여하지 못했습니다." }); }
    });

    socket.on("room:patch", async (payload = {}, reply = () => {}) => {
      try {
        const feature = String(payload.feature || "");
        const code = String(payload.code || "").toUpperCase();
        if (socket.data.room?.feature !== feature || socket.data.room?.code !== code) throw new Error("먼저 방에 참여해 주세요.");
        const room = await getRoom(feature, code);
        const draft = structuredClone(room.state);
        setAtPath(draft, payload.path, payload.kind === "increment" ? payload.delta : payload.value, payload.kind);
        room.state = normalizeState(feature, draft);
        room.version += 1;
        room.updatedAt = new Date().toISOString();
        const event = { opId: text(payload.opId, 80), path: text(payload.path, 120), kind: payload.kind === "increment" ? "increment" : "set", value: payload.value, delta: payload.delta, state: room.state, version: room.version, clientId: text(payload.clientId, 80) };
        socket.to(roomKey(feature, code)).emit("room:patch", event);
        reply({ ok: true, version: room.version, state: room.state });
        scheduleSave(feature, code, room);
      } catch (error) { reply({ ok: false, error: error.message || "변경 사항을 저장하지 못했습니다." }); }
    });

    socket.on("room:reset", async (payload = {}, reply = () => {}) => {
      try {
        const feature = String(payload.feature || "");
        const code = String(payload.code || "").toUpperCase();
        if (socket.data.room?.feature !== feature || socket.data.room?.code !== code) throw new Error("먼저 방에 참여해 주세요.");
        const room = await getRoom(feature, code);
        room.state = defaultState(feature);
        room.version += 1;
        await store.save(feature, code, room);
        io.to(roomKey(feature, code)).emit("room:snapshot", { state: room.state, version: room.version, reset: true });
        reply({ ok: true });
      } catch (error) { reply({ ok: false, error: error.message || "방을 초기화하지 못했습니다." }); }
    });

    socket.on("disconnect", () => {
      const room = socket.data.room;
      if (room) setTimeout(() => presence(room.feature, room.code), 0);
    });
  });
  return store.init();
}

module.exports = { setupCollaboration, defaultState, normalizeState };
