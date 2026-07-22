const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const BOARD_URL = "https://eloboard.com/women/bbs/board.php?bo_table=bj_board";
const BJ_LIST_URL = "https://eloboard.com/women/bbs/board.php?bo_table=bj_list";
const MATCHUP_LIST_URL = "https://eloboard.com/women/bbs/board.php?bo_table=search_list";
const MATCHUP_SEARCH_URL = "https://eloboard.com/women/bbs/search_bj_list.php";
const MEN_LIST_URL = "https://eloboard.com/men/bbs/board.php?bo_table=search_list";
const MEN_SEARCH_URL = "https://eloboard.com/men/bbs/search_bj_list.php";
const PORT = Number(process.env.PORT || 5177);
const DEFAULT_PAGES = 10;
const MAX_PAGES = 40;
let cache = new Map();
let playerIndexCache = null;
let profileCache = new Map();
const CACHE_MS = 1000 * 60 * 3;

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" });
  res.end(body);
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
function normalizeName(name) {
  return String(name || "").replace(/\s+/g, "").trim().toLowerCase();
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
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 eloboard-women-search", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" } });
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
  const firstHtml = await fetchBoardPage(1);
  const siteMax = parsePageCount(firstHtml);
  const totalPages = Math.min(pages, siteMax || pages);
  const htmlPages = [firstHtml];
  for (let page = 2; page <= totalPages; page += 1) htmlPages.push(await fetchBoardPage(page));
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
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 eloboard-women-search", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" } });
  if (!response.ok) throw new Error("BJ list page " + page + " response error: " + response.status);
  return response.text();
}
function parseBjListPlayers(html) {
  const players = new Map();
  const links = html.match(/<a\b[^>]*href=["'][^"']*bo_table=bj_list[^"']*wr_id=\d+[^"']*["'][^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const linkHtml of links) {
    const hrefMatch = linkHtml.match(/href=["']([^"']+)["']/i);
    const text = cleanText(linkHtml);
    const href = hrefMatch ? hrefMatch[1].replace(/&amp;/g, "&") : "";
    const wrId = wrIdFromUrl(href);
    if (!wrId || !text || text.length > 30 || /\s/.test(text)) continue;
    addPlayer(players, text, wrId, absoluteUrl(href), "bj_list");
  }
  return [...players.values()];
}
async function loadPlayerIndex(force = false) {
  if (!force && playerIndexCache && Date.now() - playerIndexCache.cacheTime < CACHE_MS * 10) return playerIndexCache.players;
  const firstHtml = await fetchBjListPage(1);
  const maxPages = Math.min(parsePageCount(firstHtml) || 1, 30);
  const players = new Map();
  for (const player of parseBjListPlayers(firstHtml)) addPlayer(players, player.name, player.wrId, player.url, player.source);
  for (let page = 2; page <= maxPages; page += 1) {
    const html = await fetchBjListPage(page);
    for (const player of parseBjListPlayers(html)) addPlayer(players, player.name, player.wrId, player.url, player.source);
  }
  const data = [...players.values()];
  playerIndexCache = { cacheTime: Date.now(), players: data };
  return data;
}
function findPlayers(query, matches, indexedPlayers) {
  const key = normalizeName(query);
  if (!key) return [];
  const candidates = new Map();
  for (const player of [...playersFromMatches(matches), ...(indexedPlayers || [])]) {
    if (normalizeName(player.name).includes(key)) candidates.set(player.wrId, player);
  }
  return [...candidates.values()].sort((a, b) => normalizeName(a.name).length - normalizeName(b.name).length);
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
  return {
    wrId: String(wrId),
    name,
    url: playerUrl(wrId),
    image: profileImageFromHtml(html),
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
  const cached = profileCache.get(String(wrId));
  if (!force && cached && Date.now() - cached.cacheTime < CACHE_MS) return cached.profile;
  const response = await fetch(playerUrl(wrId), { headers: { "User-Agent": "Mozilla/5.0 eloboard-women-search", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" } });
  if (!response.ok) throw new Error("profile " + wrId + " response error: " + response.status);
  const profile = parseProfile(await response.text(), wrId);
  profileCache.set(String(wrId), { cacheTime: Date.now(), profile });
  return profile;
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
  const searchUrl = BJ_LIST_URL + "&sfl=wr_subject&stx=" + encodeURIComponent(name);
  const response = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0 elo-kitten matchup", "Accept-Language": "ko-KR,ko;q=0.9" } });
  if (!response.ok) throw new Error("선수 프로필 검색 오류: " + response.status);
  const html = await response.text();
  const wrId = html.match(/(?:&amp;|&)wr_id=(\d+)/i)?.[1] || "";
  return wrId ? loadProfile(wrId) : null;
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
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, "Forbidden");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found");
    const type = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8" }[path.extname(file)] || "application/octet-stream";
    send(res, 200, data, type);
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
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") return send(res, 204, "");
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
      const query = url.searchParams.get("name") || "";
      const requestedWrId = url.searchParams.get("wr_id");
      if (url.searchParams.get("profileOnly") === "1" && requestedWrId) {
        const profile = await loadProfile(requestedWrId, force);
        const players = profile ? [{ name: profile.name, wrId: profile.wrId, url: profile.url, source: "profile" }] : [];
        const data = { source: BOARD_URL, fetchedAt: new Date().toISOString(), pagesLoaded: 0, requestedPages: 0, siteMaxPages: 0, matches: [], profileOnly: true };
        const result = summarize([], query);
        return send(res, 200, JSON.stringify({ ...data, ...result, players, profile }, null, 2), "application/json; charset=utf-8");
      }
      const data = await loadData(url.searchParams.get("pages"), force);
      const result = summarize(data.matches, query);
      let players = [];
      let profile = null;
      if (query.trim()) {
        const indexedPlayers = await loadPlayerIndex(force);
        players = findPlayers(query, data.matches, indexedPlayers);
        if (!players.length && !force) {
          players = findPlayers(query, data.matches, await loadPlayerIndex(true));
        }
        const selected = requestedWrId ? players.find((player) => player.wrId === requestedWrId) || { wrId: requestedWrId } : players[0];
        if (selected?.wrId) profile = await loadProfile(selected.wrId, force);
      }
      return send(res, 200, JSON.stringify({ ...data, ...result, players, profile }, null, 2), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 502, JSON.stringify({ error: error.message }, null, 2), "application/json; charset=utf-8");
    }
  }
  serveStatic(req, res);
}).listen(PORT, "0.0.0.0", () => {
  console.log("ELOBoard board search app: http://localhost:" + PORT);
  for (const url of lanUrls(PORT)) console.log("LAN: " + url);
});

