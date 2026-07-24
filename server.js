const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { Server: SocketIOServer } = require("socket.io");
const { setupCollaboration } = require("./collaboration-server");
const { normalizeBjListPlayerText } = require("./eloboard-utils");
const { TierAdmin } = require("./tier-admin");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const BOARD_URL = "https://eloboard.com/women/bbs/board.php?bo_table=bj_board";
const BJ_LIST_URL = "https://eloboard.com/women/bbs/board.php?bo_table=bj_list";
const MATCHUP_LIST_URL = "https://eloboard.com/women/bbs/board.php?bo_table=search_list";
const MATCHUP_SEARCH_URL = "https://eloboard.com/women/bbs/search_bj_list.php";
const MEN_LIST_URL = "https://eloboard.com/men/bbs/board.php?bo_table=search_list";
const MEN_SEARCH_URL = "https://eloboard.com/men/bbs/search_bj_list.php";
const UNIVERSITY_LIST_URL = "https://eloboard.com/univ/bbs/board.php?bo_table=all_bj_list";
const SOOP_STATION_API = "https://chapi.sooplive.co.kr/api";
const SOOP_LIVE_SEARCH_API = "https://sch.sooplive.co.kr/api.php";
const SOOP_CHANNEL_FILE = path.join(ROOT, "data", "soop-channels.json");
const SOOP_ALIAS_FILE = path.join(ROOT, "data", "soop-aliases.json");
const TIER_ROSTER_FILE = path.join(ROOT, "data", "tier-roster.json");
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
  }
};
const PINNED_TIER_DISPLAY_NAMES = {
  "핑핑": "핑핑♥"
};
const PORT = Number(process.env.PORT || 5177);
const DEFAULT_PAGES = 10;
const MAX_PAGES = 40;
let cache = new Map();
let dataPromises = new Map();
let playerIndexCache = null;
let playerIndexPromise = null;
let profileCache = new Map();
let profilePromises = new Map();
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
let channelRegistrySaveTimer = null;
const CACHE_MS = 1000 * 60 * 3;
const LIVE_CACHE_MS = 1000 * 15;
const CHANNEL_CACHE_MS = 1000 * 60 * 60 * 24;
const UPSTREAM_TIMEOUT_MS = 1000 * 8;
const tierAdmin = new TierAdmin();

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
  const savedTierRoster = JSON.parse(fs.readFileSync(TIER_ROSTER_FILE, "utf8"));
  if (Array.isArray(savedTierRoster?.players) && savedTierRoster.players.length) {
    tierRosterCache = {
      cacheTime: Number(new Date(savedTierRoster.updatedAt)) || 0,
      players: savedTierRoster.players
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
function normalizePlayerName(name) {
  return normalizeName(name).replace(/[tzp]$/i, "");
}
function normalizeSoopName(name) {
  return normalizePlayerName(name)
    .replace(/^(?:bj|af|soop)+/i, "")
    .replace(/[^0-9a-z가-힣]/gi, "");
}
function manualSoopAlias(name) {
  return channelAliases[normalizePlayerName(name)] || null;
}
function allowedSoopNames(name) {
  const alias = manualSoopAlias(name);
  return [...new Set([
    name,
    alias?.searchName,
    ...(Array.isArray(alias?.stationNames) ? alias.stationNames : [])
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
function parseProfileRows(html) {
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
    rows.push({
      date,
      opponent,
      opponentId: opponentLink ? wrIdFromUrl(opponentLink[1]) : "",
      opponentUrl: opponentLink ? absoluteUrl(opponentLink[1].replace(/&amp;/g, "&")) : "",
      map: cleanText(cells[2]),
      elo: Number(cleanText(cells[3]).replace(/[,]/g, "")),
      eloText: cleanText(cells[3]),
      format: cleanText(cells[4]),
      memo: cleanText(cells[5]),
      url: dateLink ? absoluteUrl(dateLink[1].replace(/&amp;/g, "&")) : ""
    });
  }
  return rows;
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
function parseProfile(html, wrId) {
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
  const profileRows = parseProfileRows(html);
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
    url: playerUrl(wrId),
    image: profileImageFromHtml(html),
    broadcastId: soop?.broadcastId || "",
    broadcastUrl: soop?.broadcastUrl || "",
    info,
    total,
    women,
    mixed,
    records: recordLines,
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
      const response = await fetchWithRetry(playerUrl(wrId), { headers: { "User-Agent": "Mozilla/5.0 eloboard-women-search", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" } });
      if (!response.ok) throw new Error("profile " + wrId + " response error: " + response.status);
      const profile = parseProfile(await response.text(), wrId);
      if (!profile || String(profile.wrId) !== cacheKey || !String(profile.name || "").trim()) {
        throw new Error("profile " + wrId + " response validation failed");
      }
      profileCache.set(cacheKey, { cacheTime: Date.now(), profile });
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
  for (const player of rosters.flat()) {
    if ((!/^\d+$/.test(player.tier) && player.tier !== "FA") || player.division !== "women") continue;
    const pinnedName = PINNED_TIER_DISPLAY_NAMES[normalizeName(player.name)] || player.name;
    const rosterPlayer = pinnedName === player.name ? player : { ...player, name: pinnedName };
    const key = normalizeName(rosterPlayer.name);
    const current = players.get(key);
    if (!current) {
      players.set(key, { ...rosterPlayer, universities: [rosterPlayer.university] });
    } else if (!current.universities.includes(rosterPlayer.university)) {
      current.universities.push(rosterPlayer.university);
    }
  }
  const tierRank = (tier) => tier === "FA" ? Number.MAX_SAFE_INTEGER : Number(tier);
  const data = [...players.values()].sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name, "ko"));
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

function tierProfileAssets(player) {
  const key = normalizePlayerName(player?.name);
  const pinnedId = String(manualSoopAlias(player?.name)?.broadcastId || "").trim();
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

async function discoverSoopChannel(name) {
  const key = normalizePlayerName(name);
  const aliasId = String(manualSoopAlias(name)?.broadcastId || "");
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
    const pinnedBroadcastId = String(alias?.broadcastId || "");
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
    const pinnedBroadcastId = String(manualSoopAlias(name)?.broadcastId || "");
    const usesPinnedChannel = Boolean(pinnedBroadcastId) && pinnedBroadcastId === channel.broadcastId;
    if (!usesPinnedChannel && stationNames.length && !stationNames.some((stationName) => acceptedNames.includes(stationName))) {
      const key = normalizePlayerName(name);
      channelRegistry[key] = null;
      channelCache.delete(key);
      liveStatusCache.delete(channel.broadcastId);
      scheduleChannelRegistrySave();
      const searchedStatus = await searchSoopLiveStatus(name);
      return searchedStatus || { name, available: false, isLive: false };
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
    if (!status.isLive && force) {
      const searchedStatus = await searchSoopLiveStatus(name);
      if (searchedStatus) return searchedStatus;
    }
    return { name, ...status };
  } catch {
    const searchedStatus = await searchSoopLiveStatus(name);
    if (searchedStatus) return searchedStatus;
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
      "Cache-Control": isTierProfile ? "public, max-age=86400" : "no-store",
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
  if (req.method === "OPTIONS") return send(res, 204, "");
  if (url.pathname === "/api/admin/status" && req.method === "GET") {
    const session = tierAdmin.session(req);
    return send(res, 200, JSON.stringify({
      configured: tierAdmin.configured,
      authenticated: Boolean(session),
      csrf: session?.csrf || ""
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
        csrf: result.session.csrf
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
      csrf: session.csrf
    }), "application/json; charset=utf-8");
  }
  if (url.pathname === "/api/admin/tier-memberships" && (req.method === "PUT" || req.method === "DELETE")) {
    if (!requestIsSameOrigin(req) || !tierAdmin.authorize(req)) {
      return send(res, 403, JSON.stringify({ error: "관리자 인증이 필요합니다." }), "application/json; charset=utf-8");
    }
    try {
      const body = await readJsonBody(req);
      const playerName = String(body.playerName || "").trim();
      const sourcePlayer = tierRosterCache?.players?.find((player) =>
        normalizeName(player.name) === normalizeName(playerName));
      if (!sourcePlayer) {
        return send(res, 404, JSON.stringify({ error: "현재 티어 명단에서 선수를 찾지 못했습니다." }), "application/json; charset=utf-8");
      }
      if (req.method === "DELETE") {
        await tierAdmin.deleteOverride(playerName);
        return send(res, 200, JSON.stringify({ ok: true, reverted: true }), "application/json; charset=utf-8");
      }
      const currentPlayer = tierAdmin.applyOverrides([sourcePlayer])[0];
      const override = await tierAdmin.setOverride(playerName, {
        universities: Array.isArray(body.universities) ? body.universities : currentPlayer.universities,
        tier: body.tier == null ? currentPlayer.tier : body.tier,
        promotionLight: body.promotionLight == null
          ? Boolean(currentPlayer.promotionLight)
          : body.promotionLight === true
      });
      return send(res, 200, JSON.stringify({ ok: true, override }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 400, JSON.stringify({ error: error.message || "선수 정보를 변경하지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/tiers" && req.method === "GET") {
    try {
      const force = url.searchParams.get("refresh") === "1";
      let players = await loadTierRoster(force);
      if (!force && url.searchParams.get("wait") === "1" && tierRosterPromise) {
        players = await tierRosterPromise;
      }
      return send(res, 200, JSON.stringify({
        players: addTierProfileAssets(tierAdmin.applyOverrides(players)),
        source: UNIVERSITY_LIST_URL,
        updatedAt: new Date(tierRosterCache?.cacheTime || Date.now()).toISOString(),
        refreshing: Boolean(tierRosterPromise)
      }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message || "티어 명단을 불러오지 못했습니다." }), "application/json; charset=utf-8");
    }
  }
  if (url.pathname === "/api/live-status" && req.method === "GET") {
    try {
      const force = url.searchParams.get("refresh") === "1";
      const names = [...new Set(String(url.searchParams.get("names") || "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean))];
      if (!names.length || names.length > 200) {
        return send(res, 400, JSON.stringify({ error: "방송 상태는 선수 1~200명까지 조회할 수 있습니다." }), "application/json; charset=utf-8");
      }
      const prioritizedNames = [...names].sort((nameA, nameB) => {
        return Number(Boolean(manualSoopAlias(nameB))) - Number(Boolean(manualSoopAlias(nameA)));
      });
      const prioritizedStatuses = await mapConcurrent(prioritizedNames, 24, (name) => fetchSoopLiveStatus(name, force));
      const statusByName = new Map(prioritizedStatuses.map((status) => [normalizePlayerName(status.name), status]));
      const statuses = names.map((name) => statusByName.get(normalizePlayerName(name)) || {
        name,
        available: false,
        isLive: false
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
  if (url.pathname === "/api/data") {
    try {
      const force = url.searchParams.get("refresh") === "1";
      const query = String(url.searchParams.get("name") || "").trim();
      if (query.length > 40) {
        return send(res, 400, JSON.stringify({ error: "선수 이름은 40자 이내로 입력해 주세요." }), "application/json; charset=utf-8");
      }
      const requestedWrId = url.searchParams.get("wr_id");
      if (url.searchParams.get("profileOnly") === "1" && requestedWrId) {
        const profile = await loadProfile(requestedWrId, force);
        const players = profile ? [{ name: profile.name, wrId: profile.wrId, url: profile.url, source: "profile" }] : [];
        const data = { source: BOARD_URL, fetchedAt: new Date().toISOString(), pagesLoaded: 0, requestedPages: 0, siteMaxPages: 0, matches: [], profileOnly: true };
        const result = summarize([], query);
        return send(res, 200, JSON.stringify({ ...data, ...result, players, profile, resultState: profile ? "found" : "empty" }, null, 2), "application/json; charset=utf-8");
      }
      const dataPromise = loadData(url.searchParams.get("pages"), force);
      const indexPromise = query
        ? searchPlayerCandidates(query).then((players) => players.length ? players : loadPlayerIndex(force))
        : Promise.resolve([]);
      const [data, indexedPlayers] = await Promise.all([dataPromise, indexPromise]);
      const result = summarize(data.matches, query);
      let players = [];
      let profile = null;
      if (query) {
        players = findPlayers(query, data.matches, indexedPlayers);
        if (!players.length && !force) {
          players = findPlayers(query, data.matches, await loadPlayerIndex(true));
        }
        const selected = requestedWrId ? players.find((player) => player.wrId === requestedWrId) || { wrId: requestedWrId } : players[0];
        if (selected?.wrId) profile = await loadProfile(selected.wrId, force);
      }
      return send(res, 200, JSON.stringify({
        ...data,
        ...result,
        players,
        profile,
        resultState: query ? (profile ? "found" : "empty") : "found"
      }, null, 2), "application/json; charset=utf-8");
    } catch (error) {
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

Promise.all([setupCollaboration(io), tierAdmin.init()])
  .then(() => server.listen(PORT, "0.0.0.0", () => {
    console.log("ELOBoard board search app: http://localhost:" + PORT);
    for (const url of lanUrls(PORT)) console.log("LAN: " + url);
  }))
  .catch((error) => {
    console.error("Server storage initialization failed:", error);
    process.exitCode = 1;
  });

module.exports = { server, io, tierAdmin };

