const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { Server: SocketIOServer } = require("socket.io");
const { setupCollaboration } = require("./collaboration-server");
const { normalizeBjListPlayerText } = require("./eloboard-utils");
const { TierAdmin } = require("./tier-admin");
const { SpawnDiaryAdmin } = require("./spawn-diary-admin");
const { PlayerAnalysisStore, analyzePlayer } = require("./player-analysis");
const {
  AUTO_PLAYER_NAME,
  compactName: autoDiaryPlayerKey,
  initializeSpawnDiaryAutoSyncSchema,
  syncSpawnDiaryFromProfile
} = require("./spawn-diary-auto-sync");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const BOARD_URL = "https://eloboard.com/women/bbs/board.php?bo_table=bj_board";
const BJ_LIST_URL = "https://eloboard.com/women/bbs/board.php?bo_table=bj_list";
const MEN_BJ_LIST_URL = "https://eloboard.com/men/bbs/board.php?bo_table=bj_list";
const WOMEN_RECORD_AJAX_URL = "https://eloboard.com/women/bbs/ajax_women_record.php";
const MATCHUP_LIST_URL = "https://eloboard.com/women/bbs/board.php?bo_table=search_list";
const MATCHUP_SEARCH_URL = "https://eloboard.com/women/bbs/search_bj_list.php";
const MEN_LIST_URL = "https://eloboard.com/men/bbs/board.php?bo_table=search_list";
const MEN_SEARCH_URL = "https://eloboard.com/men/bbs/search_bj_list.php";
const UNIVERSITY_LIST_URL = "https://eloboard.com/univ/bbs/board.php?bo_table=all_bj_list";
const SOOP_STATION_API = "https://chapi.sooplive.co.kr/api";
const SOOP_LIVE_SEARCH_API = "https://sch.sooplive.co.kr/api.php";
const SOOP_VOTE_API = "https://chapi.sooplive.co.kr/api/ititit/title/202619457/comment";
const SOOP_CHANNEL_FILE = path.join(ROOT, "data", "soop-channels.json");
const SOOP_ALIAS_FILE = path.join(ROOT, "data", "soop-aliases.json");
const MEN_BROADCAST_MAP_FILE = path.join(ROOT, "data", "men-player-broadcast-map.json");
const TIER_ROSTER_FILE = path.join(ROOT, "data", "tier-roster.json");
const MEN_TIER_FALLBACK_FILE = path.join(ROOT, "data", "men-tier-fallback.json");
const SCOREBOARD_STATE_FILE = path.join(ROOT, "data", "scoreboard-state.json");
const JUNGMAN_CUP_STATE_FILE = path.join(ROOT, "data", "jungman-cup-state.json");
const BUNDLED_YT_DLP = path.join(ROOT, "vendor", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const MAX_SCOREBOARD_STATE_SIZE = 200000;
const PINNED_SOOP_ALIASES = {
  "핑핑": {
    broadcastId: "nreupne",
    searchName: "핑핑♥",
    stationNames: ["핑핑♥"]
  },
  "핑핑♥": {
    broadcastId: "nreupne",
    searchName: "핑핑♥",
    stationNames: ["핑핑♥"]
  },
  "슈슈": {
    broadcastId: "ldk8481",
    searchName: "슈슈♥",
    stationNames: ["슈슈♥"]
  },
  "슈슈♥": {
    broadcastId: "ldk8481",
    searchName: "슈슈♥",
    stationNames: ["슈슈♥"]
  },
  "려원님": {
    broadcastId: "fudnjs0235",
    searchName: "려원♡",
    stationNames: ["려원♡", "려원기획사"]
  },
  "려워님": {
    broadcastId: "fudnjs0235",
    searchName: "려원♡",
    stationNames: ["려원♡", "려원기획사"]
  },
  "려원": {
    broadcastId: "fudnjs0235",
    searchName: "려원♡",
    stationNames: ["려원♡", "려원기획사"]
  },
  "임조이": {
    broadcastId: "dlaguswl501",
    searchName: "임조이1111",
    stationNames: ["임조이1111", "Imzoe"]
  },
  "임조이님": {
    broadcastId: "dlaguswl501",
    searchName: "임조이1111",
    stationNames: ["임조이1111", "Imzoe"]
  },
  "유이": {
    broadcastId: "chchchshai",
    searchName: "유이",
    stationNames: ["유이"]
  }
};
const PINNED_TIER_DISPLAY_NAMES = {};
const PORT = Number(process.env.PORT || 5177);
const CCTV_LOCAL_MODE = process.env.CCTV_LOCAL_MODE === "1";
const DATABASE_RETRY_MS = 15000;
const DEFAULT_PAGES = 10;
const MAX_PAGES = 40;
let cache = new Map();
let dataPromises = new Map();
let playerIndexCache = null;
let menPlayerIndexCache = null;
const menDirectSearchCache = new Map();
let playerIndexPromise = null;
let profileCache = new Map();
let profilePromises = new Map();
const profileSnapshotMemory = new Map();
let profileSnapshotSchemaPromise = null;
let universityCache = null;
let universityRosterCache = new Map();
let tierRosterCache = null;
let tierRosterPromise = null;
let channelCache = new Map();
let liveStatusCache = new Map();
let liveNameCache = new Map();
let liveStatusPromises = new Map();
let channelRegistry = {};
let channelAliases = {};
let menBroadcastMapRows = [];
let channelRegistrySaveTimer = null;
const CACHE_MS = 1000 * 60 * 3;
const PROFILE_SNAPSHOT_LIMIT = 120;
const PROFILE_SNAPSHOT_MATCH_LIMIT = 250;
const LIVE_CACHE_MS = 1000 * 15;
const CHANNEL_CACHE_MS = 1000 * 60 * 60 * 24;
const UPSTREAM_TIMEOUT_MS = 1000 * 20;
const CCTV_STREAM_CACHE_MS = 5 * 60 * 1000;
const CCTV_STALE_CACHE_MS = 30 * 60 * 1000;
const CCTV_PROXY_TOKEN_MS = 30 * 60 * 1000;
const CCTV_REMOTE_TIMEOUT_MS = 18 * 1000;
const CCTV_PLAYLIST_CACHE_MS = 1500;
const CCTV_SEGMENT_CACHE_MS = 90 * 1000;
const CCTV_REMOTE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const CCTV_REMOTE_CACHE_MAX_ENTRIES = 800;
const CCTV_ACTIVE_STREAM_MS = 30 * 1000;
const CCTV_VIEWER_SESSION_MS = 40 * 1000;
const tierAdmin = new TierAdmin();
const spawnDiaryAdmin = new SpawnDiaryAdmin();
const playerAnalysisStore = new PlayerAnalysisStore({ pool: tierAdmin.pool });
let playerAnalysisReady = false;
let playerAnalysisInitPromise = null;
let scoreboardStateTableReady = false;
let scoreboardStateTablePromise = null;

function sanitizeScoreboardText(value) {
  const normalized = String(value).normalize("NFC");
  const repaired = normalized.replace(/\uFFFD+/g, "");
  if (normalized.includes("\uFFFD") && repaired === "냥코기") return "냥냥코기";
  return repaired;
}

function sanitizeScoreboardState(value) {
  if (typeof value === "string") return sanitizeScoreboardText(value);
  if (Array.isArray(value)) return value.map(sanitizeScoreboardState);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeScoreboardState(item)])
    );
  }
  return value;
}

async function ensureScoreboardStateTable() {
  if (!tierAdmin.pool || scoreboardStateTableReady) return;
  if (!scoreboardStateTablePromise) {
    scoreboardStateTablePromise = tierAdmin.pool.query(`
      CREATE TABLE IF NOT EXISTS scoreboard_state (
        id TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        version BIGINT NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => {
      scoreboardStateTableReady = true;
    }).finally(() => {
      scoreboardStateTablePromise = null;
    });
  }
  await scoreboardStateTablePromise;
}

async function loadScoreboardState() {
  if (tierAdmin.pool) {
    await ensureScoreboardStateTable();
    const result = await tierAdmin.pool.query(
      "SELECT state, version, updated_at FROM scoreboard_state WHERE id = $1",
      ["main"]
    );
    if (!result.rows[0]) return { state: null, version: 0, updatedAt: null };
    return {
      state: sanitizeScoreboardState(result.rows[0].state),
      version: Number(result.rows[0].version),
      updatedAt: result.rows[0].updated_at
    };
  }
  try {
    const saved = JSON.parse(await fs.promises.readFile(SCOREBOARD_STATE_FILE, "utf8"));
    return {
      ...saved,
      state: sanitizeScoreboardState(saved.state)
    };
  } catch (error) {
    if (error.code === "ENOENT") return { state: null, version: 0, updatedAt: null };
    throw error;
  }
}

async function saveScoreboardState(state) {
  const sanitizedState = sanitizeScoreboardState(state);
  const stateJson = JSON.stringify(sanitizedState);
  if (stateJson.length > MAX_SCOREBOARD_STATE_SIZE) throw new Error("스코어보드 정보가 너무 큽니다.");

  if (tierAdmin.pool) {
    await ensureScoreboardStateTable();
    const result = await tierAdmin.pool.query(`
      INSERT INTO scoreboard_state (id, state, version, updated_at)
      VALUES ($1, $2::jsonb, 1, NOW())
      ON CONFLICT (id) DO UPDATE SET
        state = EXCLUDED.state,
        version = scoreboard_state.version + 1,
        updated_at = NOW()
      RETURNING version, updated_at
    `, ["main", stateJson]);
    return {
      version: Number(result.rows[0]?.version || 1),
      updatedAt: result.rows[0]?.updated_at || new Date().toISOString()
    };
  }

  const current = await loadScoreboardState();
  const saved = {
    state: sanitizedState,
    version: Number(current.version || 0) + 1,
    updatedAt: new Date().toISOString()
  };
  await fs.promises.mkdir(path.dirname(SCOREBOARD_STATE_FILE), { recursive: true });
  const tempFile = SCOREBOARD_STATE_FILE + ".tmp";
  await fs.promises.writeFile(tempFile, JSON.stringify(saved, null, 2));
  await fs.promises.rename(tempFile, SCOREBOARD_STATE_FILE);
  return { version: saved.version, updatedAt: saved.updatedAt };
}

function sanitizeJungmanCupState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const shortText = (input, limit = 100) => String(input || "").trim().slice(0, limit);
  const fixtures = {};
  for (const group of ["A", "B", "C", "D"]) {
    const rows = Array.isArray(source.fixtures?.[group]) ? source.fixtures[group] : [];
    fixtures[group] = Array.from({ length: 3 }, (_, index) => {
      const row = rows[index] && typeof rows[index] === "object" ? rows[index] : {};
      const date = shortText(row.date, 10);
      return {
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
        home: shortText(row.home),
        away: shortText(row.away)
      };
    });
  }

  const matches = {};
  const matchEntries = source.matches && typeof source.matches === "object" && !Array.isArray(source.matches)
    ? Object.entries(source.matches).slice(0, 100)
    : [];
  for (const [rawKey, rawMatch] of matchEntries) {
    if (!rawMatch || typeof rawMatch !== "object" || Array.isArray(rawMatch)) continue;
    const key = shortText(rawKey, 300);
    if (!key) continue;
    const games = (Array.isArray(rawMatch.games) ? rawMatch.games : []).slice(0, 20).map((rawGame) => {
      const game = rawGame && typeof rawGame === "object" ? rawGame : {};
      const winner = ["home", "away"].includes(game.winner) ? game.winner : "";
      return {
        homePlayer: shortText(game.homePlayer),
        awayPlayer: shortText(game.awayPlayer),
        mapName: shortText(game.mapName),
        winner
      };
    });
    while (games.length < 9) games.push({ homePlayer: "", awayPlayer: "", mapName: "", winner: "" });
    matches[key] = {
      group: ["A", "B", "C", "D"].includes(rawMatch.group) ? rawMatch.group : "",
      home: shortText(rawMatch.home),
      away: shortText(rawMatch.away),
      fixtureIndex: Math.max(0, Math.min(2, Number(rawMatch.fixtureIndex) || 0)),
      fixtureDate: /^\d{4}-\d{2}-\d{2}$/.test(shortText(rawMatch.fixtureDate, 10)) ? shortText(rawMatch.fixtureDate, 10) : "",
      games
    };
  }
  return { fixtures, matches };
}

async function loadJungmanCupState() {
  if (tierAdmin.pool) {
    await ensureScoreboardStateTable();
    const result = await tierAdmin.pool.query(
      "SELECT state, version, updated_at FROM scoreboard_state WHERE id = $1",
      ["jungman-cup"]
    );
    if (!result.rows[0]) return { state: null, version: 0, updatedAt: null };
    return {
      state: sanitizeJungmanCupState(result.rows[0].state),
      version: Number(result.rows[0].version),
      updatedAt: result.rows[0].updated_at
    };
  }
  try {
    const saved = JSON.parse(await fs.promises.readFile(JUNGMAN_CUP_STATE_FILE, "utf8"));
    return { ...saved, state: sanitizeJungmanCupState(saved.state) };
  } catch (error) {
    if (error.code === "ENOENT") return { state: null, version: 0, updatedAt: null };
    throw error;
  }
}

async function saveJungmanCupState(state) {
  const sanitizedState = sanitizeJungmanCupState(state);
  const stateJson = JSON.stringify(sanitizedState);
  if (stateJson.length > MAX_SCOREBOARD_STATE_SIZE) throw new Error("중만컵 정보가 너무 큽니다.");
  if (tierAdmin.pool) {
    await ensureScoreboardStateTable();
    const result = await tierAdmin.pool.query(`
      INSERT INTO scoreboard_state (id, state, version, updated_at)
      VALUES ($1, $2::jsonb, 1, NOW())
      ON CONFLICT (id) DO UPDATE SET
        state = EXCLUDED.state,
        version = scoreboard_state.version + 1,
        updated_at = NOW()
      RETURNING version, updated_at
    `, ["jungman-cup", stateJson]);
    return { version: Number(result.rows[0]?.version || 1), updatedAt: result.rows[0]?.updated_at || new Date().toISOString() };
  }
  const current = await loadJungmanCupState();
  const saved = { state: sanitizedState, version: Number(current.version || 0) + 1, updatedAt: new Date().toISOString() };
  await fs.promises.mkdir(path.dirname(JUNGMAN_CUP_STATE_FILE), { recursive: true });
  const tempFile = JUNGMAN_CUP_STATE_FILE + ".tmp";
  await fs.promises.writeFile(tempFile, JSON.stringify(saved, null, 2));
  await fs.promises.rename(tempFile, JUNGMAN_CUP_STATE_FILE);
  return { version: saved.version, updatedAt: saved.updatedAt };
}

async function ensurePlayerAnalysisStore() {
  if (playerAnalysisReady) return;
  if (!playerAnalysisInitPromise) {
    playerAnalysisStore.pool = tierAdmin.pool;
    playerAnalysisInitPromise = playerAnalysisStore.init()
      .then(() => { playerAnalysisReady = true; })
      .finally(() => { playerAnalysisInitPromise = null; });
  }
  await playerAnalysisInitPromise;
}

function withMenTierFallback(players) {
  const roster = Array.isArray(players) ? players : [];
  if (roster.some((player) => player.division === "men")) return roster;
  try {
    const fallback = JSON.parse(fs.readFileSync(MEN_TIER_FALLBACK_FILE, "utf8"));
    return [...roster, ...(Array.isArray(fallback?.players) ? fallback.players : [])];
  } catch {
    return roster;
  }
}

try {
  channelRegistry = JSON.parse(fs.readFileSync(SOOP_CHANNEL_FILE, "utf8"));
} catch {
  channelRegistry = {};
}

try {
  channelAliases = JSON.parse(fs.readFileSync(SOOP_ALIAS_FILE, "utf8"));
} catch {
  channelAliases = {};
}
channelAliases = { ...channelAliases, ...PINNED_SOOP_ALIASES };

try {
  const savedMenBroadcastMap = JSON.parse(fs.readFileSync(MEN_BROADCAST_MAP_FILE, "utf8"));
  menBroadcastMapRows = Array.isArray(savedMenBroadcastMap?.players)
    ? savedMenBroadcastMap.players
    : [];
} catch {
  menBroadcastMapRows = [];
}

try {
  const savedTierRoster = JSON.parse(fs.readFileSync(TIER_ROSTER_FILE, "utf8"));
  if (Array.isArray(savedTierRoster?.players) && savedTierRoster.players.length) {
    tierRosterCache = {
      cacheTime: Number(new Date(savedTierRoster.updatedAt)) || 0,
      players: withMenTierFallback(savedTierRoster.players)
    };
  }
} catch {
  tierRosterCache = null;
}

function send(res, status, body, type = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
    ...headers
  });
  res.end(body);
}

let soopVoteCache = { expiresAt: 0, payload: null };

async function loadSoopVoteRankings(force = false) {
  if (!force && soopVoteCache.payload && Date.now() < soopVoteCache.expiresAt) {
    return soopVoteCache.payload;
  }

  async function loadPage(page) {
    const response = await fetchWithRetry(
      SOOP_VOTE_API + "?page=" + page + "&orderby=reg_date&_=" + Date.now(),
      { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 ELO Kitten live vote" } }
    );
    if (!response.ok) throw new Error("SOOP 댓글 응답 오류: " + response.status);
    return response.json();
  }

  const first = await loadPage(1);
  const lastPage = Math.min(Number(first?.meta?.last_page || 1), 20);
  const rest = lastPage > 1
    ? await Promise.all(Array.from({ length: lastPage - 1 }, (_, index) => loadPage(index + 2)))
    : [];
  const unique = new Map();

  for (const item of [
    ...(Array.isArray(first?.data) ? first.data : []),
    ...rest.flatMap((page) => Array.isArray(page?.data) ? page.data : [])
  ]) {
    unique.set(Number(item.p_comment_no), item);
  }

  const rankings = [...unique.values()]
    .sort((a, b) => Number(b.like_cnt || 0) - Number(a.like_cnt || 0))
    .map((item) => ({
      commentId: Number(item.p_comment_no),
      nickname: String(item.user_nick || ""),
      userId: String(item.user_id || ""),
      profileImage: item.profile_image
        ? (String(item.profile_image).startsWith("//") ? "https:" + item.profile_image : String(item.profile_image))
        : "",
      comment: decodeEntities(item.comment || "").trim(),
      likes: Number(item.like_cnt || 0),
      replies: Number(item.c_comment_cnt || 0),
      registeredAt: String(item.reg_date || "")
    }));

  const payload = {
    rankings,
    totalComments: Number(first?.comment_count || rankings.length),
    fetchedAt: new Date().toISOString(),
    source: "https://www.sooplive.com/station/ititit/post/202619457"
  };
  soopVoteCache = { expiresAt: Date.now() + 3000, payload };
  return payload;
}

function requestIsSameOrigin(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return process.env.NODE_ENV !== "production";
  const protocol = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return origin === protocol + "://" + req.headers.host;
}
async function fetchWithRetry(url, options = {}, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.ok || response.status < 500 || attempt === attempts - 1) return response;
      lastError = new Error("upstream response error: " + response.status);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("upstream request failed");
}
function decodeEntities(value) {
  return String(value || "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function cleanText(value) {
  return decodeEntities(value).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function profileImageFromHtml(html) {
  const tagged = html.match(/<img\b[^>]*itemprop=["']image["'][^>]*>/i)?.[0] || "";
  const candidate = tagged.match(/(?:content|src)=["']([^"']+)["']/i)?.[1]
    || html.match(/<img\b[^>]*src=["']([^"']*\/data\/file\/bj_list\/[^"']+)["']/i)?.[1]
    || "";
  return candidate ? absoluteUrl(candidate.replace(/&amp;/g, "&")) : "";
}
function soopChannelFromHtml(html) {
  const match = String(html || "").match(/https?:\/\/(?:bj\.afreecatv\.com|ch\.sooplive\.co\.kr|play\.sooplive\.co\.kr)\/([a-z0-9_-]+)/i);
  if (!match) return null;
  const broadcastId = match[1];
  return { broadcastId, broadcastUrl: "https://play.sooplive.co.kr/" + encodeURIComponent(broadcastId) };
}
function normalizeName(name) {
  return String(name || "").replace(/\s+/g, "").trim().toLowerCase();
}
function diaryTierLabel(value) {
  const rawTier = String(value || "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!rawTier) return "";
  if (rawTier.toUpperCase() === "FA") return "FA";
  const hasPromotion = /승급\s*불/u.test(rawTier);
  const base = rawTier.replace(/\s*승급\s*불\s*$/u, "").trim();
  const label = base.endsWith("티어") ? base : base + "티어";
  return label + (hasPromotion ? " 승급불" : "");
}
function diaryRaceLabel(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "T" || normalized.includes("테란")) return "테란";
  if (normalized === "P" || normalized.includes("프로토스")) return "프로토스";
  if (normalized === "Z" || normalized.includes("저그")) return "저그";
  return "";
}
async function maybeSyncSpawnDiary(query, profile) {
  if (autoDiaryPlayerKey(query) !== autoDiaryPlayerKey(AUTO_PLAYER_NAME) || !profile) return null;
  try {
    let roster = [];
    try {
      roster = tierAdmin.applyOverrides(await loadTierRoster(false));
    } catch (error) {
      console.warn("Spawn diary auto-sync could not load opponent tiers:", error.message);
    }
    return await syncSpawnDiaryFromProfile({
      pool: tierAdmin.pool,
      profile,
      roster,
      playerName: AUTO_PLAYER_NAME
    });
  } catch (error) {
    console.error("Spawn diary auto-sync failed:", error.message);
    return {
      enabled: false,
      error: "스폰일지 자동등록을 완료하지 못했습니다. 잠시 후 다시 검색해 주세요."
    };
  }
}
let spawnDiarySchemaPromise = null;
async function ensureSpawnDiaryStorage() {
  if (!tierAdmin.pool) return false;
  if (!spawnDiarySchemaPromise) {
    spawnDiarySchemaPromise = initializeSpawnDiaryAutoSyncSchema(tierAdmin.pool)
      .then(() => true)
      .catch((error) => {
        spawnDiarySchemaPromise = null;
        throw error;
      });
  }
  return spawnDiarySchemaPromise;
}
async function syncSpawnDiaryNow(query, profile) {
  if (autoDiaryPlayerKey(query) !== autoDiaryPlayerKey(AUTO_PLAYER_NAME) || !profile) return null;
  try {
    await ensureSpawnDiaryStorage();
    return await maybeSyncSpawnDiary(query, profile);
  } catch (error) {
    console.error("Spawn diary immediate auto-sync failed:", error.message);
    return {
      enabled: false,
      error: "스폰일지 자동등록을 완료하지 못했습니다. 잠시 후 다시 검색해 주세요."
    };
  }
}
function normalizePlayerName(name) {
  return normalizeName(name).replace(/[tzp]$/i, "");
}
function compactProfileSnapshot(profile) {
  if (!profile || !profile.name || !profile.wrId) return null;
  return {
    ...profile,
    matches: Array.isArray(profile.matches) ? profile.matches.slice(0, PROFILE_SNAPSHOT_MATCH_LIMIT) : [],
    cachedAt: new Date().toISOString()
  };
}
async function ensureProfileSnapshotStorage() {
  if (!tierAdmin.pool) return false;
  if (!profileSnapshotSchemaPromise) {
    profileSnapshotSchemaPromise = tierAdmin.pool.query(`
      CREATE TABLE IF NOT EXISTS player_profile_snapshots (
        cache_key TEXT PRIMARY KEY,
        player_key TEXT NOT NULL,
        player_name TEXT NOT NULL,
        division TEXT NOT NULL,
        payload JSONB NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS player_profile_snapshots_player_key_idx
        ON player_profile_snapshots (player_key, fetched_at DESC);
    `).then(() => true).catch((error) => {
      profileSnapshotSchemaPromise = null;
      console.warn("Profile snapshot storage unavailable:", error.message);
      return false;
    });
  }
  return profileSnapshotSchemaPromise;
}
function isSnapshotTierEligible(profile) {
  const division = profile?.division === "men" ? "men" : "women";
  const key = normalizePlayerName(profile?.name);
  if (!key) return false;
  const menRecord = division === "men" ? menBroadcastRecord(profile.name) : null;
  const candidateKeys = new Set([
    key,
    normalizePlayerName(menRecord?.realName),
    normalizePlayerName(menRecord?.displayName),
    normalizePlayerName(menRecord?.broadcastName)
  ].filter(Boolean));
  const roster = tierAdmin.applyOverrides(tierRosterCache?.players || []);
  return roster.some((player) =>
    player.division === division &&
    ["5", "6", "7"].includes(String(player.tier || "")) &&
    candidateKeys.has(normalizePlayerName(player.name))
  );
}
async function rememberProfileSnapshot(profile) {
  const snapshot = compactProfileSnapshot(profile);
  if (!snapshot || !isSnapshotTierEligible(snapshot)) return;
  const playerKey = normalizePlayerName(snapshot.name);
  const division = snapshot.division === "men" ? "men" : "women";
  const cacheKey = division + ":" + snapshot.wrId;
  profileSnapshotMemory.set(playerKey, snapshot);
  if (!await ensureProfileSnapshotStorage()) return;
  try {
    await tierAdmin.pool.query(
      `INSERT INTO player_profile_snapshots (cache_key, player_key, player_name, division, payload, fetched_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
       ON CONFLICT (cache_key) DO UPDATE SET
         player_key = EXCLUDED.player_key,
         player_name = EXCLUDED.player_name,
         division = EXCLUDED.division,
         payload = EXCLUDED.payload,
         fetched_at = NOW()`,
      [cacheKey, playerKey, snapshot.name, division, JSON.stringify(snapshot)]
    );
    await tierAdmin.pool.query(
      `DELETE FROM player_profile_snapshots
       WHERE cache_key IN (
         SELECT cache_key FROM player_profile_snapshots
         ORDER BY fetched_at DESC OFFSET $1
       )`,
      [PROFILE_SNAPSHOT_LIMIT]
    );
  } catch (error) {
    console.warn("Profile snapshot save skipped:", error.message);
  }
}
async function cachedProfileForName(name) {
  const key = normalizePlayerName(name);
  if (!key) return null;
  const memory = profileSnapshotMemory.get(key);
  if (memory) return { ...memory, stale: true, cached: true };
  if (!await ensureProfileSnapshotStorage()) return null;
  try {
    const result = await tierAdmin.pool.query(
      `SELECT payload, fetched_at FROM player_profile_snapshots
       WHERE player_key = $1
       ORDER BY fetched_at DESC LIMIT 1`,
      [key]
    );
    const row = result.rows[0];
    if (!row?.payload || typeof row.payload !== "object") return null;
    const profile = { ...row.payload, cachedAt: row.fetched_at, stale: true, cached: true };
    profileSnapshotMemory.set(key, profile);
    return profile;
  } catch (error) {
    console.warn("Profile snapshot read skipped:", error.message);
    return null;
  }
}
function normalizeSoopName(name) {
  return normalizePlayerName(name)
    .replace(/^(?:bj|af|soop)+/i, "")
    .replace(/[^0-9a-z가-힣]/gi, "");
}
function menBroadcastRecord(name) {
  const key = normalizeSoopName(name);
  if (!key) return null;
  return menBroadcastMapRows.find((row) => [row.realName, row.broadcastName, row.displayName]
    .some((value) => normalizeSoopName(value) === key)) || null;
}
function tierDisplayName(name) {
  const row = menBroadcastRecord(name);
  return String(row?.displayName || "").trim() || String(name || "");
}
function manualSoopAlias(name) {
  return channelAliases[normalizePlayerName(name)] || null;
}
function pinnedBroadcastIdFor(name) {
  const menRecord = menBroadcastRecord(name);
  return String(
    manualSoopAlias(name)?.broadcastId ||
    tierAdmin.getOverride(name)?.broadcastId ||
    menRecord?.broadcastId ||
    ""
  );
}
function allowedSoopNames(name) {
  const alias = manualSoopAlias(name);
  const menRecord = menBroadcastRecord(name);
  return [...new Set([
    name,
    alias?.searchName,
    ...(Array.isArray(alias?.stationNames) ? alias.stationNames : []),
    menRecord?.realName,
    menRecord?.broadcastName,
    menRecord?.displayName
  ].map(normalizeSoopName).filter(Boolean))];
}
function koreaDateKey(timestamp = Date.now()) {
  return new Date(Number(timestamp) + 1000 * 60 * 60 * 9).toISOString().slice(0, 10);
}
function absoluteUrl(href) {
  if (!href) return "";
  return href.startsWith("http") ? href : new URL(href, BOARD_URL).href;
}
function wrIdFromUrl(href) {
  const match = String(href || "").match(/[?&]wr_id=(\d+)/);
  return match ? match[1] : "";
}
function playerFromCell(cellHtml) {
  const link = cellHtml.match(/href=["']([^"']*bo_table=bj_list[^"']*)["'][\s\S]*?>([\s\S]*?)<\/a>/i);
  const name = cleanText(link ? link[2] : cellHtml);
  const href = link ? link[1].replace(/&amp;/g, "&") : "";
  const wrId = wrIdFromUrl(href);
  return { name, wrId, url: absoluteUrl(href) };
}
function parseRows(html) {
  const rows = [];
  const rowMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const rowHtml of rowMatches) {
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 8) continue;
    const dateLink = cells[0].match(/href=["']([^"']+)["'][\s\S]*?>([\s\S]*?)<\/a>/i);
    const date = cleanText(dateLink ? dateLink[2] : cells[0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const winnerPlayer = playerFromCell(cells[1]);
    const loserPlayer = playerFromCell(cells[2]);
    const winner = winnerPlayer.name;
    const loser = loserPlayer.name;
    const map = cleanText(cells[3]);
    const point = Number(cleanText(cells[4]).replace(/,/g, ""));
    const format = cleanText(cells[5]);
    const memo = cleanText(cells[6]);
    const inputBy = cleanText(cells[7]);
    if (!winner || !loser || !map || !Number.isFinite(point)) continue;
    rows.push({ category: "\uc5ec\uc131", date, winner, loser, winnerId: winnerPlayer.wrId, loserId: loserPlayer.wrId, winnerUrl: winnerPlayer.url, loserUrl: loserPlayer.url, playerA: winner, resultA: "\uc2b9", playerB: loser, resultB: "\ud328", map, point, format, memo, inputBy, url: absoluteUrl(dateLink ? dateLink[1].replace(/&amp;/g, "&") : "") });
  }
  return rows;
}
async function fetchBoardPage(page) {
  const url = page > 1 ? BOARD_URL + "&page=" + page : BOARD_URL;
  const response = await fetchWithRetry(url, { headers: { "User-Agent": "Mozilla/5.0 eloboard-women-search", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" } });
  if (!response.ok) throw new Error("board page " + page + " response error: " + response.status);
  return response.text();
}
function parsePageCount(html) {
  let max = 1;
  for (const match of html.matchAll(/(?:[?&]|&amp;)page=(\d+)/g)) max = Math.max(max, Number(match[1]));
  return max;
}
async function loadData(pageLimit, force = false) {
  const pages = Math.min(Math.max(Number(pageLimit) || DEFAULT_PAGES, 1), MAX_PAGES);
  const cached = cache.get(pages);
  if (!force && cached && Date.now() - cached.cacheTime < CACHE_MS) return cached.data;
  const promiseKey = String(pages);
  if (dataPromises.has(promiseKey)) return dataPromises.get(promiseKey);
  const promise = (async () => {
    try {
      const firstHtml = await fetchBoardPage(1);
      const siteMax = parsePageCount(firstHtml);
      const totalPages = Math.min(pages, siteMax || pages);
      const remainingPages = Array.from({ length: Math.max(totalPages - 1, 0) }, (_, index) => index + 2);
      const htmlPages = [firstHtml, ...(await mapConcurrent(remainingPages, 6, fetchBoardPage))];
      const seen = new Set();
      const matches = htmlPages.flatMap(parseRows).filter((match) => {
        const key = match.url || [match.date, match.winner, match.loser, match.map, match.point, match.format, match.memo].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const data = { source: BOARD_URL, fetchedAt: new Date().toISOString(), pagesLoaded: totalPages, requestedPages: pages, siteMaxPages: siteMax, matches };
      cache.set(pages, { cacheTime: Date.now(), data });
      return data;
    } catch (error) {
      if (cached?.data) return { ...cached.data, stale: true };
      throw error;
    }
  })();
  dataPromises.set(promiseKey, promise);
  try {
    return await promise;
  } finally {
    dataPromises.delete(promiseKey);
  }
}
function playerUrl(wrId) {
  return BJ_LIST_URL + "&wr_id=" + encodeURIComponent(wrId);
}
function menPlayerUrl(wrId) {
  return MEN_BJ_LIST_URL + "&wr_id=" + encodeURIComponent(wrId);
}
function addPlayer(map, name, wrId, url, source) {
  if (!name || !wrId) return;
  const key = wrId;
  if (!map.has(key)) {
    map.set(key, { name, wrId, url: url || playerUrl(wrId), source });
  }
}
function playersFromMatches(matches) {
  const map = new Map();
  for (const match of matches) {
    addPlayer(map, match.winner, match.winnerId, match.winnerUrl, "board");
    addPlayer(map, match.loser, match.loserId, match.loserUrl, "board");
  }
  return [...map.values()];
}
async function fetchBjListPage(page) {
  const url = page > 1 ? BJ_LIST_URL + "&page=" + page : BJ_LIST_URL;
  const response = await fetchWithRetry(url, { headers: { "User-Agent": "Mozilla/5.0 eloboard-women-search", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" } });
  if (!response.ok) throw new Error("BJ list page " + page + " response error: " + response.status);
  return response.text();
}
function parseBjListPlayers(html) {
  const players = new Map();
  const links = html.match(/<a\b[^>]*href=["'][^"']*bo_table=bj_list[^"']*wr_id=\d+[^"']*["'][^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const linkHtml of links) {
    const hrefMatch = linkHtml.match(/href=["']([^"']+)["']/i);
    const text = normalizeBjListPlayerText(cleanText(linkHtml));
    const href = hrefMatch ? hrefMatch[1].replace(/&amp;/g, "&") : "";
    const wrId = wrIdFromUrl(href);
    if (!wrId || !text || text.length > 30 || /\s/.test(text)) continue;
    addPlayer(players, text, wrId, absoluteUrl(href), "bj_list");
  }
  return [...players.values()];
}
function parseMenBjListPlayers(html) {
  const players = new Map();
  const links = html.match(/<a\b[^>]*href=["'][^"']*bo_table=bj_list[^"']*wr_id=\d+[^"']*["'][^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const linkHtml of links) {
    const hrefMatch = linkHtml.match(/href=["']([^"']+)["']/i);
    const strongText = linkHtml.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || "";
    const rawText = cleanText(strongText || linkHtml).replace(/\s+[\d,.]+(?:\s*)$/, "");
    const name = normalizeBjListPlayerText(rawText).replace(/([TZP])$/i, "").trim();
    const href = hrefMatch ? hrefMatch[1].replace(/&amp;/g, "&") : "";
    const wrId = wrIdFromUrl(href);
    if (!wrId || !name || name.length > 40) continue;
    addPlayer(players, name, wrId, href, "men_bj_list");
  }
  return [...players.values()];
}
async function fetchMenBjListPage(page) {
  const url = page > 1 ? MEN_BJ_LIST_URL + "&page=" + page : MEN_BJ_LIST_URL;
  const response = await fetchWithRetry(url, { headers: { "User-Agent": "Mozilla/5.0 elo-kitten men-search", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" } });
  if (!response.ok) throw new Error("men BJ list page " + page + " response error: " + response.status);
  return response.text();
}
async function loadMenPlayerIndex(force = false) {
  if (!force && menPlayerIndexCache && Date.now() - menPlayerIndexCache.cacheTime < CACHE_MS * 10) return menPlayerIndexCache.players;
  const firstHtml = await fetchMenBjListPage(1);
  const maxPages = Math.min(parsePageCount(firstHtml) || 1, 30);
  const remaining = Array.from({ length: Math.max(maxPages - 1, 0) }, (_, index) => index + 2);
  const htmlPages = [firstHtml, ...(await mapConcurrent(remaining, 6, fetchMenBjListPage))];
  const players = new Map();
  for (const html of htmlPages) for (const player of parseMenBjListPlayers(html)) addPlayer(players, player.name, player.wrId, player.url, player.source);
  const data = [...players.values()];
  if (!data.length) throw new Error("남자 선수 목록을 찾지 못했습니다.");
  menPlayerIndexCache = { cacheTime: Date.now(), players: data };
  return data;
}
async function searchMenPlayerCandidates(name, force = false) {
  return findPlayers(name, [], await loadMenPlayerIndex(force)).map((player) => ({ ...player, division: "men" }));
}

// 남성전적 메뉴와 같은 게시판 검색을 사용해 한 페이지에서만 선수를 찾습니다.
// 전체 남자 선수 목록(여러 페이지)을 매번 내려받지 않아 검색 지연을 줄입니다.
async function searchMenPlayerDirect(name) {
  const query = String(name || "").trim();
  if (!query) return [];
  const cacheKey = normalizeName(query);
  const cached = menDirectSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.cacheTime < CACHE_MS * 10) return cached.players;
  const searchUrl = MEN_BJ_LIST_URL + "&sfl=wr_subject&stx=" + encodeURIComponent(query);
  const response = await fetchWithRetry(searchUrl, {
    headers: { "User-Agent": "Mozilla/5.0 elo-kitten men-search", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" }
  }, 1);
  if (!response.ok) throw new Error("men player search response error: " + response.status);
  const html = await response.text();
  const players = new Map();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*bo_table=bj_list[^"']*wr_id=(\d+)[^"']*)["'][^>]*>[\s\S]*?<strong\b[^>]*>([\s\S]*?)<\/strong>[\s\S]*?<\/a>/gi)) {
    const href = match[1].replace(/&amp;/g, "&");
    const raw = cleanText(match[3]).replace(/\s+[\d,.]+\s*$/, "");
    const playerName = normalizeBjListPlayerText(raw).replace(/([TZP])$/i, "").trim();
    if (!playerName || !match[2]) continue;
    addPlayer(players, playerName, match[2], href, "men_bj_list");
  }
  const result = findPlayers(query, [], [...players.values()]).map((player) => ({ ...player, division: "men" }));
  if (result.length) menDirectSearchCache.set(cacheKey, { cacheTime: Date.now(), players: result });
  return result;
}

async function searchAllPlayerCandidates(name, force = false) {
  let womenPlayers = [];
  try {
    womenPlayers = await searchPlayerCandidates(name);
  } catch (error) {
    if (!force) console.warn("Women player search failed; trying men search:", error.message);
  }
  if (womenPlayers.length) return womenPlayers;
  let direct = [];
  try {
    direct = await searchMenPlayerDirect(name);
  } catch (error) {
    const cached = menDirectSearchCache.get(normalizeName(name));
    if (cached?.players?.length) return cached.players;
    console.warn("Men player search unavailable:", error.message);
    return [];
  }
  if (direct.length) return direct;
  try {
    return await searchMenPlayerCandidates(name, force);
  } catch (error) {
    console.warn("Men player index unavailable:", error.message);
    return [];
  }
}

async function searchPlayerCandidates(name) {
  const searchUrl = BJ_LIST_URL + "&sfl=wr_subject&stx=" + encodeURIComponent(name);
  const response = await fetchWithRetry(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 eloboard-women-search",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"
    }
  });
  if (!response.ok) throw new Error("player search response error: " + response.status);
  const players = parseBjListPlayers(await response.text());
  return findPlayers(name, [], players);
}
async function loadPlayerIndex(force = false) {
  if (!force && playerIndexCache && Date.now() - playerIndexCache.cacheTime < CACHE_MS * 10) return playerIndexCache.players;
  if (playerIndexPromise) return playerIndexPromise;
  playerIndexPromise = (async () => {
    try {
      const firstHtml = await fetchBjListPage(1);
      const maxPages = Math.min(parsePageCount(firstHtml) || 1, 30);
      const remainingPages = Array.from({ length: Math.max(maxPages - 1, 0) }, (_, index) => index + 2);
      const htmlPages = [firstHtml, ...(await mapConcurrent(remainingPages, 6, fetchBjListPage))];
      const players = new Map();
      for (const html of htmlPages) {
        for (const player of parseBjListPlayers(html)) addPlayer(players, player.name, player.wrId, player.url, player.source);
      }
      const data = [...players.values()];
      if (!data.length) throw new Error("BJ list returned no players");
      playerIndexCache = { cacheTime: Date.now(), players: data };
      return data;
    } catch (error) {
      if (playerIndexCache?.players?.length) return playerIndexCache.players;
      throw error;
    }
  })();
  try {
    return await playerIndexPromise;
  } finally {
    playerIndexPromise = null;
  }
}
function findPlayers(query, matches, indexedPlayers) {
  const key = normalizeName(query);
  if (!key) return [];
  const candidates = new Map();
  for (const player of [...playersFromMatches(matches), ...(indexedPlayers || [])]) {
    if (normalizeName(player.name).includes(key)) candidates.set(player.wrId, player);
  }
  return [...candidates.values()].sort((a, b) => {
    const aName = normalizeName(a.name);
    const bName = normalizeName(b.name);
    return Number(bName === key) - Number(aName === key)
      || aName.length - bName.length
      || aName.localeCompare(bName, "ko");
  });
}
function textLines(html) {
  return decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|td|div|p|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
function parseRecordLine(line) {
  const match = line.match(/^(.+?)\s*:\s*([\d,]+)전\s*([\d,]+)승\s*([\d,]+)패\s*\(([\d.]+)%\)/);
  if (!match) return null;
  return { label: match[1], games: Number(match[2].replace(/,/g, "")), wins: Number(match[3].replace(/,/g, "")), losses: Number(match[4].replace(/,/g, "")), rate: Number(match[5]) };
}
function parseRecordFromText(text, label) {
  const pattern = new RegExp(label + "\\s*:?\\s*([\\d,]+)\\s*\\uc804\\s*([\\d,]+)\\s*\\uc2b9\\s*([\\d,]+)\\s*\\ud328(?:[\\s\\S]{0,20}?\\(([\\d.]+)%\\))?");
  const match = text.match(pattern);
  if (!match) return null;
  const wins = Number(match[2].replace(/,/g, ""));
  const games = Number(match[1].replace(/,/g, ""));
  const losses = Number(match[3].replace(/,/g, ""));
  return { label, games, wins, losses, rate: match[4] ? Number(match[4]) : Math.round((wins / Math.max(games, 1)) * 1000) / 10 };
}
function parseRaceTotals(plainText) {
  const raceKeys = { Terran: "T", Zerg: "Z", Protoss: "P" };
  const groups = { women: {}, mixed: {}, combined: {} };
  const womenStart = plainText.search(/여성\s*:/);
  const mixedStart = plainText.search(/혼성\s*:/);
  const sections = {
    women: womenStart >= 0 ? plainText.slice(womenStart, mixedStart > womenStart ? mixedStart : womenStart + 1500) : "",
    mixed: mixedStart >= 0 ? plainText.slice(mixedStart, mixedStart + 1500) : ""
  };

  for (const [group, section] of Object.entries(sections)) {
    for (const [label, race] of Object.entries(raceKeys)) {
      const record = parseRecordFromText(section, label);
      if (!record) continue;
      groups[group][race] = {
        games: record.games,
        wins: record.wins,
        losses: record.losses,
        rate: record.rate
      };
    }
  }

  for (const race of Object.values(raceKeys)) {
    const women = groups.women[race] || { games: 0, wins: 0, losses: 0 };
    const mixed = groups.mixed[race] || { games: 0, wins: 0, losses: 0 };
    const games = women.games + mixed.games;
    const wins = women.wins + mixed.wins;
    const losses = women.losses + mixed.losses;
    groups.combined[race] = {
      games,
      wins,
      losses,
      rate: games ? Math.round((wins / games) * 1000) / 10 : 0
    };
  }
  return groups;
}
function parseMenSummary(html) {
  const result = { total: null, raceTotals: { women: {}, mixed: {}, combined: {} } };
  for (const match of html.matchAll(/<th\b[^>]*>\s*(총전적|Terran|Zerg|Protoss)\s*<\/th>\s*<td\b[^>]*>\s*([\d,]+)전\s*([\d,]+)승\s*([\d,]+)패\s*\(([\d.]+)%\)/gi)) {
    const label = match[1].toLowerCase();
    const record = { games: Number(match[2].replace(/,/g, "")), wins: Number(match[3].replace(/,/g, "")), losses: Number(match[4].replace(/,/g, "")), rate: Number(match[5]) };
    if (label === "총전적".toLowerCase()) result.total = { label: "총전적", ...record };
    else result.raceTotals.combined[{ terran: "T", zerg: "Z", protoss: "P" }[label]] = record;
  }
  return result;
}
function parseProfileRows(html, baseUrl = BOARD_URL) {
  const rows = [];
  const rowMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const rowHtml of rowMatches) {
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 6) continue;
    const dateLink = cells[0].match(/href=["']([^"']+)["'][\s\S]*?>([\s\S]*?)<\/a>/i);
    const date = cleanText(dateLink ? dateLink[2] : cells[0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const opponentLink = cells[1].match(/href=["']([^"']+)["'][\s\S]*?>([\s\S]*?)<\/a>/i);
    const opponent = cleanText(opponentLink ? opponentLink[2] : cells[1]);
    const opponentCellText = cleanText(cells[1]);
    const opponentRace = opponentCellText.match(/\(([TPZ])\)\s*$/i)?.[1]?.toUpperCase()
      || opponentCellText.match(/\b([TPZ])\s*$/i)?.[1]?.toUpperCase()
      || "";
    rows.push({
      date,
      opponent,
      opponentRace,
      opponentId: opponentLink ? wrIdFromUrl(opponentLink[1]) : "",
      opponentUrl: opponentLink ? new URL(opponentLink[1].replace(/&amp;/g, "&"), baseUrl).href : "",
      map: cleanText(cells[2]),
      elo: Number(cleanText(cells[3]).replace(/[,]/g, "")),
      eloText: cleanText(cells[3]),
      format: cleanText(cells[4]),
      memo: cleanText(cells[5]),
      url: dateLink ? new URL(dateLink[1].replace(/&amp;/g, "&"), baseUrl).href : ""
    });
  }
  return rows;
}
function mergeProfileRows(...rowGroups) {
  const seen = new Set();
  return rowGroups.flat().filter((row) => {
    const key = row.url || [row.date, row.opponent, row.map, row.elo, row.format, row.memo].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}
async function fetchWomenRecordRows(playerName, profileUrl) {
  const name = String(playerName || "").trim();
  if (!name) return [];
  try {
    const response = await fetchWithRetry(
      WOMEN_RECORD_AJAX_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": profileUrl,
          "User-Agent": "Mozilla/5.0 eloboard-women-search",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"
        },
        body: new URLSearchParams({ bj_name: name, target_year: "" })
      },
      2
    );
    if (!response.ok) return [];
    const html = await response.text();
    return parseProfileRows(html);
  } catch (error) {
    console.warn("Women record AJAX unavailable; keeping profile rows:", error.message);
    return [];
  }
}
function inferRecent30(rows) {
  if (!rows.length) return null;
  const latest = rows.map((row) => new Date(row.date + "T00:00:00")).filter((date) => !Number.isNaN(date.getTime())).sort((a, b) => b - a)[0];
  if (!latest) return null;
  const from = new Date(latest);
  from.setDate(from.getDate() - 29);
  let wins = 0;
  let losses = 0;
  for (const row of rows) {
    const date = new Date(row.date + "T00:00:00");
    if (Number.isNaN(date.getTime()) || date < from || date > latest) continue;
    if (row.elo > 0) wins += 1;
    if (row.elo < 0) losses += 1;
  }
  return { wins, losses, games: wins + losses };
}
function parseProfile(html, wrId, profileUrlOverride = "", baseUrl = BOARD_URL) {
  const lines = textLines(html);
  const plainText = lines.join("\n");
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const name = cleanText(titleMatch ? titleMatch[1] : "") || lines.find((line) => line.includes("Terran") || line.includes("Zerg") || line.includes("Protoss")) || "";
  const recordLines = lines.map(parseRecordLine).filter(Boolean);
  const total = parseRecordFromText(plainText, "\ucd1d\uc804\uc801") || recordLines.find((record) => record.label.includes("\ucd1d\uc804\uc801")) || null;
  const women = parseRecordFromText(plainText, "\uc5ec\uc131") || recordLines.find((record) => record.label === "\uc5ec\uc131") || null;
  const mixed = parseRecordFromText(plainText, "\ud63c\uc131") || recordLines.find((record) => record.label === "\ud63c\uc131") || null;
  const recentLine = lines.find((line) => line.includes("\ucd5c\uadfc 30\uc77c\uac04 \uc804\uc801")) || "";
  const recentMatch = (recentLine + "\n" + plainText).match(/\ucd5c\uadfc\s*30\uc77c\uac04\s*\uc804\uc801[\s\S]{0,40}?\((\d+)\uc2b9\/(\d+)\ud328\)/);
  const raceMatch = plainText.match(/\b(Terran|Zerg|Protoss)\b/i);
  const race = raceMatch
    ? ({ terran: "테란", zerg: "저그", protoss: "프로토스" })[raceMatch[1].toLowerCase()]
    : "";
  const profileRows = parseProfileRows(html, baseUrl);
  const mostMatches = [];
  for (const match of html.matchAll(/href=["']([^"']*bo_table=bj_list[^"']*wr_id=\d+[^"']*)["'][^>]*>([^<]*?\((\d+)승\s*(\d+)패\))<\/a>/g)) {
    mostMatches.push({ name: cleanText(match[2]).replace(/\(.*/, ""), wins: Number(match[3]), losses: Number(match[4]), wrId: wrIdFromUrl(match[1]), url: absoluteUrl(match[1].replace(/&amp;/g, "&")) });
  }
  const info = {};
  const joined = lines.join("\n");
  const eloMatch = joined.match(/여성ELO\s*\n?\s*([\d,.]+)/);
  const ladderMatch = joined.match(/Ladder\s*\n?\s*([^\n]+)/);
  const univMatch = joined.match(/대학현황\s*\n?\s*([^\n]+)/);
  if (eloMatch) info.womenElo = eloMatch[1];
  if (ladderMatch) info.ladder = ladderMatch[1];
  if (univMatch) info.university = univMatch[1];
  const soop = soopChannelFromHtml(html);
  return {
    wrId: String(wrId),
    name,
    race,
    url: profileUrlOverride || playerUrl(wrId),
    image: profileImageFromHtml(html),
    broadcastId: soop?.broadcastId || "",
    broadcastUrl: soop?.broadcastUrl || "",
    info,
    total,
    women,
    mixed,
    records: recordLines,
    raceTotals: parseRaceTotals(plainText),
    recent30: recentMatch ? { wins: Number(recentMatch[1]), losses: Number(recentMatch[2]), games: Number(recentMatch[1]) + Number(recentMatch[2]) } : inferRecent30(profileRows),
    mostMatches: mostMatches.slice(0, 7),
    matches: profileRows
  };
}
async function loadProfile(wrId, force = false) {
  if (!wrId) return null;
  const cacheKey = String(wrId);
  const cached = profileCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.cacheTime < CACHE_MS) return cached.profile;
  if (profilePromises.has(cacheKey)) return profilePromises.get(cacheKey);
  const promise = (async () => {
    try {
      const response = await fetchWithRetry(
        playerUrl(wrId),
        { headers: { "User-Agent": "Mozilla/5.0 eloboard-women-search", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" } },
        1
      );
      if (!response.ok) throw new Error("profile " + wrId + " response error: " + response.status);
      const profile = parseProfile(await response.text(), wrId);
      if (!profile || String(profile.wrId) !== cacheKey || !String(profile.name || "").trim()) {
        throw new Error("profile " + wrId + " response validation failed");
      }
      const womenRows = await fetchWomenRecordRows(profile.name, profile.url);
      profile.matches = mergeProfileRows(womenRows, profile.matches);
      profile.recent30 = inferRecent30(profile.matches);
      profileCache.set(cacheKey, { cacheTime: Date.now(), profile });
      void rememberProfileSnapshot(profile);
      return profile;
    } catch (error) {
      if (cached?.profile) return { ...cached.profile, stale: true };
      throw error;
    }
  })();
  profilePromises.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    profilePromises.delete(cacheKey);
  }
}
async function loadMenProfile(wrId, force = false, playerName = "") {
  if (!wrId) return null;
  const cacheKey = "men:" + String(wrId);
  const cached = profileCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.cacheTime < CACHE_MS) return cached.profile;
  if (profilePromises.has(cacheKey)) return profilePromises.get(cacheKey);
  const promise = (async () => {
    try {
      const url = menPlayerUrl(wrId);
      const allRowsPromise = playerName ? fetchMenAllRows(playerName).catch((error) => {
        console.warn("Men all-period rows unavailable:", error.message);
        return [];
      }) : Promise.resolve([]);
      const response = await fetchWithRetry(url, {
        headers: { "User-Agent": "Mozilla/5.0 elo-kitten men-search", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" }
      }, 1);
      if (!response.ok) throw new Error("men profile " + wrId + " response error: " + response.status);
      const html = await response.text();
      const profile = parseProfile(html, wrId, url, MEN_BJ_LIST_URL);
      if (!profile || String(profile.wrId) !== String(wrId) || !String(profile.name || "").trim()) {
        throw new Error("men profile " + wrId + " response validation failed");
      }
      profile.division = "men";
      profile.source = MEN_BJ_LIST_URL;
      const menSummary = parseMenSummary(html);
      if (menSummary.total) profile.total = menSummary.total;
      for (const race of ["T", "Z", "P"]) {
        const overall = menSummary.raceTotals.combined[race];
        if (overall) profile.raceTotals.combined[race] = overall;
      }
      profile.women = null;
      profile.mixed = null;
      // 남성 프로필 본문은 최근 경기만 포함하므로, 남성전적 검색 결과에서 전체 기간 행을 추가합니다.
      try {
        const allRows = await (playerName ? allRowsPromise : fetchMenAllRows(profile.name));
        profile.matches = mergeProfileRows(profile.matches, allRows);
      } catch (error) {
        console.warn("Men all-period rows unavailable; keeping profile rows:", error.message);
        profile.matches = mergeProfileRows(profile.matches);
      }
      profile.recent30 = inferRecent30(profile.matches);
      profileCache.set(cacheKey, { cacheTime: Date.now(), profile });
      void rememberProfileSnapshot(profile);
      return profile;
    } catch (error) {
      if (cached?.profile) return { ...cached.profile, stale: true };
      throw error;
    }
  })();
  profilePromises.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    profilePromises.delete(cacheKey);
  }
}

function summarize(matches, query) {
  const key = normalizeName(query);
  const filtered = key ? matches.filter((m) => normalizeName(m.winner).includes(key) || normalizeName(m.loser).includes(key)) : matches;
  const summary = { games: filtered.length, wins: 0, losses: 0, winRate: 0, pointNet: 0, maps: {}, opponents: {}, dates: {} };
  for (const match of filtered) {
    const isWinner = key && normalizeName(match.winner).includes(key);
    const isLoser = key && normalizeName(match.loser).includes(key);
    const result = isWinner ? "\uc2b9" : isLoser ? "\ud328" : "";
    const opponent = isWinner ? match.loser : isLoser ? match.winner : "";
    const delta = result === "\uc2b9" ? match.point : result === "\ud328" ? -match.point : match.point;
    if (result === "\uc2b9") summary.wins += 1;
    if (result === "\ud328") summary.losses += 1;
    summary.pointNet += delta;
    summary.maps[match.map] = (summary.maps[match.map] || 0) + 1;
    summary.dates[match.date] = (summary.dates[match.date] || 0) + 1;
    if (opponent) {
      summary.opponents[opponent] ||= { games: 0, wins: 0, losses: 0, pointNet: 0 };
      summary.opponents[opponent].games += 1;
      summary.opponents[opponent].pointNet += delta;
      if (result === "\uc2b9") summary.opponents[opponent].wins += 1;
      if (result === "\ud328") summary.opponents[opponent].losses += 1;
    }
  }
  summary.winRate = summary.games && key ? Math.round((summary.wins / summary.games) * 1000) / 10 : 0;
  summary.pointNet = Math.round(summary.pointNet * 10) / 10;
  return { filtered, summary };
}
function stripRace(value) {
  return cleanText(value).replace(/\s*\([TZP]\)\s*$/i, "").replace(/[TZP]$/i, "").trim();
}
function parseMatchupRows(html, main, opponent) {
  const matches = [];
  for (const row of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const date = row[0].match(/<span class=["']td_datetime["']>(\d{8})<\/span>/i)?.[1];
    if (!date) continue;
    const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => cleanText(match[1]));
    if (cells.length < 4) continue;
    const winner = stripRace(cells[1]);
    const loser = stripRace(cells[2]);
    if (![winner, loser].includes(main) || ![winner, loser].includes(opponent)) continue;
    matches.push({ date, map: cells[3], result: winner === main ? "승" : "패" });
  }
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 90);
  const recentMatches = matches.filter((match) => {
    const date = new Date(match.date.slice(0, 4) + "-" + match.date.slice(4, 6) + "-" + match.date.slice(6, 8) + "T00:00:00+09:00");
    return date >= cutoff;
  });
  const tally = (items) => [items.filter((item) => item.result === "승").length, items.filter((item) => item.result === "패").length];
  return {
    main,
    opponent,
    total: tally(matches),
    recent: tally(recentMatches),
    lastPlayed: matches[0] ? matches[0].date.slice(0, 4) + "." + matches[0].date.slice(4, 6) + "." + matches[0].date.slice(6, 8) : "경기 없음",
    maps: matches.slice(0, 6).map((match) => ({ map: match.map, result: match.result, date: match.date.slice(4, 6) + "." + match.date.slice(6, 8) }))
  };
}
async function loadMatchupPlayers() {
  const response = await fetch(MATCHUP_LIST_URL, { headers: { "User-Agent": "Mozilla/5.0 elo-kitten matchup", "Accept-Language": "ko-KR,ko;q=0.9" } });
  if (!response.ok) throw new Error("선수 목록 응답 오류: " + response.status);
  const html = await response.text();
  const select = html.match(/<select[^>]+name=["']player_1["'][\s\S]*?<\/select>/i)?.[0] || "";
  return [...select.matchAll(/<option[^>]+value=["']([^"']+)["'][^>]*>([^<]+)<\/option>/gi)]
    .map((match) => {
      const parts = cleanText(match[2]).split("|");
      const raceText = (parts[1] || "").toLowerCase();
      return { name: (parts[0] || "").trim(), race: raceText.startsWith("t") ? "T" : raceText.startsWith("z") ? "Z" : "P" };
    })
    .filter((player) => player.name);
}
async function findMatchupProfile(name) {
  const players = await searchPlayerCandidates(name);
  return players[0]?.wrId ? loadProfile(players[0].wrId) : null;
}
async function loadMatchupPhotos(rawNames) {
  const names = [...new Set((rawNames || []).map((name) => String(name || "").trim()).filter(Boolean))].slice(0, 24);
  const photos = {};
  let cursor = 0;
  async function worker() {
    while (cursor < names.length) {
      const name = names[cursor++];
      try {
        const profile = await findMatchupProfile(name);
        photos[name] = profile?.image || "";
      } catch {
        photos[name] = "";
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, names.length) }, () => worker()));
  return photos;
}
function recentOpponentRecommendations(profile, days = 90) {
  const rows = profile?.matches || [];
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  const opponents = new Map();
  for (const row of rows) {
    const date = new Date(String(row.date || "") + "T00:00:00+09:00");
    const opponent = stripRace(row.opponent);
    if (!opponent || Number.isNaN(date.getTime()) || date < cutoff) continue;
    const item = opponents.get(opponent) || { name: opponent, games: 0, wins: 0, losses: 0, lastPlayed: "" };
    item.games += 1;
    if (Number(row.elo) > 0) item.wins += 1;
    if (Number(row.elo) < 0) item.losses += 1;
    if (String(row.date) > item.lastPlayed) item.lastPlayed = String(row.date);
    opponents.set(opponent, item);
  }
  return [...opponents.values()].sort((a, b) => b.games - a.games || b.lastPlayed.localeCompare(a.lastPlayed) || a.name.localeCompare(b.name, "ko"));
}
async function fetchMatchup(main, opponent) {
  const body = new URLSearchParams({ wr_1: main, wr_2: opponent, sear: "", b_id: "eloboard" });
  const response = await fetch(MATCHUP_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "User-Agent": "Mozilla/5.0 elo-kitten matchup" },
    body
  });
  if (!response.ok) throw new Error("상대전적 응답 오류: " + response.status);
  return parseMatchupRows(await response.text(), main, opponent);
}
function selectOptions(html, name) {
  const select = html.match(new RegExp("<select[^>]+(?:name|id)=[\"']" + name + "[\"'][\\s\\S]*?<\\/select>", "i"))?.[0] || "";
  return [...select.matchAll(/<option[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi)]
    .map((match) => ({ value: cleanText(match[1]), label: cleanText(match[2]) })).filter((item) => item.value.trim());
}
async function loadMenOptions() {
  const response = await fetch(MEN_LIST_URL, { headers: { "User-Agent": "Mozilla/5.0 elo-kitten men records", "Accept-Language": "ko-KR,ko;q=0.9" } });
  if (!response.ok) throw new Error("남성 선수 목록 응답 오류: " + response.status);
  const html = await response.text();
  return { players: selectOptions(html, "wr_3").map((item) => item.label), maps: selectOptions(html, "wr_subject").map((item) => item.label) };
}
function parseMenPairRecord(html, player1, player2) {
  let wins = 0;
  let losses = 0;
  let player1Race = "";
  let opponentRace = "";
  const matches = [];
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    if (!/bo_table=bat/i.test(rowHtml)) continue;
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => cleanText(match[1]));
    if (cells.length < 7) continue;
    const winner = stripRace(cells[1]);
    const loser = stripRace(cells[2]);
    if (![winner, loser].includes(player1) || ![winner, loser].includes(player2)) continue;
    if (winner === player1) wins += 1;
    if (loser === player1) losses += 1;
    const player1Raw = winner === player1 ? cells[1] : cells[2];
    const opponentRaw = winner === player2 ? cells[1] : cells[2];
    player1Race ||= player1Raw.match(/([TZP])\s*$/i)?.[1]?.toUpperCase() || "";
    opponentRace ||= opponentRaw.match(/([TZP])\s*$/i)?.[1]?.toUpperCase() || "";
    matches.push({ date: cells[0], winner, loser, map: cells[3], elo: cells[4], format: cells[5], memo: cells[6] });
  }
  const games = wins + losses;
  if (!games) return { raceRecords: [], opponents: [] };
  const eloPoint = cleanText(html).match(/상대\s*ELO\s*POINT\s*:\s*([+-]?[\d,.]+)/i)?.[1] || "";
  const playerElos = [...html.matchAll(/font-size\s*:\s*1\.2em[^>]*font-weight\s*:\s*bold[^>]*>([\d,.]+)p/gi)].map((match) => match[1]);
  const profileImages = [...html.matchAll(/<img\b[^>]*src=["']?([^"'\s>]*\/data\/file\/bj_list\/[^"'\s>]+)/gi)]
    .map((match) => absoluteUrl(match[1]).replace(/^http:/i, "https:"));
  return {
    raceRecords: [],
    opponents: [{ name: player2, race: opponentRace, player1Race, wins, losses, rate: Math.round((wins / games) * 1000) / 10, eloPoint, player1Elo: playerElos[0] || "", opponentElo: playerElos[1] || "", player1Image: profileImages[0] || "", opponentImage: profileImages[1] || "", matches }]
  };
}
function parseMenRecord(html, filters = {}) {
  if (filters.player1 && filters.player2) return parseMenPairRecord(html, filters.player1, filters.player2);
  const raceRecords = [];
  for (const match of html.matchAll(/<th[^>]*>(Zerg|Protoss|Terran)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const record = cleanText(match[2]).match(/([\d,]+)전\s*([\d,]+)승\s*([\d,]+)패\s*\(([\d.]+)%\)/);
    if (record) raceRecords.push({ race: match[1], games: Number(record[1].replace(/,/g, "")), wins: Number(record[2].replace(/,/g, "")), losses: Number(record[3].replace(/,/g, "")), rate: Number(record[4]) });
  }
  const opponents = [];
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    if (!/bo_table=bj_list/i.test(rowHtml)) continue;
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => cleanText(match[1]));
    if (cells.length < 5) continue;
    const rawName = cells[0];
    const record = cells[1].match(/([\d,]+)승\s*([\d,]+)패/);
    if (!record) continue;
    opponents.push({ name: rawName.replace(/\s*\([TZP]\)\s*$/i, ""), race: rawName.match(/\(([TZP])\)\s*$/i)?.[1]?.toUpperCase() || "", wins: Number(record[1].replace(/,/g, "")), losses: Number(record[2].replace(/,/g, "")), rate: Number(cells[2].replace("%", "")) || 0, eloPoint: cells[3], opponentElo: cells[4] });
  }
  return { raceRecords, opponents };
}
async function fetchMenRecords(filters) {
  const body = new URLSearchParams({ wr_1: filters.startDate || "", wr_2: filters.endDate || "", wr_3: filters.player1 || " ", wr_4: filters.player2 || " ", wr_5: filters.memo || "", wr_6: filters.inputBy || "", wr_subject: filters.map || " ", sear: "", b_id: "eloboard" });
  if (filters.proLeague) body.set("wr_8", "1");
  const response = await fetch(MEN_SEARCH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "User-Agent": "Mozilla/5.0 elo-kitten men records" }, body });
  if (!response.ok) throw new Error("남성전적 응답 오류: " + response.status);
  return parseMenRecord(await response.text(), filters);
}
async function fetchMenAllRows(playerName) {
  const body = new URLSearchParams({ wr_1: "", wr_2: "", wr_3: playerName || " ", wr_4: " ", wr_5: "", wr_6: "", wr_subject: " ", sear: "", b_id: "eloboard" });
  const response = await fetch(MEN_SEARCH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "User-Agent": "Mozilla/5.0 elo-kitten men records" }, body });
  if (!response.ok) throw new Error("남성 전체전적 응답 오류: " + response.status);
  return parseProfileRows(await response.text(), MEN_BJ_LIST_URL);
}

function parseUniversities(html) {
  const universities = [];
  const seen = new Set();
  for (const match of html.matchAll(/<a\b[^>]*class=["'][^"']*portfolio_btn[^"']*["'][^>]*href=["']([^"']*univ_name=([^"'&]+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = cleanText(match[3]);
    if (!label || label.toUpperCase() === "FA") continue;
    let name = decodeEntities(match[2]);
    try { name = decodeURIComponent(name); } catch {}
    name = name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    universities.push({ name, label });
  }
  return universities;
}

function parseUniversityRoster(html, university) {
  const players = [];
  const seen = new Set();
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const anchor = row.match(/<a\b[^>]*class=["'][^"']*p_name[^"']*["'][^>]*>[\s\S]*?<\/a>/i)?.[0] || "";
    if (!anchor) continue;
    const value = anchor.match(/\bvalue=["']([^"']+)["']/i)?.[1];
    const display = cleanText(anchor);
    const tierMatch = display.match(/\(([^()]+)\)\s*$/);
    const name = decodeEntities(value || display.replace(/\s*\([^()]+\)\s*$/, "")).trim();
    const tier = tierMatch?.[1]?.trim() || (university === "연합팀" ? "FA" : "");
    if (!name || !tier || seen.has(name)) continue;
    const image = anchor.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1] || "";
    const href = anchor.match(/\bhref=["']([^"']+)["']/i)?.[1] || "";
    const division = /\/men\//i.test(image)
      ? "men"
      : /\/women\/data\/file\/bj_list\//i.test(image)
        ? "women"
        : /\/women\/data\/file\/bj_m_list\//i.test(image)
          ? "mixed"
          : "unknown";
    const raceName = row.match(/\b(Terran|Protoss|Zerg)\b/i)?.[1]?.toLowerCase() || "";
    const race = { terran: "T", protoss: "P", zerg: "Z" }[raceName] || "";
    seen.add(name);
    players.push({
      name,
      tier,
      division,
      race,
      university,
      image: absoluteUrl(image.replace(/&amp;/g, "&")),
      profileUrl: absoluteUrl(href.replace(/&amp;/g, "&"))
    });
  }
  return players;
}

async function fetchUniversityPage(name = "") {
  const url = name ? UNIVERSITY_LIST_URL + "&univ_name=" + encodeURIComponent(name) : UNIVERSITY_LIST_URL;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 elo-kitten university", "Accept-Language": "ko-KR,ko;q=0.9" } });
  if (!response.ok) throw new Error("대학 명단 응답 오류: " + response.status);
  return response.text();
}

async function loadUniversities(force = false) {
  if (!force && universityCache && Date.now() - universityCache.cacheTime < CACHE_MS * 10) return universityCache.items;
  const items = parseUniversities(await fetchUniversityPage());
  if (!items.length) throw new Error("대학 목록을 찾지 못했습니다.");
  universityCache = { cacheTime: Date.now(), items };
  return items;
}

async function loadUniversityRoster(name, force = false) {
  const cached = universityRosterCache.get(name);
  if (!force && cached && Date.now() - cached.cacheTime < CACHE_MS * 10) return cached.players;
  const players = parseUniversityRoster(await fetchUniversityPage(name), name);
  if (!players.length) throw new Error(name + " 소속 선수를 찾지 못했습니다.");
  universityRosterCache.set(name, { cacheTime: Date.now(), players });
  return players;
}

async function refreshTierRoster() {
  const universities = await loadUniversities(true);
  const tierUniversities = [...universities, { name: "연합팀", label: "FA" }];
  const rosters = await mapConcurrent(tierUniversities, 4, (university) => loadUniversityRoster(university.name, true));
  const players = new Map();
  const menTiers = new Set(["갓", "킹", "잭", "조커", "스페이드"]);
  for (const player of rosters.flat()) {
    const isWomenTier = player.division === "women" && (/^\d+$/.test(player.tier) || player.tier === "FA");
    const isMenTier = player.division === "men" && (menTiers.has(player.tier) || player.tier === "FA");
    if (!isWomenTier && !isMenTier) continue;
    const pinnedName = PINNED_TIER_DISPLAY_NAMES[normalizeName(player.name)] || player.name;
    const rosterPlayer = pinnedName === player.name ? player : { ...player, name: pinnedName };
    const key = rosterPlayer.division + ":" + normalizeName(rosterPlayer.name);
    const current = players.get(key);
    if (!current) {
      players.set(key, { ...rosterPlayer, universities: [rosterPlayer.university] });
    } else if (!current.universities.includes(rosterPlayer.university)) {
      current.universities.push(rosterPlayer.university);
    }
  }
  const tierOrder = new Map([
    ["갓", 0],
    ["킹", 1],
    ["잭", 2],
    ["조커", 3],
    ["스페이드", 4],
    ...Array.from({ length: 10 }, (_, index) => [String(index), index + 5]),
    ["FA", 15]
  ]);
  const tierRank = (tier) => tierOrder.get(tier) ?? Number.MAX_SAFE_INTEGER;
  const data = [...players.values()].sort((a, b) =>
    tierRank(a.tier) - tierRank(b.tier) ||
    a.division.localeCompare(b.division) ||
    a.name.localeCompare(b.name, "ko"));
  tierRosterCache = { cacheTime: Date.now(), players: data };
  try {
    fs.mkdirSync(path.dirname(TIER_ROSTER_FILE), { recursive: true });
    fs.writeFileSync(TIER_ROSTER_FILE, JSON.stringify({
      updatedAt: new Date(tierRosterCache.cacheTime).toISOString(),
      players: data
    }, null, 2) + "\n");
  } catch {
    // 읽기 전용 배포 환경에서도 메모리 캐시는 계속 사용합니다.
  }
  return data;
}

async function loadTierRoster(force = false) {
  if (!force && tierRosterCache?.players?.length) {
    if (koreaDateKey(tierRosterCache.cacheTime) !== koreaDateKey() && !tierRosterPromise) {
      tierRosterPromise = refreshTierRoster().catch(() => tierRosterCache.players).finally(() => {
        tierRosterPromise = null;
      });
    }
    return tierRosterCache.players;
  }
  if (!tierRosterPromise) {
    tierRosterPromise = refreshTierRoster().finally(() => {
      tierRosterPromise = null;
    });
  }
  return tierRosterPromise;
}

function scheduleChannelRegistrySave() {
  if (channelRegistrySaveTimer) return;
  channelRegistrySaveTimer = setTimeout(() => {
    channelRegistrySaveTimer = null;
    fs.mkdir(path.dirname(SOOP_CHANNEL_FILE), { recursive: true }, (mkdirError) => {
      if (mkdirError) return;
      fs.writeFile(SOOP_CHANNEL_FILE, JSON.stringify(channelRegistry, null, 2) + "\n", () => {});
    });
  }, 300);
}

function soopProfileImageUrl(broadcastId) {
  const id = String(broadcastId || "").trim();
  if (!/^[a-z0-9_-]{2,}$/i.test(id)) return "";
  const folder = id.slice(0, 2).toLowerCase();
  return "https://profile.img.sooplive.co.kr/LOGO/" + encodeURIComponent(folder) + "/" + encodeURIComponent(id) + "/" + encodeURIComponent(id) + ".jpg";
}

function tierProfileAssets(player) {
  if (player?.customPlayer) return {};
  const menRecord = player?.division === "men" ? menBroadcastRecord(player.name) : null;
  if (menRecord?.broadcastId) {
    const profileImage = soopProfileImageUrl(menRecord.broadcastId);
    if (profileImage) return { tierStaticImage: profileImage, tierAnimatedImage: "" };
  }
  const key = normalizePlayerName(player?.name);
  const pinnedId = pinnedBroadcastIdFor(player?.name).trim();
  const registeredId = String(channelRegistry[key] || "").trim();
  const broadcastId = pinnedId || registeredId;
  if (!/^[a-z0-9_-]+$/i.test(broadcastId)) return {};
  const encodedId = encodeURIComponent(broadcastId);
  return {
    tierStaticImage: "/tier-profiles/" + encodedId + "-static.webp",
    tierAnimatedImage: "/tier-profiles/" + encodedId + "-animated.webp"
  };
}

function addTierProfileAssets(players) {
  return (players || []).map((player) => ({ ...player, ...tierProfileAssets(player) }));
}

function applyMenTierDisplayNames(players) {
  return (players || []).map((player) => {
    if (player.division !== "men") return player;
    const displayName = tierDisplayName(player.name);
    if (!displayName || displayName === player.name) return player;
    return { ...player, realName: player.name, name: displayName };
  });
}

function addTierCctvSources(players) {
  return addTierProfileAssets(applyMenTierDisplayNames(players)).map((player) => {
    const directChannel = soopChannelFromHtml([
      player.broadcastId,
      player.broadcastUrl,
      player.stationUrl,
      player.station_url,
      player.soopUrl,
      player.soop_url,
      player.afreecaUrl,
      player.afreeca_url,
      player.profileUrl
    ].filter(Boolean).join(" "));
    const broadcastId = String(
      directChannel?.broadcastId ||
      pinnedBroadcastIdFor(player.name) ||
      channelRegistry[normalizePlayerName(player.name)] ||
      player.broadcastId ||
      ""
    ).trim();
    if (!/^[a-z0-9_-]+$/i.test(broadcastId)) return player;
    return {
      ...player,
      broadcastId,
      broadcastUrl: "https://play.sooplive.co.kr/" + encodeURIComponent(broadcastId),
      cctvSource: directChannel?.broadcastId ? "tier-url" : "soop-alias"
    };
  });
}

async function discoverSoopChannel(name) {
  const key = normalizePlayerName(name);
  const aliasId = pinnedBroadcastIdFor(name);
  if (/^[a-z0-9_-]+$/i.test(aliasId)) {
    return {
      broadcastId: aliasId,
      broadcastUrl: "https://play.sooplive.co.kr/" + encodeURIComponent(aliasId)
    };
  }
  const hasRegisteredChannel = Object.prototype.hasOwnProperty.call(channelRegistry, key);
  const registeredId = String(channelRegistry[key] || "");
  if (/^[a-z0-9_-]+$/i.test(registeredId)) {
    return {
      broadcastId: registeredId,
      broadcastUrl: "https://play.sooplive.co.kr/" + encodeURIComponent(registeredId)
    };
  }
  if (hasRegisteredChannel && channelRegistry[key] === null) return null;
  const cached = channelCache.get(key);
  if (cached && Date.now() - cached.cacheTime < CHANNEL_CACHE_MS) return cached.channel;
  try {
    const players = await loadPlayerIndex();
    const player = players.find((item) => normalizePlayerName(item.name) === key);
    const profile = player ? await loadProfile(player.wrId) : null;
    const channel = profile?.broadcastId
      ? { broadcastId: profile.broadcastId, broadcastUrl: profile.broadcastUrl }
      : null;
    channelRegistry[key] = channel?.broadcastId || null;
    scheduleChannelRegistrySave();
    channelCache.set(key, { cacheTime: Date.now(), channel });
    return channel;
  } catch {
    return null;
  }
}

async function searchSoopLiveStatus(name) {
  try {
    const alias = manualSoopAlias(name);
    const searchName = String(alias?.searchName || name);
    const url = new URL(SOOP_LIVE_SEARCH_API);
    url.searchParams.set("m", "liveSearch");
    url.searchParams.set("v", "1.0");
    url.searchParams.set("szKeyword", searchName);
    url.searchParams.set("nPageNo", "1");
    url.searchParams.set("nListCnt", "10");
    url.searchParams.set("szOrder", "score");
    url.searchParams.set("c", "UTF-8");
    const response = await fetchWithRetry(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 elo-kitten live-search",
        "Accept": "application/json",
        "Referer": "https://www.sooplive.co.kr/"
      }
    });
    if (!response.ok) throw new Error("SOOP live search " + response.status);
    const data = await response.json();
    const broadcasts = [
      ...(Array.isArray(data?.REAL_BROAD) ? data.REAL_BROAD : []),
      ...(Array.isArray(data?.SCRAP_BROAD) ? data.SCRAP_BROAD : []),
      ...(Array.isArray(data?.EXTRA_BROAD) ? data.EXTRA_BROAD : [])
    ];
    const acceptedNames = allowedSoopNames(name);
    const pinnedBroadcastId = pinnedBroadcastIdFor(name);
    const broad = broadcasts.find((item) => {
      const candidateId = String(item?.user_id || "");
      if (pinnedBroadcastId) return candidateId === pinnedBroadcastId;
      const candidateNames = [
        item?.station_name,
        item?.user_nick
      ].map(normalizeSoopName).filter(Boolean);
      return candidateNames.some((candidate) => acceptedNames.includes(candidate));
    });
    const broadcastId = String(broad?.user_id || "");
    const broadNo = String(broad?.broad_no || "");
    if (!broadcastId || !broadNo) return null;
    const broadcastUrl = "https://play.sooplive.co.kr/" + encodeURIComponent(broadcastId) + "/" + encodeURIComponent(broadNo);
    const status = {
      available: true,
      isLive: true,
      broadcastId,
      broadcastUrl,
      title: String(broad?.broad_title || broad?.b_broad_title || ""),
      viewerCount: Number(
        broad?.total_view_cnt ||
        (Number(broad?.current_view_cnt || 0) + Number(broad?.mobile_view_cnt || broad?.m_current_view_cnt || 0))
      ),
      thumbnail: String(broad?.broad_img || broad?.sn_url || ("https://liveimg.sooplive.co.kr/m/" + encodeURIComponent(broadNo))),
      profileImage: ""
    };
    const key = normalizePlayerName(name);
    channelRegistry[key] = broadcastId;
    channelCache.set(key, {
      cacheTime: Date.now(),
      channel: { broadcastId, broadcastUrl: "https://play.sooplive.co.kr/" + encodeURIComponent(broadcastId) }
    });
    liveStatusCache.set(broadcastId, { cacheTime: Date.now(), status });
    scheduleChannelRegistrySave();
    return { name, ...status };
  } catch {
    return null;
  }
}

async function querySoopLiveStatus(name, force = false) {
  const channel = await discoverSoopChannel(name);
  if (!channel) {
    const searchedStatus = await searchSoopLiveStatus(name);
    return searchedStatus || { name, available: false, isLive: false };
  }
  const cached = liveStatusCache.get(channel.broadcastId);
  if (!force && cached && Date.now() - cached.cacheTime < LIVE_CACHE_MS) return { name, ...cached.status };
  try {
    const response = await fetchWithRetry(SOOP_STATION_API + "/" + encodeURIComponent(channel.broadcastId) + "/station", {
      headers: {
        "User-Agent": "Mozilla/5.0 elo-kitten live-status",
        "Accept": "application/json",
        "Referer": "https://ch.sooplive.co.kr/"
      }
    });
    if (!response.ok) throw new Error("SOOP status " + response.status);
    const data = await response.json();
    const broad = data?.broad || null;
    const broadNo = String(broad?.broad_no || broad?.bno || "");
    const acceptedNames = allowedSoopNames(name);
    const stationNames = [
      data?.station?.station_name,
      data?.station?.user_nick
    ].map(normalizeSoopName).filter(Boolean);
    const pinnedBroadcastId = pinnedBroadcastIdFor(name);
    const usesPinnedChannel = Boolean(pinnedBroadcastId) && pinnedBroadcastId === channel.broadcastId;
    if (!usesPinnedChannel && stationNames.length && !stationNames.some((stationName) => acceptedNames.includes(stationName))) {
      const key = normalizePlayerName(name);
      channelRegistry[key] = null;
      channelCache.delete(key);
      liveStatusCache.delete(channel.broadcastId);
      scheduleChannelRegistrySave();
      // 이미 연결된 방송국이 다른 사람으로 확인된 경우, 이름이 비슷한 방송을
      // 다시 검색해 LIVE로 표시하지 않습니다.
      return { name, available: false, isLive: false };
    }
    const status = {
      available: true,
      isLive: Boolean(broadNo),
      broadcastId: channel.broadcastId,
      broadcastUrl: broadNo
        ? "https://play.sooplive.co.kr/" + encodeURIComponent(channel.broadcastId) + "/" + encodeURIComponent(broadNo)
        : channel.broadcastUrl,
      title: String(broad?.broad_title || broad?.title || ""),
      viewerCount: Number(broad?.current_sum_viewer || broad?.current_viewer || broad?.viewer_count || 0),
      thumbnail: broadNo ? "https://liveimg.sooplive.co.kr/m/" + encodeURIComponent(broadNo) : "",
      profileImage: String(data?.profile_image || "")
    };
    liveStatusCache.set(channel.broadcastId, { cacheTime: Date.now(), status });
    return { name, ...status };
  } catch {
    // 등록된 방송국 상태를 확인하지 못했을 때도 이름 유사 검색 결과를 사용하지 않습니다.
    return {
      name,
      available: false,
      isLive: false,
      broadcastId: channel.broadcastId,
      broadcastUrl: channel.broadcastUrl
    };
  }
}

async function fetchSoopLiveStatus(name, force = false) {
  const key = normalizePlayerName(name);
  const cached = liveNameCache.get(key);
  if (!force && cached && Date.now() - cached.cacheTime < LIVE_CACHE_MS) {
    return { ...cached.status, name };
  }
  if (liveStatusPromises.has(key)) return liveStatusPromises.get(key);
  const promise = querySoopLiveStatus(name, force)
    .then((status) => {
      liveNameCache.set(key, { cacheTime: Date.now(), status });
      return status;
    })
    .catch((error) => {
      if (cached?.status) return { ...cached.status, name, stale: true };
      throw error;
    });
  liveStatusPromises.set(key, promise);
  try {
    return await promise;
  } finally {
    liveStatusPromises.delete(key);
  }
}

function sharedLiveStatuses(names) {
  return [...new Set((names || []).map((name) => String(name || "").trim()).filter(Boolean))]
    .slice(0, 200)
    .map((name) => {
      const cached = liveNameCache.get(normalizePlayerName(name));
      if (!cached) return null;
      return { ...cached.status, name, sharedAt: new Date(cached.cacheTime).toISOString() };
    })
    .filter(Boolean);
}

function setupLiveStatusSharing(socketServer) {
  socketServer.on("connection", (socket) => {
    socket.on("live:subscribe", (payload = {}) => {
      const statuses = sharedLiveStatuses(Array.isArray(payload.names) ? payload.names : []);
      if (!statuses.length) return;
      socket.emit("live:statuses", {
        statuses,
        cacheSeconds: Math.round(LIVE_CACHE_MS / 1000),
        updatedAt: new Date().toISOString()
      });
    });
  });
}

function compactDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : "";
}

function matchupFromMenResult(result, main, opponent) {
  const row = result.opponents?.[0];
  const matches = row?.matches || [];
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 90);
  const recent = matches.filter((match) => {
    const date = compactDate(match.date);
    if (!date) return false;
    return new Date(date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6, 8) + "T00:00:00+09:00") >= cutoff;
  });
  const recentWins = recent.filter((match) => match.winner === main).length;
  const recentLosses = recent.filter((match) => match.loser === main).length;
  const latest = compactDate(matches[0]?.date);
  return {
    main,
    opponent,
    total: [row?.wins || 0, row?.losses || 0],
    recent: [recentWins, recentLosses],
    lastPlayed: latest ? latest.slice(0, 4) + "." + latest.slice(4, 6) + "." + latest.slice(6, 8) : "경기 없음",
    maps: matches.slice(0, 6).map((match) => ({ map: match.map, result: match.winner === main ? "승" : "패", date: String(match.date || "").slice(5) }))
  };
}

async function fetchUniversityPair(pair) {
  // 대학 페이지의 문자 티어(갓/킹/잭/조커)는 남성 전적, 숫자 티어는 여성·혼성 전적 체계를 사용한다.
  // 이미지가 없는 선수도 있어 프로필 이미지 경로보다 티어 표기를 우선한다.
  const useMen = !/^\d+$/.test(pair.tier);
  const record = useMen
    ? matchupFromMenResult(await fetchMenRecords({ player1: pair.playerA.name, player2: pair.playerB.name }), pair.playerA.name, pair.playerB.name)
    : await fetchMatchup(pair.playerA.name, pair.playerB.name);
  return { tier: pair.tier, playerA: pair.playerA, playerB: pair.playerB, ...record };
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function tallyRows(rows, key) {
  const wins = rows.reduce((sum, row) => sum + row[key][0], 0);
  const losses = rows.reduce((sum, row) => sum + row[key][1], 0);
  const games = wins + losses;
  return { wins, losses, games, rate: games ? Math.round(wins / games * 1000) / 10 : 0 };
}

function buildUniversityPairs(rosterA, rosterB) {
  return rosterA.flatMap((playerA) => rosterB
    .filter((playerB) => playerB.tier === playerA.tier && playerB.name !== playerA.name)
    .map((playerB) => ({ tier: playerA.tier, playerA, playerB })));
}
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100000) reject(new Error("요청이 너무 큽니다."));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("잘못된 요청입니다.")); }
    });
    req.on("error", reject);
  });
}

const cctvStreamCache = new Map();
const cctvInflight = new Map();
const cctvProxyTokens = new Map();
const cctvProxyUrlTokens = new Map();
const cctvRemoteCache = new Map();
const cctvRemoteInflight = new Map();
const cctvActiveStreams = new Map();
const cctvViewerSessions = new Map();
let cctvRemoteCacheBytes = 0;
let cctvMaintenanceRefreshRunning = false;

function safeCctvBj(value) {
  const bj = String(value || "").trim();
  return /^[a-zA-Z0-9_-]+$/.test(bj) ? bj : "";
}

function cctvPageUrl(bj) {
  return "https://play.sooplive.com/" + encodeURIComponent(bj);
}

function execYtdlpCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command.file, [...command.args, ...args], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message || "").trim()));
      resolve(String(stdout || "").trim());
    });
  });
}

async function runYtdlp(args) {
  const commands = [
    fs.existsSync(BUNDLED_YT_DLP) ? { file: BUNDLED_YT_DLP, args: [] } : null,
    process.env.YT_DLP_PATH ? { file: process.env.YT_DLP_PATH, args: [] } : null,
    { file: "yt-dlp", args: [] },
    { file: "python3", args: ["-m", "yt_dlp"] },
    { file: "python", args: ["-m", "yt_dlp"] },
    { file: "py", args: ["-m", "yt_dlp"] }
  ].filter(Boolean);

  const errors = [];
  for (const command of commands) {
    try {
      return await execYtdlpCommand(command, args);
    } catch (error) {
      const message = String(error.message || error || "");
      errors.push(`${command.file}: ${message}`);
      if (/not currently live|This channel is not currently live|offline|private|members-only|login required|No video formats/i.test(message)) {
        throw new Error(message);
      }
    }
  }
  throw new Error("yt-dlp 실행 파일을 찾지 못했습니다. npm start가 vendor/yt-dlp 설치를 먼저 완료해야 합니다. " + errors.join(" | "));
}

function cctvFormats(info) {
  return (info.formats || [])
    .map((format) => ({
      id: String(format.format_id || ""),
      height: Number(format.height || 0),
      width: Number(format.width || 0),
      tbr: Number(format.tbr || 0),
      fps: Number(format.fps || 0),
      vcodec: String(format.vcodec || ""),
      resolution: String(format.resolution || ""),
      upstreamUrl: String(format.url || "")
    }))
    .filter((format) => format.height > 0 && format.vcodec !== "none")
    .sort((a, b) => (a.height - b.height) || (a.tbr - b.tbr));
}

function cctvPublicMeta(format) {
  if (!format) return null;
  const { upstreamUrl, ...meta } = format;
  return meta;
}

function cctvLow(formats) {
  const low = formats.filter((format) => format.height <= 360);
  return low.length ? low[low.length - 1] : formats[0] || null;
}

function cctvHigh(formats) {
  return formats[formats.length - 1] || null;
}

async function cctvDirectUrl(bj, formatId, fallback) {
  const output = await runYtdlp(["-g", "--no-playlist", "-f", formatId || fallback, cctvPageUrl(bj)]);
  const urls = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!urls.length) throw new Error("스트림 URL을 찾지 못했습니다.");
  return urls[0];
}

function cctvFresh(entry) {
  return entry && Date.now() - entry.refreshedAt < CCTV_STREAM_CACHE_MS;
}

function cctvUsableStale(entry) {
  return entry && Date.now() - entry.refreshedAt < CCTV_STALE_CACHE_MS;
}

async function refreshCctvStream(bj) {
  const running = cctvInflight.get(bj);
  if (running) return running;
  const task = (async () => {
    const raw = await runYtdlp(["-J", "--no-playlist", cctvPageUrl(bj)]);
    const info = JSON.parse(raw);
    const formats = cctvFormats(info);
    const lowMeta = cctvLow(formats);
    const highMeta = cctvHigh(formats);
    if (!lowMeta && !highMeta) throw new Error("재생 가능한 화질을 찾지 못했습니다.");
    const selectedLow = lowMeta || highMeta;
    const selectedHigh = highMeta || lowMeta;
    const [lowUpstream, highUpstream] = await Promise.all([
      selectedLow.upstreamUrl || cctvDirectUrl(bj, selectedLow.id, "worst"),
      selectedHigh.upstreamUrl || cctvDirectUrl(bj, selectedHigh.id, "best")
    ]);
    const entry = {
      bj,
      title: info.title || bj,
      thumbnail: info.thumbnail || "",
      lowMeta: cctvPublicMeta(selectedLow),
      highMeta: cctvPublicMeta(selectedHigh),
      lowUpstream,
      highUpstream,
      refreshedAt: Date.now()
    };
    cctvStreamCache.set(bj, entry);
    return entry;
  })();
  cctvInflight.set(bj, task);
  try {
    return await task;
  } finally {
    cctvInflight.delete(bj);
  }
}

async function getCctvStream(bj, allowStale = false) {
  const entry = cctvStreamCache.get(bj);
  if (cctvFresh(entry)) return entry;
  if (allowStale && cctvUsableStale(entry)) return entry;
  return refreshCctvStream(bj);
}

function cctvPayload(entry) {
  return {
    ok: true,
    bj: entry.bj,
    title: entry.title,
    thumbnail: entry.thumbnail,
    lowMeta: entry.lowMeta,
    highMeta: entry.highMeta,
    lowUrl: "/cctv/stream/" + encodeURIComponent(entry.bj) + "/low/master.m3u8",
    highUrl: "/cctv/stream/" + encodeURIComponent(entry.bj) + "/high/master.m3u8",
    refreshedAt: entry.refreshedAt
  };
}

function cctvToken(remoteUrl, context = null) {
  const url = new URL(remoteUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("bad protocol");
  const existingToken = cctvProxyUrlTokens.get(url.href);
  const existing = existingToken ? cctvProxyTokens.get(existingToken) : null;
  if (existing && existing.expiresAt > Date.now() + 60 * 1000) {
    existing.expiresAt = Date.now() + CCTV_PROXY_TOKEN_MS;
    if (context?.bj) existing.bj = context.bj;
    if (context?.mode) existing.mode = context.mode;
    return "/cctv/proxy/" + existingToken;
  }
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  cctvProxyTokens.set(token, {
    url: url.href,
    expiresAt: Date.now() + CCTV_PROXY_TOKEN_MS,
    bj: context?.bj || "",
    mode: context?.mode || ""
  });
  cctvProxyUrlTokens.set(url.href, token);
  return "/cctv/proxy/" + token;
}

function cleanupCctvTokens() {
  const now = Date.now();
  for (const [token, item] of cctvProxyTokens) {
    if (!item || item.expiresAt < now) {
      cctvProxyTokens.delete(token);
      if (item?.url && cctvProxyUrlTokens.get(item.url) === token) cctvProxyUrlTokens.delete(item.url);
    }
  }
}

function rewriteCctvM3u8(text, baseUrl, context = null) {
  cleanupCctvTokens();
  return String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).map((rawLine) => {
    const line = String(rawLine || "").trim();
    if (!line) return "";
    const rewritten = line.replace(/URI="([^"]+)"/g, (_, uri) => {
      try {
        return 'URI="' + cctvToken(new URL(uri, baseUrl).href, context) + '"';
      } catch {
        return 'URI="' + uri + '"';
      }
    });
    if (rewritten.startsWith("#")) return rewritten;
    try {
      return cctvToken(new URL(rewritten, baseUrl).href, context);
    } catch {
      return rewritten;
    }
  }).join("\n");
}

function markCctvActive(bj, mode) {
  if (!bj) return;
  cctvActiveStreams.set(bj, { bj, mode: mode || "low", lastAccess: Date.now() });
}

function safeCctvSessionId(value) {
  const sessionId = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,100}$/.test(sessionId) ? sessionId : "";
}

function cleanCctvSessionBroadcastIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(safeCctvBj)
    .filter(Boolean))]
    .slice(0, 32);
}

function cleanupCctvViewerSessions() {
  const now = Date.now();
  for (const [sessionId, session] of cctvViewerSessions) {
    if (!session || now - session.lastSeen > CCTV_VIEWER_SESSION_MS) cctvViewerSessions.delete(sessionId);
  }
}

function cctvSessionUsesBj(bj) {
  cleanupCctvViewerSessions();
  for (const session of cctvViewerSessions.values()) {
    if (session.broadcastIds.has(bj)) return true;
  }
  return false;
}

function updateCctvViewerSession(sessionId, broadcastIds) {
  const cleanedSessionId = safeCctvSessionId(sessionId);
  if (!cleanedSessionId) return null;
  const ids = cleanCctvSessionBroadcastIds(broadcastIds);
  const session = {
    sessionId: cleanedSessionId,
    broadcastIds: new Set(ids),
    lastSeen: Date.now()
  };
  cctvViewerSessions.set(cleanedSessionId, session);
  ids.forEach((bj) => markCctvActive(bj, "low"));
  return session;
}

function closeCctvViewerSession(sessionId) {
  const cleanedSessionId = safeCctvSessionId(sessionId);
  if (!cleanedSessionId) return false;
  const session = cctvViewerSessions.get(cleanedSessionId);
  cctvViewerSessions.delete(cleanedSessionId);
  if (session) {
    for (const bj of session.broadcastIds) {
      if (!cctvSessionUsesBj(bj)) cctvActiveStreams.delete(bj);
    }
  }
  return Boolean(session);
}

function cctvLooksPlaylist(remoteUrl, contentType = "") {
  let pathname = "";
  try { pathname = new URL(remoteUrl).pathname.toLowerCase(); } catch {}
  return String(contentType).toLowerCase().includes("mpegurl") || pathname.includes(".m3u8");
}

function cctvRemoteKey(remoteUrl, req) {
  return String(remoteUrl) + "\nrange:" + String(req.headers.range || "");
}

function removeCctvRemoteCache(key) {
  const existing = cctvRemoteCache.get(key);
  if (!existing) return;
  cctvRemoteCache.delete(key);
  cctvRemoteCacheBytes = Math.max(0, cctvRemoteCacheBytes - Number(existing.size || 0));
}

function cleanupCctvRemoteCache() {
  const now = Date.now();
  for (const [key, item] of cctvRemoteCache) {
    if (!item || item.expiresAt <= now) removeCctvRemoteCache(key);
  }
  while (cctvRemoteCache.size > CCTV_REMOTE_CACHE_MAX_ENTRIES || cctvRemoteCacheBytes > CCTV_REMOTE_CACHE_MAX_BYTES) {
    const oldestKey = cctvRemoteCache.keys().next().value;
    if (!oldestKey) break;
    removeCctvRemoteCache(oldestKey);
  }
}

function getCctvRemoteCache(key) {
  const item = cctvRemoteCache.get(key);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    removeCctvRemoteCache(key);
    return null;
  }
  cctvRemoteCache.delete(key);
  cctvRemoteCache.set(key, item);
  return item;
}

function setCctvRemoteCache(key, item) {
  if (!item?.body || item.body.length > 16 * 1024 * 1024) return;
  removeCctvRemoteCache(key);
  const stored = { ...item, size: item.body.length };
  cctvRemoteCache.set(key, stored);
  cctvRemoteCacheBytes += stored.size;
  cleanupCctvRemoteCache();
}

async function fetchCctvRemote(remoteUrl, req, force = false) {
  const key = cctvRemoteKey(remoteUrl, req);
  if (!force) {
    const cached = getCctvRemoteCache(key);
    if (cached) return cached;
    const running = cctvRemoteInflight.get(key);
    if (running) return running;
  }

  const task = (async () => {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CCTV_REMOTE_TIMEOUT_MS);
      try {
        const headers = {
          "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
          "Referer": "https://play.sooplive.com/",
          "Origin": "https://play.sooplive.com",
          "Accept": "*/*"
        };
        if (req.headers.range) headers.Range = req.headers.range;
        const response = await fetch(remoteUrl, { redirect: "follow", headers, signal: controller.signal });
        const contentType = response.headers.get("content-type") || "";
        const body = Buffer.from(await response.arrayBuffer());
        const playlist = cctvLooksPlaylist(response.url || remoteUrl, contentType);
        const result = {
          ok: response.ok,
          status: response.status,
          body,
          contentType,
          finalUrl: response.url || remoteUrl,
          playlist,
          contentRange: response.headers.get("content-range") || "",
          acceptRanges: response.headers.get("accept-ranges") || ""
        };
        if (response.ok) {
          const ttl = playlist ? CCTV_PLAYLIST_CACHE_MS : CCTV_SEGMENT_CACHE_MS;
          setCctvRemoteCache(key, { ...result, expiresAt: Date.now() + ttl });
          return result;
        }
        if (attempt === 1 || (response.status < 500 && response.status !== 429)) return result;
        lastError = new Error("upstream " + response.status);
      } catch (error) {
        lastError = error;
        if (attempt === 1) throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || new Error("cctv upstream failed");
  })();

  cctvRemoteInflight.set(key, task);
  try {
    return await task;
  } finally {
    if (cctvRemoteInflight.get(key) === task) cctvRemoteInflight.delete(key);
  }
}

async function handleCctvStream(req, res, bj, mode) {
  try {
    markCctvActive(bj, mode);
    let entry = await getCctvStream(bj, true);
    let upstreamUrl = mode === "low" ? entry.lowUpstream : entry.highUpstream;
    let upstream = await fetchCctvRemote(upstreamUrl, req);
    if (!upstream.ok) {
      entry = await refreshCctvStream(bj);
      upstreamUrl = mode === "low" ? entry.lowUpstream : entry.highUpstream;
      upstream = await fetchCctvRemote(upstreamUrl, req, true);
    }
    if (!upstream.ok) return send(res, upstream.status, "upstream " + upstream.status);
    const text = upstream.body.toString("utf8");
    return send(
      res,
      200,
      rewriteCctvM3u8(text, upstream.finalUrl || upstreamUrl, { bj, mode }),
      "application/vnd.apple.mpegurl; charset=utf-8",
      { "Cache-Control": "private, max-age=1" }
    );
  } catch (error) {
    refreshCctvStream(bj).catch((refreshError) => console.error("cctv recovery failed:", bj, refreshError.message));
    return send(res, 503, error.message || "cctv stream failed");
  }
}

async function handleCctvProxy(req, res, token) {
  cleanupCctvTokens();
  const item = cctvProxyTokens.get(String(token || ""));
  if (!item) return send(res, 404, "expired token");
  item.expiresAt = Date.now() + CCTV_PROXY_TOKEN_MS;
  markCctvActive(item.bj, item.mode);
  try {
    const upstream = await fetchCctvRemote(item.url, req);
    if (!upstream.ok) {
      if (item.bj) refreshCctvStream(item.bj).catch((error) => console.error("cctv proxy refresh failed:", item.bj, error.message));
      return send(res, upstream.status, "upstream " + upstream.status);
    }
    if (upstream.playlist) {
      const text = upstream.body.toString("utf8");
      return send(
        res,
        200,
        rewriteCctvM3u8(text, upstream.finalUrl || item.url, { bj: item.bj, mode: item.mode }),
        "application/vnd.apple.mpegurl; charset=utf-8",
        { "Cache-Control": "private, max-age=1" }
      );
    }
    const headers = {
      "Content-Type": upstream.contentType || "application/octet-stream",
      "Content-Length": upstream.body.length,
      "Cache-Control": "public, max-age=300, immutable",
      "Access-Control-Allow-Origin": "*"
    };
    if (upstream.contentRange) headers["Content-Range"] = upstream.contentRange;
    if (upstream.acceptRanges) headers["Accept-Ranges"] = upstream.acceptRanges;
    res.writeHead(upstream.status || 200, headers);
    return res.end(upstream.body);
  } catch (error) {
    if (item.bj) refreshCctvStream(item.bj).catch((refreshError) => console.error("cctv proxy recovery failed:", item.bj, refreshError.message));
    return send(res, 503, error.message || "proxy failed");
  }
}

const cctvSharedMaintenanceTimer = setInterval(() => {
  cleanupCctvTokens();
  cleanupCctvRemoteCache();
  cleanupCctvViewerSessions();
  if (cctvMaintenanceRefreshRunning) return;
  const now = Date.now();
  for (const [bj, active] of cctvActiveStreams) {
    if (!active || (now - active.lastAccess > CCTV_ACTIVE_STREAM_MS && !cctvSessionUsesBj(bj))) {
      cctvActiveStreams.delete(bj);
      continue;
    }
    const entry = cctvStreamCache.get(bj);
    if (!entry || now - entry.refreshedAt >= CCTV_STREAM_CACHE_MS) {
      cctvMaintenanceRefreshRunning = true;
      refreshCctvStream(bj)
        .catch((error) => console.error("cctv active refresh failed:", bj, error.message))
        .finally(() => { cctvMaintenanceRefreshRunning = false; });
      break;
    }
  }
}, 5 * 1000);
cctvSharedMaintenanceTimer.unref?.();

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname === "/" ? "/tiers.html" : url.pathname;
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, "Forbidden");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found");
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".webp": "image/webp",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif"
    }[path.extname(file)] || "application/octet-stream";
    const isTierProfile = file.startsWith(path.join(PUBLIC, "tier-profiles") + path.sep);
    res.writeHead(200, {
      "Content-Type": type,
      // 기존 프로필 이미지는 고정하므로 1년 동안 브라우저/CDN 캐시를 사용합니다.
      "Cache-Control": isTierProfile ? "public, max-age=31536000, immutable" : "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(data);
  });
}
function lanUrls(port) {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) urls.push("http://" + entry.address + ":" + port);
    }
  }
  return urls;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const isCctvOnlyPath = /^\/cctv(?:\.(?:html|css|js)|\/)/.test(url.pathname) ||
    url.pathname === "/api/cctv" ||
    url.pathname.startsWith("/api/cctv/");
  if (!CCTV_LOCAL_MODE && isCctvOnlyPath) {
    return send(res, 404, "Not found");
  }
  if (url.pathname === "/healthz" && req.method === "GET") {
    return send(res, 200, JSON.stringify({
      ok: true,
      uptimeSeconds: Math.floor(process.uptime()),
      storage: tierAdmin.storageStatus
    }), "application/json; charset=utf-8");
  }
  if (req.method === "OPTIONS") return send(res, 204, "");
  if (url.pathname === "/api/cctv/session" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const session = updateCctvViewerSession(body.sessionId, body.broadcastIds);
      if (!session) return send(res, 400, JSON.stringify({ ok: false, error: "잘못된 CCTV 접속 정보입니다." }), "application/json; charset=utf-8");
      const sharedBroadcastIds = [...session.broadcastIds].filter((bj) => cctvUsableStale(cctvStreamCache.get(bj)));
      return send(res, 200, JSON.stringify({
        ok: true,
        sessionId: session.sessionId,
        sharedBroadcastIds,
        activeViewers: cctvViewerSessions.size
      }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 400, JSON.stringify({ ok: false, error: error.message || "CCTV 접속 정보를 저장하지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/cctv/session/close" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      closeCctvViewerSession(body.sessionId);
      return send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
    } catch {
      return send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname.startsWith("/api/cctv/bootstrap/") && req.method === "GET") {
    const bj = safeCctvBj(decodeURIComponent(url.pathname.split("/").pop() || ""));
    if (!bj) return send(res, 400, JSON.stringify({ ok: false, error: "잘못된 방송 ID입니다." }), "application/json; charset=utf-8");
    try {
      const entry = await getCctvStream(bj);
      return send(res, 200, JSON.stringify(cctvPayload(entry)), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 500, JSON.stringify({ ok: false, error: error.message || "방송 정보를 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname.startsWith("/api/cctv/high/") && req.method === "GET") {
    const bj = safeCctvBj(decodeURIComponent(url.pathname.split("/").pop() || ""));
    if (!bj) return send(res, 400, JSON.stringify({ ok: false, error: "잘못된 방송 ID입니다." }), "application/json; charset=utf-8");
    try {
      const entry = await getCctvStream(bj, true);
      return send(res, 200, JSON.stringify(cctvPayload(entry)), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 500, JSON.stringify({ ok: false, error: error.message || "방송 정보를 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  {
    const streamMatch = url.pathname.match(/^\/cctv\/stream\/([a-zA-Z0-9_-]+)\/(low|high)\/master\.m3u8$/);
    if (streamMatch && req.method === "GET") {
      return handleCctvStream(req, res, streamMatch[1], streamMatch[2]);
    }
  }
  {
    const proxyMatch = url.pathname.match(/^\/cctv\/proxy\/([a-zA-Z0-9]+)$/);
    if (proxyMatch && req.method === "GET") {
      return handleCctvProxy(req, res, proxyMatch[1]);
    }
  }
  if (url.pathname === "/api/scoreboard-state" && req.method === "GET") {
    try {
      return send(
        res,
        200,
        JSON.stringify(await loadScoreboardState()),
        "application/json; charset=utf-8",
        { "Cache-Control": "no-store" }
      );
    } catch (error) {
      return send(res, 500, JSON.stringify({ error: error.message || "공용 스코어보드를 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/scoreboard-state" && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
        return send(res, 400, JSON.stringify({ error: "저장할 스코어보드 정보가 올바르지 않습니다." }), "application/json; charset=utf-8");
      }
      return send(
        res,
        200,
        JSON.stringify(await saveScoreboardState(body.state)),
        "application/json; charset=utf-8",
        { "Cache-Control": "no-store" }
      );
    } catch (error) {
      return send(res, 500, JSON.stringify({ error: error.message || "공용 스코어보드를 저장하지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/jungman-cup-state" && req.method === "GET") {
    try {
      return send(res, 200, JSON.stringify(await loadJungmanCupState()), "application/json; charset=utf-8", { "Cache-Control": "no-store" });
    } catch (error) {
      return send(res, 500, JSON.stringify({ error: error.message || "공용 중만컵 정보를 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/jungman-cup-state" && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
        return send(res, 400, JSON.stringify({ error: "저장할 중만컵 정보가 올바르지 않습니다." }), "application/json; charset=utf-8");
      }
      return send(res, 200, JSON.stringify(await saveJungmanCupState(body.state)), "application/json; charset=utf-8", { "Cache-Control": "no-store" });
    } catch (error) {
      return send(res, 500, JSON.stringify({ error: error.message || "공용 중만컵 정보를 저장하지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/soop-vote-rankings" && req.method === "GET") {
    try {
      const payload = await loadSoopVoteRankings(url.searchParams.get("refresh") === "1");
      return send(res, 200, JSON.stringify(payload), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({
        error: error.message || "실시간 투표 데이터를 불러오지 못했습니다."
      }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/spawn-diary" && req.method === "GET") {
    if (!tierAdmin.pool) {
      return send(res, 503, JSON.stringify({
        error: "스폰일지 저장소가 연결되지 않았습니다."
      }), "application/json; charset=utf-8");
    }
    try {
      await ensureSpawnDiaryStorage();
      const result = await tierAdmin.pool.query(`
        SELECT id, match_date, game_format, opponent, tier, opponent_race,
          map_name, result, opponent_build, my_build, feedback, reflection,
          keywords, replay_number, source_position
        FROM spawn_diary_entries
        ORDER BY
          match_date DESC NULLS LAST,
          CASE WHEN source_sheet_id = 'eloboard-auto' THEN source_position END ASC NULLS LAST,
          CASE WHEN source_sheet_id IS DISTINCT FROM 'eloboard-auto' THEN source_row END DESC NULLS LAST,
          id DESC
      `);
      return send(res, 200, JSON.stringify({
        entries: result.rows.map((entry) => ({
          ...entry,
          tier: diaryTierLabel(entry.tier),
          opponent_race: diaryRaceLabel(entry.opponent_race)
        })),
        total: result.rowCount,
        updatedAt: new Date().toISOString()
      }), "application/json; charset=utf-8");
    } catch (error) {
      console.error("Spawn diary load failed:", error.code || "UNKNOWN", error.message);
      return send(res, 503, JSON.stringify({
        error: "스폰일지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
      }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/spawn-diary-admin/status" && req.method === "GET") {
    const session = spawnDiaryAdmin.session(req);
    return send(res, 200, JSON.stringify({
      configured: spawnDiaryAdmin.configured,
      authenticated: Boolean(session),
      csrf: session?.csrf || ""
    }), "application/json; charset=utf-8");
  }
  if (url.pathname === "/api/spawn-diary-admin/login" && req.method === "POST") {
    if (!requestIsSameOrigin(req)) {
      return send(res, 403, JSON.stringify({ error: "허용되지 않은 요청입니다." }), "application/json; charset=utf-8");
    }
    try {
      const body = await readJsonBody(req);
      const result = spawnDiaryAdmin.login(req, body.password);
      if (result.error) {
        return send(res, result.status, JSON.stringify({ error: result.error }), "application/json; charset=utf-8");
      }
      return send(res, 200, JSON.stringify({
        authenticated: true,
        csrf: result.session.csrf
      }), "application/json; charset=utf-8", { "Set-Cookie": result.cookie });
    } catch (error) {
      return send(res, 400, JSON.stringify({
        error: error.message || "로그인 요청을 처리하지 못했습니다."
      }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/spawn-diary-admin/lock" && req.method === "POST") {
    if (!requestIsSameOrigin(req)) {
      return send(res, 403, JSON.stringify({ error: "허용되지 않은 요청입니다." }), "application/json; charset=utf-8");
    }
    const session = spawnDiaryAdmin.authorize(req);
    if (!session) {
      return send(res, 401, JSON.stringify({ error: "스폰일지 관리자 로그인이 필요합니다." }), "application/json; charset=utf-8");
    }
    try {
      const body = await readJsonBody(req);
      const result = body.action === "release"
        ? spawnDiaryAdmin.releaseLock(session)
        : (body.action === "heartbeat"
          ? spawnDiaryAdmin.heartbeatLock(session)
          : spawnDiaryAdmin.acquireLock(session));
      return send(res, result.ok ? 200 : 423, JSON.stringify(result.ok ? result : {
        ...result,
        error: "다른 관리자가 기록을 작성 중입니다. 작성이 끝난 뒤 다시 시도해 주세요."
      }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 400, JSON.stringify({
        error: error.message || "작성 권한을 확인하지 못했습니다."
      }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/admin/spawn-diary" && req.method === "POST") {
    const spawnSession = requestIsSameOrigin(req) ? spawnDiaryAdmin.authorize(req) : null;
    if (!spawnSession) {
      return send(res, 403, JSON.stringify({
        error: "스폰일지 관리자 인증이 필요합니다."
      }), "application/json; charset=utf-8");
    }
    if (!spawnDiaryAdmin.holdsLock(spawnSession)) {
      return send(res, 423, JSON.stringify({
        error: "작성 권한 시간이 만료되었습니다. 작성창을 다시 열어 주세요."
      }), "application/json; charset=utf-8");
    }
    if (!tierAdmin.pool) {
      return send(res, 503, JSON.stringify({
        error: "스폰일지 저장소가 연결되지 않았습니다."
      }), "application/json; charset=utf-8");
    }
    let client;
    try {
      const body = await readJsonBody(req);
      const clean = (value, limit) => String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, limit);
      const matchDate = clean(body.matchDate, 10);
      const gameFormat = clean(body.gameFormat, 40) || "스폰";
      const opponent = clean(body.opponent, 80);
      const resultValue = clean(body.result, 10);
      if (matchDate && !/^\d{4}-\d{2}-\d{2}$/.test(matchDate)) {
        return send(res, 400, JSON.stringify({ error: "날짜 형식이 올바르지 않습니다." }), "application/json; charset=utf-8");
      }
      if (!opponent) {
        return send(res, 400, JSON.stringify({ error: "상대 이름을 입력해 주세요." }), "application/json; charset=utf-8");
      }
      if (!["스폰", "CK", "대학대전"].includes(gameFormat)) {
        return send(res, 400, JSON.stringify({
          error: "경기방식은 스폰, CK, 대학대전 중에서 선택해 주세요."
        }), "application/json; charset=utf-8");
      }
      if (!["", "승", "패", "미정"].includes(resultValue)) {
        return send(res, 400, JSON.stringify({ error: "전적은 승, 패, 미정 중에서 선택해 주세요." }), "application/json; charset=utf-8");
      }

      client = await tierAdmin.pool.connect();
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [7310927]);
      const sourceRowResult = await client.query(
        "SELECT COALESCE(MAX(source_row), 0) + 1 AS next_row FROM spawn_diary_entries WHERE source_sheet_id = $1",
        ["site-manual"]
      );
      const insertResult = await client.query(`
        INSERT INTO spawn_diary_entries (
          match_date, game_format, opponent, tier, opponent_race, map_name,
          result, opponent_build, my_build, feedback, reflection, keywords,
          replay_number, source_sheet_id, source_row, source_url
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          $13, $14, $15, NULL
        )
        RETURNING id, match_date, game_format, opponent, tier, opponent_race,
          map_name, result, opponent_build, my_build, feedback, reflection,
          keywords, replay_number
      `, [
        matchDate || null,
        gameFormat,
        opponent,
        diaryTierLabel(body.tier) || null,
        diaryRaceLabel(body.opponentRace) || null,
        clean(body.mapName, 80) || null,
        resultValue || "미정",
        clean(body.opponentBuild, 300) || null,
        clean(body.myBuild, 300) || null,
        clean(body.feedback, 4000) || null,
        clean(body.reflection, 4000) || null,
        clean(body.keywords, 500) || null,
        clean(body.replayNumber, 100) || null,
        "site-manual",
        Number(sourceRowResult.rows[0].next_row)
      ]);
      await client.query("COMMIT");
      spawnDiaryAdmin.heartbeatLock(spawnSession);
      return send(res, 201, JSON.stringify({
        ok: true,
        entry: insertResult.rows[0]
      }), "application/json; charset=utf-8");
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      return send(res, error.statusCode || 500, JSON.stringify({
        error: error.message || "경기 기록을 저장하지 못했습니다."
      }), "application/json; charset=utf-8");
    } finally {
      client?.release();
    }
  }
  const spawnDiaryEntryMatch = url.pathname.match(/^\/api\/admin\/spawn-diary\/(\d+)$/);
  if (spawnDiaryEntryMatch && (req.method === "PUT" || req.method === "DELETE")) {
    const spawnSession = requestIsSameOrigin(req) ? spawnDiaryAdmin.authorize(req) : null;
    if (!spawnSession) {
      return send(res, 403, JSON.stringify({
        error: "스폰일지 관리자 인증이 필요합니다."
      }), "application/json; charset=utf-8");
    }
    if (!spawnDiaryAdmin.holdsLock(spawnSession)) {
      return send(res, 423, JSON.stringify({
        error: "작성 권한 시간이 만료되었습니다. 수정창을 다시 열어 주세요."
      }), "application/json; charset=utf-8");
    }
    if (!tierAdmin.pool) {
      return send(res, 503, JSON.stringify({
        error: "스폰일지 저장소가 연결되지 않았습니다."
      }), "application/json; charset=utf-8");
    }
    const entryId = Number(spawnDiaryEntryMatch[1]);
    try {
      if (req.method === "DELETE") {
        const deleteResult = await tierAdmin.pool.query(`
          WITH deleted AS (
            DELETE FROM spawn_diary_entries
            WHERE id = $1
            RETURNING id
          ), cleared_seen AS (
            DELETE FROM spawn_diary_auto_seen AS seen
            USING deleted
            WHERE seen.imported_entry_id = deleted.id
            RETURNING seen.source_key
          )
          SELECT id FROM deleted
        `, [entryId]);
        if (!deleteResult.rowCount) {
          return send(res, 404, JSON.stringify({ error: "삭제할 기록을 찾지 못했습니다." }), "application/json; charset=utf-8");
        }
        spawnDiaryAdmin.heartbeatLock(spawnSession);
        return send(res, 200, JSON.stringify({ ok: true, deletedId: entryId }), "application/json; charset=utf-8");
      }

      const body = await readJsonBody(req);
      const clean = (value, limit) => String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, limit);
      const matchDate = clean(body.matchDate, 10);
      const gameFormat = clean(body.gameFormat, 40) || "스폰";
      const opponent = clean(body.opponent, 80);
      const resultValue = clean(body.result, 10);
      if (matchDate && !/^\d{4}-\d{2}-\d{2}$/.test(matchDate)) {
        return send(res, 400, JSON.stringify({ error: "날짜 형식이 올바르지 않습니다." }), "application/json; charset=utf-8");
      }
      if (!opponent) {
        return send(res, 400, JSON.stringify({ error: "상대 이름을 입력해 주세요." }), "application/json; charset=utf-8");
      }
      if (!["스폰", "CK", "대학대전"].includes(gameFormat)) {
        return send(res, 400, JSON.stringify({
          error: "경기방식은 스폰, CK, 대학대전 중에서 선택해 주세요."
        }), "application/json; charset=utf-8");
      }
      if (!["", "승", "패", "미정"].includes(resultValue)) {
        return send(res, 400, JSON.stringify({
          error: "전적은 승, 패, 미정 중에서 선택해 주세요."
        }), "application/json; charset=utf-8");
      }
      const updateResult = await tierAdmin.pool.query(`
        UPDATE spawn_diary_entries
        SET match_date = $1, game_format = $2, opponent = $3, tier = $4,
          opponent_race = $5, map_name = $6, result = $7, opponent_build = $8,
          my_build = $9, feedback = $10, reflection = $11, keywords = $12,
          replay_number = $13, updated_at = NOW()
        WHERE id = $14
        RETURNING id, match_date, game_format, opponent, tier, opponent_race,
          map_name, result, opponent_build, my_build, feedback, reflection,
          keywords, replay_number
      `, [
        matchDate || null,
        gameFormat,
        opponent,
        diaryTierLabel(body.tier) || null,
        diaryRaceLabel(body.opponentRace) || null,
        clean(body.mapName, 80) || null,
        resultValue || "미정",
        clean(body.opponentBuild, 300) || null,
        clean(body.myBuild, 300) || null,
        clean(body.feedback, 4000) || null,
        clean(body.reflection, 4000) || null,
        clean(body.keywords, 500) || null,
        clean(body.replayNumber, 100) || null,
        entryId
      ]);
      if (!updateResult.rowCount) {
        return send(res, 404, JSON.stringify({ error: "수정할 기록을 찾지 못했습니다." }), "application/json; charset=utf-8");
      }
      spawnDiaryAdmin.heartbeatLock(spawnSession);
      return send(res, 200, JSON.stringify({
        ok: true,
        entry: updateResult.rows[0]
      }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, error.statusCode || 500, JSON.stringify({
        error: error.message || "경기 기록을 변경하지 못했습니다."
      }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/admin/status" && req.method === "GET") {
    const session = tierAdmin.session(req);
    return send(res, 200, JSON.stringify({
      configured: tierAdmin.configured,
      authenticated: Boolean(session),
      csrf: session?.csrf || "",
      storage: tierAdmin.storageStatus
    }), "application/json; charset=utf-8");
  }
  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    if (!requestIsSameOrigin(req)) {
      return send(res, 403, JSON.stringify({ error: "허용되지 않은 요청입니다." }), "application/json; charset=utf-8");
    }
    try {
      const body = await readJsonBody(req);
      const result = tierAdmin.login(req, body.password);
      if (result.error) {
        return send(res, result.status, JSON.stringify({ error: result.error }), "application/json; charset=utf-8");
      }
      return send(res, 200, JSON.stringify({
        authenticated: true,
        csrf: result.session.csrf,
        storage: tierAdmin.storageStatus
      }), "application/json; charset=utf-8", { "Set-Cookie": result.cookie });
    } catch (error) {
      return send(res, 400, JSON.stringify({ error: error.message || "로그인 요청을 처리하지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/admin/logout" && req.method === "POST") {
    if (!requestIsSameOrigin(req) || !tierAdmin.authorize(req)) {
      return send(res, 403, JSON.stringify({ error: "관리자 인증이 필요합니다." }), "application/json; charset=utf-8");
    }
    return send(res, 200, JSON.stringify({ authenticated: false }), "application/json; charset=utf-8", {
      "Set-Cookie": tierAdmin.logout(req)
    });
  }
  if (url.pathname === "/api/admin/tier-memberships" && req.method === "GET") {
    const session = tierAdmin.session(req);
    if (!session) {
      return send(res, 401, JSON.stringify({ error: "관리자 로그인이 필요합니다." }), "application/json; charset=utf-8");
    }
    return send(res, 200, JSON.stringify({
      overrides: tierAdmin.listOverrides(),
      csrf: session.csrf,
      storage: tierAdmin.storageStatus
    }), "application/json; charset=utf-8");
  }
  if (url.pathname === "/api/admin/tier-players" && req.method === "POST") {
    if (!requestIsSameOrigin(req) || !tierAdmin.authorize(req)) {
      return send(res, 403, JSON.stringify({ error: "관리자 인증이 필요합니다." }), "application/json; charset=utf-8");
    }
    try {
      const body = await readJsonBody(req);
      const playerName = String(body.playerName || "").replace(/\s+/g, " ").trim().slice(0, 40);
      const sourcePlayers = await loadTierRoster(false);
      const exists = tierAdmin.applyOverrides(sourcePlayers).some((player) =>
        normalizeName(player.name) === normalizeName(playerName));
      if (!playerName) {
        return send(res, 400, JSON.stringify({ error: "새 선수 이름을 입력해 주세요." }), "application/json; charset=utf-8");
      }
      if (exists) {
        return send(res, 409, JSON.stringify({ error: "이미 등록된 선수 이름입니다." }), "application/json; charset=utf-8");
      }
      const channelFromUrl = soopChannelFromHtml(String(body.broadcastId || ""));
      const override = await tierAdmin.setOverride(playerName, {
        universities: Array.isArray(body.universities) ? body.universities : [body.university],
        tier: body.tier,
        promotionLight: body.promotionLight === true,
        isCustom: true,
        race: body.race,
        broadcastId: channelFromUrl?.broadcastId || body.broadcastId
      });
      const player = tierAdmin.applyOverrides(sourcePlayers).find((item) =>
        normalizeName(item.name) === normalizeName(playerName));
      return send(res, 201, JSON.stringify({
        ok: true,
        override,
        player,
        storage: tierAdmin.storageStatus
      }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, error.statusCode || 400, JSON.stringify({
        error: error.message || "새 선수를 등록하지 못했습니다.",
        code: error.code || ""
      }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/admin/tier-memberships" && (req.method === "PUT" || req.method === "DELETE")) {
    if (!requestIsSameOrigin(req) || !tierAdmin.authorize(req)) {
      return send(res, 403, JSON.stringify({ error: "관리자 인증이 필요합니다." }), "application/json; charset=utf-8");
    }
    try {
      const body = await readJsonBody(req);
      const playerName = String(body.playerName || "").trim();
      const sourcePlayers = await loadTierRoster(false);
      const currentPlayer = tierAdmin.applyOverrides(sourcePlayers).find((player) =>
        normalizeName(player.name) === normalizeName(playerName));
      if (!currentPlayer) {
        return send(res, 404, JSON.stringify({ error: "현재 티어 명단에서 선수를 찾지 못했습니다." }), "application/json; charset=utf-8");
      }
      if (req.method === "DELETE") {
        await tierAdmin.deleteOverride(playerName);
        return send(res, 200, JSON.stringify({
          ok: true,
          reverted: true,
          storage: tierAdmin.storageStatus
        }), "application/json; charset=utf-8");
      }
      const override = await tierAdmin.setOverride(playerName, {
        universities: Array.isArray(body.universities) ? body.universities : currentPlayer.universities,
        tier: body.tier == null ? currentPlayer.tier : body.tier,
        promotionLight: body.promotionLight == null
          ? Boolean(currentPlayer.promotionLight)
          : body.promotionLight === true,
        isCustom: Boolean(currentPlayer.customPlayer),
        race: currentPlayer.race,
        broadcastId: currentPlayer.broadcastId
      });
      return send(res, 200, JSON.stringify({
        ok: true,
        override,
        storage: tierAdmin.storageStatus
      }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, error.statusCode || 400, JSON.stringify({
        error: error.message || "선수 정보를 변경하지 못했습니다.",
        code: error.code || ""
      }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/tiers" && req.method === "GET") {
    try {
      const force = url.searchParams.get("refresh") === "1";
      let players = await loadTierRoster(force);
      if (!force && url.searchParams.get("wait") === "1" && tierRosterPromise) {
        players = await tierRosterPromise;
      }
      const visiblePlayers = addTierCctvSources(tierAdmin.applyOverrides(players));
      return send(res, 200, JSON.stringify({
        players: visiblePlayers,
        liveStatuses: sharedLiveStatuses(visiblePlayers.map((player) => player.name)),
        source: UNIVERSITY_LIST_URL,
        updatedAt: new Date(tierRosterCache?.cacheTime || Date.now()).toISOString(),
        refreshing: Boolean(tierRosterPromise)
      }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message || "티어 명단을 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/live-status" && (req.method === "GET" || req.method === "POST")) {
    try {
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      const force = url.searchParams.get("refresh") === "1" || body.refresh === true;
      const requestedNames = Array.isArray(body.names)
        ? body.names
        : String(url.searchParams.get("names") || "").split(",");
      const names = [...new Set(requestedNames
        .map((name) => String(name || ""))
        .map((name) => name.trim())
        .filter(Boolean))];
      // 현재 티어표 전체 명단이 200명을 넘습니다. 전체 명단 조회가 400으로 막혀
      // LIVE 배지가 전부 사라지는 일을 막기 위해 티어표 규모까지 허용합니다.
      if (!names.length || names.length > 350) {
        return send(res, 400, JSON.stringify({ error: "방송 상태는 선수 1~350명까지 조회할 수 있습니다." }), "application/json; charset=utf-8");
      }
      const prioritizedNames = [...names].sort((nameA, nameB) => {
        return Number(Boolean(manualSoopAlias(nameB))) - Number(Boolean(manualSoopAlias(nameA)));
      });
      const prioritizedStatuses = await mapConcurrent(prioritizedNames, 10, (name) => fetchSoopLiveStatus(name, force));
      const statusByName = new Map(prioritizedStatuses.map((status) => [normalizePlayerName(status.name), status]));
      const statuses = names.map((name) => statusByName.get(normalizePlayerName(name)) || {
        name,
        available: false,
        isLive: false
      });
      io.emit("live:statuses", {
        statuses,
        cacheSeconds: Math.round(LIVE_CACHE_MS / 1000),
        updatedAt: new Date().toISOString()
      });
      return send(res, 200, JSON.stringify({
        statuses,
        cacheSeconds: Math.round(LIVE_CACHE_MS / 1000),
        updatedAt: new Date().toISOString()
      }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message || "방송 상태를 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/universities" && req.method === "GET") {
    try {
      const force = url.searchParams.get("refresh") === "1";
      const universities = await loadUniversities(force);
      return send(res, 200, JSON.stringify({ universities, source: UNIVERSITY_LIST_URL, updatedAt: new Date().toISOString() }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message || "대학 목록을 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/universities/roster" && req.method === "GET") {
    try {
      const name = String(url.searchParams.get("name") || "").trim();
      const universities = await loadUniversities();
      if (!universities.some((item) => item.name === name)) return send(res, 400, JSON.stringify({ error: "지원하는 대학을 선택해 주세요." }), "application/json; charset=utf-8");
      const players = await loadUniversityRoster(name, url.searchParams.get("refresh") === "1");
      return send(res, 200, JSON.stringify({ university: name, players, source: UNIVERSITY_LIST_URL, updatedAt: new Date().toISOString() }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message || "대학 선수 명단을 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/universities/matchup" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const universityA = String(body.universityA || "").trim();
      const universityB = String(body.universityB || "").trim();
      if (!universityA || !universityB || universityA === universityB) return send(res, 400, JSON.stringify({ error: "서로 다른 두 대학을 선택해 주세요." }), "application/json; charset=utf-8");
      const universities = await loadUniversities();
      const allowed = new Set(universities.map((item) => item.name));
      if (!allowed.has(universityA) || !allowed.has(universityB)) return send(res, 400, JSON.stringify({ error: "지원하는 대학을 선택해 주세요." }), "application/json; charset=utf-8");
      const [rosterA, rosterB] = await Promise.all([loadUniversityRoster(universityA), loadUniversityRoster(universityB)]);
      const pairs = buildUniversityPairs(rosterA, rosterB);
      if (pairs.length > 200) return send(res, 400, JSON.stringify({ error: "동일 티어 대결 조합이 200개를 초과합니다." }), "application/json; charset=utf-8");
      const rows = await mapConcurrent(pairs, 4, fetchUniversityPair);
      const tierOrder = [...new Set(pairs.map((pair) => pair.tier))];
      const tiers = tierOrder.map((tier) => {
        const tierRows = rows.filter((row) => row.tier === tier);
        return { tier, pairCount: tierRows.length, total: tallyRows(tierRows, "total"), recent: tallyRows(tierRows, "recent") };
      });
      return send(res, 200, JSON.stringify({
        universityA,
        universityB,
        rosters: { a: rosterA, b: rosterB },
        pairCount: rows.length,
        total: tallyRows(rows, "total"),
        recent: tallyRows(rows, "recent"),
        tiers,
        rows,
        source: UNIVERSITY_LIST_URL,
        updatedAt: new Date().toISOString()
      }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message || "대학대결 전적을 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/men/options" && req.method === "GET") {
    try {
      const options = await loadMenOptions();
      return send(res, 200, JSON.stringify({ ...options, source: MEN_LIST_URL, updatedAt: new Date().toISOString() }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message || "남성 선수 목록을 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/men/records" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const filters = { startDate: String(body.startDate || "").trim(), endDate: String(body.endDate || "").trim(), player1: String(body.player1 || "").trim(), player2: String(body.player2 || "").trim(), map: String(body.map || "").trim(), memo: String(body.memo || "").trim(), inputBy: String(body.inputBy || "").trim(), proLeague: body.proLeague === true };
      if (!filters.player1 && !filters.player2 && !filters.map && !filters.memo && !filters.inputBy && !filters.startDate && !filters.endDate && !filters.proLeague) return send(res, 400, JSON.stringify({ error: "선수 또는 검색 조건을 하나 이상 선택해 주세요." }), "application/json; charset=utf-8");
      const result = await fetchMenRecords(filters);
      return send(res, 200, JSON.stringify({ ...result, filters, source: MEN_LIST_URL, updatedAt: new Date().toISOString() }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message || "남성전적을 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/matchup/players" && req.method === "GET") {
    try {
      const players = await loadMatchupPlayers();
      return send(res, 200, JSON.stringify({ players, updatedAt: new Date().toISOString() }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message || "선수 목록을 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/matchup/recommendations" && req.method === "GET") {
    try {
      const main = String(url.searchParams.get("main") || "").trim();
      if (!main) return send(res, 400, JSON.stringify({ error: "기준 선수 이름을 입력해 주세요." }), "application/json; charset=utf-8");
      const profile = await findMatchupProfile(main);
      if (!profile) return send(res, 404, JSON.stringify({ error: "선수 프로필을 찾지 못했습니다." }), "application/json; charset=utf-8");
      const recommendations = recentOpponentRecommendations(profile);
      return send(res, 200, JSON.stringify({ main: profile.name || main, recommendations, updatedAt: new Date().toISOString() }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message || "최근 상대 목록을 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/matchup/photos" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const names = Array.isArray(body.names) ? body.names : [];
      if (!names.length || names.length > 24) {
        return send(res, 400, JSON.stringify({ error: "사진을 조회할 선수는 최대 24명까지 선택할 수 있습니다." }), "application/json; charset=utf-8");
      }
      const photos = await loadMatchupPhotos(names);
      return send(res, 200, JSON.stringify({ photos, updatedAt: new Date().toISOString() }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message || "선수 사진을 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/matchup/records" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      let pairs;
      if (Array.isArray(body.pairs)) {
        pairs = body.pairs.map((pair) => ({
          main: String(pair?.main || "").trim(),
          opponent: String(pair?.opponent || "").trim()
        })).filter((pair) => pair.main && pair.opponent && pair.main !== pair.opponent);
        if (!pairs.length || pairs.length > 12) {
          return send(res, 400, JSON.stringify({ error: "A팀과 B팀 선수 짝을 1개 이상, 최대 12개까지 입력해 주세요." }), "application/json; charset=utf-8");
        }
      } else {
        const mains = (Array.isArray(body.mains) && body.mains.length ? body.mains : [body.main]).filter(Boolean).map((value) => String(value).trim()).filter(Boolean);
        const opponents = (Array.isArray(body.opponents) ? body.opponents : []).map((value) => String(value).trim()).filter(Boolean);
        if (!mains.length || !opponents.length || mains.length > 6 || opponents.length > 12 || mains.length * opponents.length > 36) {
          return send(res, 400, JSON.stringify({ error: "기준 선수는 최대 6명, 전체 대결 조합은 최대 36개까지 가능합니다." }), "application/json; charset=utf-8");
        }
        pairs = mains.flatMap((main) => opponents.filter((opponent) => opponent !== main).map((opponent) => ({ main, opponent })));
      }
      const rows = await Promise.all(pairs.map(({ main, opponent }) => fetchMatchup(main, opponent)));
      return send(res, 200, JSON.stringify({ rows, source: "eloboard.com", updatedAt: new Date().toISOString() }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message || "eloboard 전적을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/player-analysis" && req.method === "GET") {
    try {
      const wrId = String(url.searchParams.get("wr_id") || "").trim();
      if (!/^\d+$/.test(wrId)) {
        return send(res, 400, JSON.stringify({ error: "올바른 선수 wr_id가 필요합니다." }), "application/json; charset=utf-8");
      }
      await ensurePlayerAnalysisStore();
      const profile = await loadProfile(wrId, url.searchParams.get("refresh") === "1");
      if (!profile) {
        return send(res, 404, JSON.stringify({ error: "선수 전적 데이터를 찾지 못했습니다." }), "application/json; charset=utf-8");
      }
      const saved = playerAnalysisStore.get(wrId);
      const analysis = analyzePlayer(profile, saved?.communitySummary || "");
      await playerAnalysisStore.saveAnalysis(wrId, profile.name, analysis);
      return send(res, 200, JSON.stringify(analysis), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message || "선수 경기력 분석에 실패했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/player-analysis/community" && req.method === "PUT") {
    if (!requestIsSameOrigin(req) || !tierAdmin.authorize(req)) {
      return send(res, 403, JSON.stringify({ error: "관리자 인증이 필요합니다." }), "application/json; charset=utf-8");
    }
    try {
      tierAdmin.assertWritableStorage();
      await ensurePlayerAnalysisStore();
      const body = await readJsonBody(req);
      const wrId = String(body.wrId || "").trim();
      if (!/^\d+$/.test(wrId)) {
        return send(res, 400, JSON.stringify({ error: "올바른 선수 wr_id가 필요합니다." }), "application/json; charset=utf-8");
      }
      const profile = await loadProfile(wrId, false);
      if (!profile) {
        return send(res, 404, JSON.stringify({ error: "선수 전적 데이터를 찾지 못했습니다." }), "application/json; charset=utf-8");
      }
      const communitySummary = String(body.communitySummary || "").replace(/\s+/g, " ").trim().slice(0, 1000);
      await playerAnalysisStore.saveCommunity(wrId, profile.name, communitySummary);
      const analysis = analyzePlayer(profile, communitySummary);
      await playerAnalysisStore.saveAnalysis(wrId, profile.name, analysis);
      return send(res, 200, JSON.stringify({ ok: true, analysis }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, error.statusCode || 500, JSON.stringify({
        error: error.message || "커뮤니티 평가를 저장하지 못했습니다."
      }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/data") {
    try {
      const force = url.searchParams.get("refresh") === "1";
      const query = String(url.searchParams.get("name") || "").trim();
      if (query.length > 40) {
        return send(res, 400, JSON.stringify({ error: "선수 이름은 40자 이내로 입력해 주세요." }), "application/json; charset=utf-8");
      }
      const requestedWrId = url.searchParams.get("wr_id");
      if (url.searchParams.get("profileOnly") === "1" && requestedWrId) {
        const profile = url.searchParams.get("division") === "men"
          ? await loadMenProfile(requestedWrId, force, query)
          : await loadProfile(requestedWrId, force);
        const autoDiarySync = await syncSpawnDiaryNow(query, profile);
        const players = profile ? [{ name: profile.name, wrId: profile.wrId, url: profile.url, source: "profile" }] : [];
        const data = { source: BOARD_URL, fetchedAt: new Date().toISOString(), pagesLoaded: 0, requestedPages: 0, siteMaxPages: 0, matches: [], profileOnly: true };
        const result = summarize([], query);
        return send(res, 200, JSON.stringify({
          ...data,
          ...result,
          players,
          profile,
          autoDiarySync,
          resultState: profile ? "found" : "empty"
        }, null, 2), "application/json; charset=utf-8");
      }
      // 남성전적은 별도 게시판을 사용하므로 여성 게시판을 읽지 못해도 검색을 계속합니다.
      const dataPromise = loadData(url.searchParams.get("pages"), force).catch((error) => {
        if (query) {
          console.warn("Women board unavailable; continuing with player search:", error.message);
          return { source: BOARD_URL, fetchedAt: new Date().toISOString(), pagesLoaded: 0, requestedPages: 0, siteMaxPages: 0, matches: [] };
        }
        throw error;
      });
      const indexPromise = query
        ? searchAllPlayerCandidates(query, force)
        : Promise.resolve([]);
      const [data, indexedPlayers] = await Promise.all([dataPromise, indexPromise]);
      const result = summarize(data.matches, query);
      let players = [];
      let profile = null;
      if (query) {
        players = findPlayers(query, data.matches, indexedPlayers);
        if (!players.length && !force) {
          players = await searchAllPlayerCandidates(query, true);
        }
        const selected = requestedWrId ? players.find((player) => player.wrId === requestedWrId) || { wrId: requestedWrId } : players[0];
        if (selected?.wrId) {
          profile = selected.division === "men" || /\/men\//i.test(String(selected.url || ""))
            ? await loadMenProfile(selected.wrId, force, selected.name)
            : await loadProfile(selected.wrId, force);
        }
        if (!profile) {
          const cachedProfile = await cachedProfileForName(query);
          if (cachedProfile) {
            profile = cachedProfile;
            players = [{ name: profile.name, wrId: profile.wrId, url: profile.url, source: "saved-profile" }];
          }
        }
      }
      const autoDiarySync = await syncSpawnDiaryNow(query, profile);
      return send(res, 200, JSON.stringify({
        ...data,
        ...result,
          players,
          profile,
          autoDiarySync,
          cached: Boolean(profile?.cached),
          cacheNotice: profile?.cached
            ? "ELOBoard 연결이 제한되어 마지막 정상 전적을 표시합니다. 자동 재시도는 하지 않습니다."
            : "",
          resultState: query ? (profile ? "found" : "empty") : "found"
      }, null, 2), "application/json; charset=utf-8");
    } catch (error) {
      const query = String(url.searchParams.get("name") || "").trim();
      const cachedProfile = await cachedProfileForName(query);
      if (cachedProfile) {
        return send(res, 200, JSON.stringify({
          source: BOARD_URL,
          fetchedAt: new Date().toISOString(),
          pagesLoaded: 0,
          requestedPages: 0,
          siteMaxPages: 0,
          matches: [],
          players: [{ name: cachedProfile.name, wrId: cachedProfile.wrId, url: cachedProfile.url, source: "saved-profile" }],
          profile: cachedProfile,
          cached: true,
          cacheNotice: "ELOBoard 연결이 제한되어 마지막 정상 전적을 표시합니다. 자동 재시도는 하지 않습니다.",
          resultState: "found"
        }, null, 2), "application/json; charset=utf-8");
      }
      return send(res, 502, JSON.stringify({ error: error.message }, null, 2), "application/json; charset=utf-8");
    }
  }
  serveStatic(req, res);
});

const io = new SocketIOServer(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
  maxHttpBufferSize: 200000,
  transports: ["polling", "websocket"]
});
setupLiveStatusSharing(io);

let tierAdminRetryTimer = null;

async function initializeTierAdminStorage() {
  try {
    await tierAdmin.init();
    playerAnalysisReady = false;
    await ensurePlayerAnalysisStore();
    clearTimeout(tierAdminRetryTimer);
    tierAdminRetryTimer = null;
  } catch (error) {
    console.error("Tier admin database unavailable; web server remains online:", error.message);
    clearTimeout(tierAdminRetryTimer);
    tierAdminRetryTimer = setTimeout(initializeTierAdminStorage, DATABASE_RETRY_MS);
    tierAdminRetryTimer.unref?.();
  }
}

if (!CCTV_LOCAL_MODE) {
  setupCollaboration(io).catch((error) => {
    console.error("Collaboration storage initialization failed; web server remains online:", error.message);
  });
  initializeTierAdminStorage();
}

if (CCTV_LOCAL_MODE) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log("ELO CCTV local app: http://127.0.0.1:" + PORT + "/cctv.html");
  });
} else {
  server.listen(PORT, "0.0.0.0", () => {
    console.log("ELOBoard board search app: http://localhost:" + PORT);
    for (const url of lanUrls(PORT)) console.log("LAN: " + url);
  });
}

module.exports = { server, io, tierAdmin, spawnDiaryAdmin };

