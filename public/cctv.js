const CCTV_VERSION = "cctv34";
const BOOTSTRAP_CONCURRENCY = 2;
const SERVER_COOLDOWN_MS = 30000;
const DEFAULT_FILTER = "tier:6";
const MANUAL_KEY = "elo-kitten-cctv-manual-participants-v3";
const SHARED_KEY = "elo-kitten-cctv-main-v3";
const channel = null;

const grid = document.getElementById("grid");
const filterbar = document.getElementById("filterbar");
const logBox = document.getElementById("log");
const participantList = document.getElementById("participantList");
const groupSummary = document.getElementById("groupSummary");
const tierSelect = document.getElementById("tierSelect");
const universitySelect = document.getElementById("universitySelect");
const universityDivisionSelect = document.getElementById("universityDivisionSelect");
const showOfflineToggle = document.getElementById("showOfflineToggle");

const slots = [];
let players = [];
let currentFilter = DEFAULT_FILTER;
let mainHls = null;
let activeIndex = -1;
let loadingVisible = false;
let refreshingLive = false;
let isShuttingDown = false;
let mainPlayId = 0;
let cctvServerCooldownUntil = 0;
let lastCooldownLogAt = 0;
let hlsLibraryPromise = null;
let nextRecoveryStartAt = 0;
const cctvViewerSessionId = typeof globalThis.crypto?.randomUUID === "function"
  ? globalThis.crypto.randomUUID()
  : `cctv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let cctvSessionTimer = null;
let sharedSessionLogged = false;
let cctvSessionClosed = false;

function log(message) {
  const time = new Date().toLocaleTimeString();
  logBox.textContent += `[${time}] ${message}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

function activeCctvBroadcastIds() {
  const ids = slots
    .filter((slot) => slot?.hls && slot?.data)
    .map((slot) => broadcastIdOf(slot.player))
    .filter(Boolean);
  const mainSlot = slots[activeIndex];
  if (mainHls && mainSlot) ids.push(broadcastIdOf(mainSlot.player));
  return [...new Set(ids)];
}

async function sendCctvSessionHeartbeat() {
  if (isShuttingDown) return;
  try {
    const response = await fetch("/api/cctv/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ sessionId: cctvViewerSessionId, broadcastIds: activeCctvBroadcastIds() }),
      keepalive: true
    });
    if (!response.ok) return;
    const result = await response.json();
    if (!sharedSessionLogged && Number(result.activeViewers || 0) > 1) {
      sharedSessionLogged = true;
      log(`공동 CCTV 캐시 연결 완료 · 현재 접속 ${result.activeViewers}명`);
    }
  } catch {}
}

function startCctvSession() {
  cctvSessionClosed = false;
  if (cctvSessionTimer) clearInterval(cctvSessionTimer);
  sendCctvSessionHeartbeat();
  cctvSessionTimer = setInterval(sendCctvSessionHeartbeat, 15000);
}

function closeCctvSession() {
  if (cctvSessionClosed) return;
  cctvSessionClosed = true;
  if (cctvSessionTimer) {
    clearInterval(cctvSessionTimer);
    cctvSessionTimer = null;
  }
  const body = JSON.stringify({ sessionId: cctvViewerSessionId });
  try {
    navigator.sendBeacon("/api/cctv/session/close", new Blob([body], { type: "application/json" }));
  } catch {}
}

function key(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function tierNumber(value) {
  const match = String(value || "").match(/\d+/);
  return match ? match[0] : String(value || "").trim();
}

function normalizeUniversity(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function isNewcastleUniversity(university) {
  const name = normalizeUniversity(university);
  return name.includes("뉴캐슬") || name.includes("뉴캣슬");
}

function universityNames(player) {
  return [...new Set([
    ...(Array.isArray(player.universities) ? player.universities : []),
    player.university
  ].map((item) => String(item || "").trim()).filter(Boolean))];
}

function hasUniversity(player, university) {
  const target = normalizeUniversity(university);
  return universityNames(player).some((name) => normalizeUniversity(name) === target);
}

function playerDivisionLabel(player) {
  if (player.division === "men") return "남자";
  if (player.division === "women") return "여자";
  return "미지정";
}

function filterLabel(filter) {
  if (filter === "all") return "전체";
  const parts = filter.split(":");
  if (parts[0] === "tier") return `${parts[1]}티어`;
  if (parts[0] === "university") return parts[1] || "대학";
  if (parts[0] === "university_division") return `${parts[1]} ${parts[2] === "men" ? "남자" : "여자"}`;
  return filter;
}

function playerLabel(player) {
  return `${player.name} · ${player.tier || "티어 미지정"} · ${universityNames(player)[0] || "대학 미지정"} · ${playerDivisionLabel(player)}`;
}

function safeBroadcastId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : "";
}

function broadcastIdFromUrl(value) {
  const match = String(value || "").match(/https?:\/\/(?:bj\.afreecatv\.com|ch\.sooplive\.co\.kr|play\.sooplive\.co\.kr)\/([a-z0-9_-]+)/i);
  return safeBroadcastId(match?.[1]);
}

function soopDirectUrl(player) {
  const existingUrl = [player.broadcastUrl, player.stationUrl, player.station_url, player.soopUrl, player.soop_url, player.afreecaUrl, player.afreeca_url]
    .map((item) => String(item || "").trim())
    .find((item) => /^https?:\/\//i.test(item));
  if (existingUrl) return existingUrl;
  const id = broadcastIdOf(player);
  return id ? `https://ch.sooplive.co.kr/${encodeURIComponent(id)}` : "";
}

function soopEmbedUrl(player) {
  const id = broadcastIdOf(player);
  return id ? `https://play.sooplive.com/embed/${encodeURIComponent(id)}` : soopDirectUrl(player);
}

function loadManualParticipants() {
  try {
    const saved = JSON.parse(localStorage.getItem(MANUAL_KEY) || "[]");
    return Array.isArray(saved) ? saved.map(cleanManualParticipant).filter((item) => item.name && item.broadcastId) : [];
  } catch {
    return [];
  }
}

function saveManualParticipants(items) {
  localStorage.setItem(MANUAL_KEY, JSON.stringify(items));
}

function cleanManualParticipant(item) {
  const broadcastId = safeBroadcastId(item.broadcastId || item.broadcast_id || item.id);
  return {
    name: String(item.name || broadcastId || "").trim(),
    tier: String(item.tier || "").trim(),
    university: String(item.university || "").trim(),
    universities: [String(item.university || "").trim()].filter(Boolean),
    division: ["women", "men"].includes(item.division) ? item.division : "",
    broadcastId,
    customCctv: true
  };
}

function destroyHls(hls) {
  if (hls) {
    try { hls.destroy(); } catch {}
  }
}

function ensureHlsLibrary() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsLibraryPromise) return hlsLibraryPromise;
  hlsLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
    script.async = true;
    script.onload = () => window.Hls ? resolve(window.Hls) : reject(new Error("HLS 라이브러리를 불러오지 못했습니다."));
    script.onerror = () => reject(new Error("HLS 라이브러리를 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
  return hlsLibraryPromise;
}

function attach(video, url, label, slot = null, options = {}) {
  let fatalHandled = false;
  let softErrorCount = 0;
  let networkErrorCount = 0;
  let lastSoftLogAt = 0;
  let lastNetworkLogAt = 0;
  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    liveSyncDurationCount: 4,
    liveMaxLatencyDurationCount: 10,
    backBufferLength: 15,
    maxBufferLength: 30,
    maxMaxBufferLength: 45,
    manifestLoadingTimeOut: 20000,
    levelLoadingTimeOut: 20000,
    fragLoadingTimeOut: 20000,
    manifestLoadingMaxRetry: 6,
    levelLoadingMaxRetry: 6,
    fragLoadingMaxRetry: 6,
    manifestLoadingRetryDelay: 1000,
    levelLoadingRetryDelay: 1000,
    fragLoadingRetryDelay: 1000,
    manifestLoadingMaxRetryTimeout: 8000,
    levelLoadingMaxRetryTimeout: 8000,
    fragLoadingMaxRetryTimeout: 8000
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    networkErrorCount = 0;
    video.play().catch(() => {});
    log(`${label} 연결 완료`);
    if (slot) {
      setTimeout(() => {
        if (!isShuttingDown && slot.hls === hls && slot.data && !slot.video.paused) slot.reloadCount = 0;
      }, 30000);
    }
  });
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (isShuttingDown) return;
    const isSoftStall = data.type === Hls.ErrorTypes.MEDIA_ERROR && /bufferStalled|bufferSeekOverHole/i.test(data.details || "");
    if (!data.fatal) {
      if (isSoftStall) {
        softErrorCount += 1;
        if (Date.now() - lastSoftLogAt > 60000 || softErrorCount === 1) {
          lastSoftLogAt = Date.now();
          log(`${label} 일시 멈춤 감지 ${softErrorCount}회`);
        }
        if (!slot && softErrorCount >= 8 && typeof options.onUnstable === "function") {
          options.onUnstable(data, hls);
        }
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        networkErrorCount += 1;
        if (networkErrorCount === 1 || Date.now() - lastNetworkLogAt > 15000) {
          lastNetworkLogAt = Date.now();
          log(`${label} 네트워크 지연 감지 · 연결 유지 재시도 중`);
        }
        if (slot && networkErrorCount >= 3) scheduleSlotReload(slot, "network");
        return;
      }
      log(`${label} 오류: ${data.type} / ${data.details}`);
      return;
    }
    log(`${label} 오류: ${data.type} / ${data.details} [FATAL]`);
    if (!slot) {
      if (fatalHandled) return;
      fatalHandled = true;
      try { if (typeof options.onFatal === "function") options.onFatal(data, hls); }
      catch {}
      return;
    }
    try {
      if (data.details === "levelParsingError" && slot) scheduleSlotReload(slot, "playlist");
      else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) scheduleSlotReload(slot, "network");
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else if (slot) scheduleSlotReload(slot, "fatal");
    } catch {
      if (slot) scheduleSlotReload(slot, "fatal");
    }
  });
  return hls;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!text.trim()) {
    const error = new Error("서버 응답이 비어 있어 30초 쉬어갑니다.");
    error.code = "EMPTY_JSON";
    throw error;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const error = new Error("서버 응답이 깨져 있어 30초 쉬어갑니다.");
    error.code = "INVALID_JSON";
    throw error;
  }
  if (!response.ok || data.ok === false) throw new Error(data.error || "요청 실패");
  return data;
}

function isServerCoolingDown() {
  return Date.now() < cctvServerCooldownUntil;
}

function enterServerCooldown(message) {
  cctvServerCooldownUntil = Date.now() + SERVER_COOLDOWN_MS;
  if (Date.now() - lastCooldownLogAt > 5000) {
    lastCooldownLogAt = Date.now();
    log(`${message} 30초 후 다시 시도해 주세요.`);
  }
}

async function fetchLiveStatuses(names, force = false) {
  const uniqueNames = [...new Set((names || []).map((name) => String(name || "").trim()).filter(Boolean))];
  const statuses = [];
  for (let index = 0; index < uniqueNames.length; index += 200) {
    const batch = uniqueNames.slice(index, index + 200);
    const live = await fetchJson("/api/live-status" + (force ? "?refresh=1" : ""), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ names: batch, refresh: force })
    });
    statuses.push(...(live.statuses || []));
  }
  return { statuses };
}

function renderSelectors() {
  const tiers = [...new Set(players.map((player) => tierNumber(player.tier)).filter(Boolean))]
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"));
  if (tierSelect) {
    const selectedTier = currentFilter.startsWith("tier:") ? currentFilter.split(":")[1] : "6";
    tierSelect.innerHTML = "";
    tiers.forEach((tier) => {
      const option = document.createElement("option");
      option.value = tier;
      option.textContent = `${tier}티어`;
      option.selected = tier === selectedTier;
      tierSelect.appendChild(option);
    });
  }

  const universities = [...new Set(players.flatMap(universityNames))]
    .sort((a, b) => a.localeCompare(b, "ko"));
  if (universitySelect) {
    const selectedUniversity = currentFilter.startsWith("university") ? currentFilter.split(":")[1] : "";
    universitySelect.innerHTML = "";
    universities.forEach((university) => {
      const hasWomen = players.some((player) => player.division === "women" && hasUniversity(player, university));
      const hasMen = players.some((player) => player.division === "men" && hasUniversity(player, university));
      if (!hasWomen && !(isNewcastleUniversity(university) && hasMen)) return;
      const option = document.createElement("option");
      option.value = university;
      option.textContent = university;
      option.selected = normalizeUniversity(university) === normalizeUniversity(selectedUniversity);
      universitySelect.appendChild(option);
    });
    updateUniversityDivisionOptions();
  }

  if (filterbar) filterbar.innerHTML = "";
}

function updateUniversityDivisionOptions() {
  if (!universitySelect || !universityDivisionSelect) return;
  const university = universitySelect.value;
  universityDivisionSelect.innerHTML = "";
  const options = isNewcastleUniversity(university)
    ? [["all", "남자+여자 전체"], ["women", "여자만"], ["men", "남자만"]]
    : [["women", "여자만"]];
  options.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    universityDivisionSelect.appendChild(option);
  });
}

function matchesFilter(slot) {
  const player = slot.player;
  if (currentFilter === "all") return true;
  const parts = currentFilter.split(":");
  if (parts[0] === "tier") return tierNumber(player.tier) === parts[1];
  if (parts[0] === "university") return hasUniversity(player, parts[1]);
  if (parts[0] === "university_division") return hasUniversity(player, parts[1]) && player.division === parts[2];
  return true;
}

function isSlotLive(slot) {
  if (slot?.player?.live) return Boolean(slot.player.live.isLive);
  return Boolean(slot?.data);
}

function isSlotKnownOffline(slot) {
  return Boolean(slot?.player?.live && !slot.player.live.isLive);
}

function shouldShowSlot(slot) {
  if (!matchesFilter(slot)) return false;
  if (showOfflineToggle?.checked) return true;
  return !isSlotKnownOffline(slot);
}

function slotSortRank(slot) {
  if (isSlotLive(slot)) return 0;
  if (!slot.player.live) return 1;
  return 2;
}

function refreshSlotVisibilityAndOrder() {
  slots.forEach((slot) => {
    slot.card.classList.toggle("hidden", !shouldShowSlot(slot));
    slot.card.classList.toggle("live", isSlotLive(slot));
    slot.card.classList.toggle("offline", isSlotKnownOffline(slot));
    slot.card.style.order = String(slotSortRank(slot) * 10000 + slot.index);
  });
  updateGroupSummary();
}

function stopSmallPlayback(slot, statusText = "대기") {
  if (!slot) return;
  if (slot.reloadTimer) {
    clearTimeout(slot.reloadTimer);
    slot.reloadTimer = null;
  }
  if (slot.directFallbackTimer) {
    clearTimeout(slot.directFallbackTimer);
    slot.directFallbackTimer = null;
  }
  destroyHls(slot.hls);
  slot.hls = null;
  restoreSlotVideo(slot);
  clearVideo(slot.video);
  slot.status.textContent = statusText;
}

function updateGroupSummary() {
  const count = slots.filter(matchesFilter).length;
  const liveReady = slots.filter((slot) => matchesFilter(slot) && slot.data).length;
  const liveCount = slots.filter((slot) => matchesFilter(slot) && isSlotLive(slot)).length;
  const offlineCount = slots.filter((slot) => matchesFilter(slot) && isSlotKnownOffline(slot)).length;
  const visibleCount = slots.filter(shouldShowSlot).length;
  if (groupSummary) {
    const visibleText = showOfflineToggle?.checked ? ` · 표시 ${visibleCount}/${count}명` : "";
    groupSummary.textContent = `현재 기준: ${filterLabel(currentFilter)} · LIVE ${liveCount}명 · 오프라인 ${offlineCount}명${visibleText} · 재생 준비 ${liveReady}명`;
  }
}

async function refreshCurrentFilterLive(force = false) {
  if (refreshingLive) return;
  const targets = slots.filter(matchesFilter);
  const names = targets.map((slot) => slot.player.name).filter(Boolean);
  if (!names.length) return;
  refreshingLive = true;
  log(`${filterLabel(currentFilter)} LIVE 상태 조회 중: ${names.length}명`);
  try {
    const live = await fetchLiveStatuses(names, force);
    const liveByName = new Map((live.statuses || []).map((status) => [key(status.name), status]));
    targets.forEach((slot) => {
      const status = liveByName.get(key(slot.player.name));
      if (!status) {
        slot.player.live = { isLive: false };
        if (!slot.data) {
          slot.tried = false;
          slot.status.textContent = "오프라인";
        }
        return;
      }
      slot.player.live = status;
      slot.player.broadcastId = status.broadcastId || slot.player.broadcastId;
      slot.player.broadcastUrl = status.broadcastUrl || slot.player.broadcastUrl;
      if (!slot.data) {
        slot.tried = false;
        slot.status.textContent = status.isLive ? "LIVE 확인" : "오프라인";
      }
    });
    log(`${filterLabel(currentFilter)} LIVE 상태 반영 완료`);
  } catch (error) {
    log(`${filterLabel(currentFilter)} LIVE 상태 조회 실패 - 현재 목록은 그대로 표시합니다: ${error.message}`);
  } finally {
    refreshingLive = false;
    refreshSlotVisibilityAndOrder();
  }
}

async function prepareCurrentFilterScreens(force = false) {
  await refreshCurrentFilterLive(force);
  const liveSlots = slots.filter((slot) => matchesFilter(slot) && isSlotLive(slot) && !isSlotKnownOffline(slot));

  slots.forEach((slot) => {
    if (!matchesFilter(slot) || isSlotKnownOffline(slot)) {
      stopSmallPlayback(slot, slot.player.live ? "오프라인" : "대기");
    }
  });

  if (liveSlots.length) {
    ensureHlsLibrary().catch((error) => log(`HLS 준비 실패: ${error.message}`));
  }

  let cursor = 0;
  async function worker() {
    while (cursor < liveSlots.length && !isServerCoolingDown()) {
      const slot = liveSlots[cursor++];
      if (slot.directPreview) restoreSlotVideo(slot);
      if (!slot.data || !slot.hls) await loadSlot(slot.index, { attachSmall: true });
    }
  }
  await Promise.all(Array.from({ length: Math.min(BOOTSTRAP_CONCURRENCY, liveSlots.length) }, worker));
  refreshSlotVisibilityAndOrder();
  log(`${filterLabel(currentFilter)} 기본 구성 완료: LIVE ${liveSlots.length}명 · LOW HLS 2명씩 연결 · MAIN용 HIGH 캐시 준비`);
}

function applyFilter(filter, shouldLoad = false) {
  currentFilter = filter;
  refreshSlotVisibilityAndOrder();
  if (shouldLoad) prepareCurrentFilterScreens(false);
}

function createSlot(player) {
  const index = slots.length;
  const card = document.createElement("section");
  card.className = "cctv-panel cctv-card";

  const head = document.createElement("div");
  head.className = "cctv-head";
  const name = document.createElement("b");
  name.textContent = player.name;
  const status = document.createElement("span");
  status.className = "cctv-status";
  status.textContent = "대기";
  head.append(name, status);

  const playerBox = document.createElement("div");
  playerBox.className = "cctv-player";
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  playerBox.appendChild(video);

  const meta = document.createElement("div");
  meta.className = "cctv-meta";
  meta.textContent = playerLabel(player);

  card.append(head, playerBox, meta);
  card.onclick = () => openSlotMain(index);
  grid.appendChild(card);

  slots.push({
    index,
    player,
    card,
    status,
    playerBox,
    video,
    meta,
    hls: null,
    data: null,
   directPreview: false,
    directFallbackTimer: null,
   lastTime: 0,
    stuck: 0,
    tried: false,
    reloadTimer: null,
    reloadCount: 0
  });
}

function broadcastIdOf(player) {
  return safeBroadcastId(player.live?.broadcastId) ||
    safeBroadcastId(player.broadcastId) ||
    broadcastIdFromUrl(player.broadcastUrl) ||
    broadcastIdFromUrl(player.stationUrl) ||
    broadcastIdFromUrl(player.station_url) ||
    broadcastIdFromUrl(player.soopUrl) ||
    broadcastIdFromUrl(player.soop_url) ||
    broadcastIdFromUrl(player.afreecaUrl) ||
    broadcastIdFromUrl(player.afreeca_url);
}

async function resolveBroadcastId(slot) {
  const existing = broadcastIdOf(slot.player);
  if (existing) return existing;
  slot.status.textContent = "아이디 찾는 중";
  try {
    const live = await fetchJson("/api/live-status", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ names: [slot.player.name] })
    });
    const status = (live.statuses || [])[0];
    if (status) slot.player.live = status;
    return broadcastIdOf(slot.player);
  } catch (error) {
    log(`${slot.player.name} 아이디 조회 실패: ${error.message}`);
    return "";
  }
}

async function loadSlot(index, options = {}) {
  const slot = slots[index];
  const attachSmall = options.attachSmall === true;
  if (isServerCoolingDown()) {
    slot.status.textContent = "서버 쉬는 중";
    return false;
  }
  slot.tried = true;
  const broadcastId = await resolveBroadcastId(slot);
  if (!broadcastId) {
    slot.status.textContent = "SOOP ID 없음";
    refreshSlotVisibilityAndOrder();
    return false;
  }
  if (!slot.player.customCctv && slot.player.live && !slot.player.live.isLive) {
    slot.status.textContent = "오프라인";
    refreshSlotVisibilityAndOrder();
    return false;
  }

  slot.status.textContent = "조회 중";
  try {
    const data = await fetchJson(`/api/cctv/bootstrap/${encodeURIComponent(broadcastId)}`);
    slot.data = data;
    slot.reloadCount = 0;
    slot.player.live = Object.assign({}, slot.player.live || {}, { isLive: true, broadcastId });
    slot.status.textContent = "LIVE";
    slot.meta.textContent = `${playerLabel(slot.player)} | LOW ${(data.lowMeta || {}).height || "?"}p | HIGH ${(data.highMeta || {}).height || "?"}p`;
    if (attachSmall) {
      await ensureHlsLibrary();
      restoreSlotVideo(slot);
      destroyHls(slot.hls);
      slot.video.pause();
      slot.video.removeAttribute("src");
      slot.video.load();
      slot.video.muted = true;
      slot.hls = attach(slot.video, data.lowUrl, `LOW ${slot.player.name}`, slot);
    } else if (!slot.directPreview) {
      slot.status.textContent = "MAIN 준비";
    }
    refreshSlotVisibilityAndOrder();
    sendCctvSessionHeartbeat();
    return true;
  } catch (error) {
    if (/not currently live|currently live|오프라인|offline/i.test(error.message || "")) {
      slot.player.live = Object.assign({}, slot.player.live || {}, { isLive: false });
      slot.tried = true;
      slot.status.textContent = "오프라인";
      slot.meta.textContent = "LIVE 목록에는 잡혔지만 실제 스트림은 현재 꺼져 있습니다.";
      log(`${slot.player.name}: 실제 방송이 꺼져 있어 오프라인으로 처리합니다.`);
      refreshSlotVisibilityAndOrder();
      return false;
    }
    if (error.code === "EMPTY_JSON" || error.code === "INVALID_JSON") {
      slot.tried = false;
      slot.status.textContent = "잠시 후";
      slot.meta.textContent = error.message;
      enterServerCooldown(error.message);
      refreshSlotVisibilityAndOrder();
      return false;
    }
    slot.status.textContent = "실패";
    slot.meta.textContent = error.message;
    log(`${slot.player.name}: ${error.message}`);
    refreshSlotVisibilityAndOrder();
    return false;
  }
}

function showSoopDirectPreview(index) {
  const slot = slots[index];
  if (!slot || slot.directPreview) return false;
  const url = soopEmbedUrl(slot.player);
  if (!url) {
    slot.status.textContent = "SOOP 주소 없음";
    return false;
  }
  destroyHls(slot.hls);
  slot.hls = null;
  clearVideo(slot.video);
  slot.playerBox.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "cctv-soop-preview";
  const iframe = document.createElement("iframe");
  iframe.src = url;
  iframe.loading = "lazy";
  iframe.referrerPolicy = "no-referrer-when-downgrade";
  iframe.allow = "autoplay; fullscreen; picture-in-picture";
  iframe.style.pointerEvents = "none";
  wrap.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMain(index);
  };

  const hint = document.createElement("span");
  hint.textContent = "SOOP 원본 · 클릭하면 MAIN";

  const overlay = document.createElement("button");
  overlay.type = "button";
  overlay.className = "cctv-preview-hit";
  overlay.setAttribute("aria-label", `${slot.player.name} MAIN으로 보기`);
  overlay.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setProxyMain(index);
  };

  wrap.append(iframe, hint, overlay);
  slot.playerBox.appendChild(wrap);
  slot.directPreview = true;
  slot.status.textContent = "SOOP 시도";
  slot.meta.textContent = `${playerLabel(slot.player)} | 원본 화면 시도 중 · 안 보이면 HLS로 대체`;
  slot.directFallbackTimer = setTimeout(() => {
    slot.directFallbackTimer = null;
    if (isShuttingDown || !slot.directPreview || slot.data || !matchesFilter(slot) || !isSlotLive(slot)) return;
    log(`${slot.player.name} SOOP 원본 작은화면이 보이지 않을 수 있어 HLS로 대체합니다.`);
    restoreSlotVideo(slot);
    loadSlot(index, { attachSmall: true });
  }, 8000);
  refreshSlotVisibilityAndOrder();
  return true;
}

function restoreSlotVideo(slot) {
  if (!slot || !slot.directPreview) return;
  slot.playerBox.innerHTML = "";
  slot.playerBox.appendChild(slot.video);
  slot.directPreview = false;
  if (slot.directFallbackTimer) {
    clearTimeout(slot.directFallbackTimer);
    slot.directFallbackTimer = null;
  }
}

function scheduleSlotReload(slot, reason = "error") {
  if (!slot || isShuttingDown || slot.reloadTimer) return;
  const delays = [2000, 5000, 15000, 30000];
  const baseDelay = delays[Math.min(slot.reloadCount, delays.length - 1)];
  const earliest = Date.now() + baseDelay + Math.floor(Math.random() * 500);
  const plannedAt = Math.max(earliest, nextRecoveryStartAt + 1500);
  nextRecoveryStartAt = plannedAt;
  const delay = Math.max(0, plannedAt - Date.now());
  slot.reloadCount += 1;
  slot.status.textContent = delay >= 30000 ? "불안정 - 잠시 후 복구" : "복구 대기";
  log(`${slot.player.name} 작은화면 복구 예약: ${Math.round(delay / 1000)}초 후 (${reason})`);
  slot.reloadTimer = setTimeout(() => {
    slot.reloadTimer = null;
    if (!isShuttingDown) reloadSlot(slot.index);
  }, delay);
}

async function reloadSlot(index) {
  const slot = slots[index];
  if (isShuttingDown) return false;
  if (!slot.data) return loadSlot(index, { attachSmall: true });
  if (slot.reloadTimer) {
    clearTimeout(slot.reloadTimer);
    slot.reloadTimer = null;
  }
  destroyHls(slot.hls);
  restoreSlotVideo(slot);
  slot.video.pause();
  slot.video.removeAttribute("src");
  slot.video.load();
  slot.video.muted = true;
  slot.hls = attach(slot.video, slot.data.lowUrl + "?r=" + Date.now(), `LOW-RELOAD ${slot.player.name}`, slot);
  slot.status.textContent = "복구 중";
  setTimeout(() => { if (slot.data) slot.status.textContent = "LIVE"; }, 1200);
}

function shareMain(broadcastId) {
  return;
}

function shareMainStop() {
  return;
}

function cacheBust(url) {
  return url + (String(url).includes("?") ? "&" : "?") + "r=" + Date.now();
}

function clearVideo(video) {
  video.pause();
  video.removeAttribute("src");
  video.src = "";
  video.load();
}

function clearMainFrame() {
  const video = document.getElementById("mainVideo");
  const box = video?.parentElement;
  box?.querySelectorAll(".cctv-main-frame").forEach((item) => item.remove());
  if (video) video.style.display = "";
}

function showMainDirect(player) {
  const url = soopDirectUrl(player);
  const video = document.getElementById("mainVideo");
  const box = video?.parentElement;
  if (!url || !box || !video) return false;
  destroyHls(mainHls);
  mainHls = null;
  clearVideo(video);
  video.style.display = "none";
  box.querySelectorAll(".cctv-main-frame").forEach((item) => item.remove());
  const frame = document.createElement("iframe");
  frame.className = "cctv-main-frame";
  frame.src = url;
  frame.loading = "eager";
  frame.referrerPolicy = "no-referrer-when-downgrade";
  frame.allow = "autoplay; fullscreen; picture-in-picture";
  box.appendChild(frame);
  return true;
}

async function setMain(index, options = {}) {
  const slot = slots[index];
  if (!slot) return;
  const currentPlayId = ++mainPlayId;
  activeIndex = index;
  document.querySelectorAll(".cctv-card").forEach((card, cardIndex) => {
    card.classList.toggle("active", cardIndex === index);
  });

  document.getElementById("mainTitle").textContent = "MAIN - " + slot.player.name;
  document.getElementById("mainStatus").textContent = "SOOP 원본";
  if (showMainDirect(slot.player)) {
    document.getElementById("mainMeta").textContent = `${playerLabel(slot.player)} | SOOP 원본 화면입니다. 서버 프록시를 사용하지 않습니다.`;
  } else {
    document.getElementById("mainStatus").textContent = "주소 없음";
    document.getElementById("mainMeta").textContent = "SOOP 주소를 찾지 못했습니다. 방송 아이디 보조 입력을 확인해 주세요.";
  }
}

async function setProxyMain(index = activeIndex) {
  let slot = slots[index];
  if (!slot || !matchesFilter(slot) || isSlotKnownOffline(slot)) {
    slot = slots.find((item) => matchesFilter(item) && isSlotLive(item) && !isSlotKnownOffline(item));
  }
  if (!slot) {
    await refreshCurrentFilterLive(false);
    slot = slots.find((item) => matchesFilter(item) && isSlotLive(item) && !isSlotKnownOffline(item));
  }
  if (!slot) {
    log("프록시 MAIN으로 볼 수 있는 LIVE 방송이 아직 없습니다.");
    return;
  }

  const indexToPlay = slot.index;
  const currentPlayId = ++mainPlayId;
  activeIndex = indexToPlay;
  document.querySelectorAll(".cctv-card").forEach((card, cardIndex) => {
    card.classList.toggle("active", cardIndex === indexToPlay);
  });

  document.getElementById("mainTitle").textContent = "MAIN - " + slot.player.name;
  document.getElementById("mainStatus").textContent = "프록시 준비";
  document.getElementById("mainMeta").textContent = "프록시 MAIN은 선택한 한 명만 재생합니다.";

  try {
    await ensureHlsLibrary();
  } catch (error) {
    log(`프록시 MAIN 준비 실패: ${error.message}`);
    showMainDirect(slot.player);
    document.getElementById("mainStatus").textContent = "SOOP 원본";
    document.getElementById("mainMeta").textContent = "HLS 재생 도구를 불러오지 못해 SOOP 원본 화면으로 표시합니다.";
    return;
  }

  if (!slot.data) {
    const ok = await loadSlot(indexToPlay, { attachSmall: false });
    if (!ok || mainPlayId !== currentPlayId) {
      document.getElementById("mainStatus").textContent = "프록시 대기";
      document.getElementById("mainMeta").textContent = "방송 주소를 바로 가져오지 못했습니다. 잠시 뒤 다시 눌러 주세요.";
      return;
    }
  }

  const video = document.getElementById("mainVideo");
  clearMainFrame();
  destroyHls(mainHls);
  mainHls = null;
  clearVideo(video);
  video.muted = false;
  video.controls = true;

  const playLow = () => {
    if (mainPlayId !== currentPlayId || !slot.data?.lowUrl) return;
    destroyHls(mainHls);
    clearVideo(video);
    document.getElementById("mainStatus").textContent = "프록시 LOW";
    document.getElementById("mainMeta").textContent = `${playerLabel(slot.player)} | HIGH가 불안정해서 LOW로 전환했습니다.`;
    mainHls = attach(video, cacheBust(slot.data.lowUrl), `PROXY-LOW ${slot.player.name}`, null, {
      onUnstable: () => {
        if (mainPlayId !== currentPlayId) return;
        destroyHls(mainHls);
        mainHls = null;
        showMainDirect(slot.player);
        document.getElementById("mainStatus").textContent = "SOOP 원본";
        document.getElementById("mainMeta").textContent = "프록시 LOW도 불안정해서 SOOP 원본 화면으로 되돌렸습니다.";
      },
      onFatal: () => {
        if (mainPlayId !== currentPlayId) return;
        destroyHls(mainHls);
        mainHls = null;
        showMainDirect(slot.player);
        document.getElementById("mainStatus").textContent = "SOOP 원본";
        document.getElementById("mainMeta").textContent = "프록시가 불안정해서 SOOP 원본 화면으로 되돌렸습니다.";
      }
    });
  };

  const highUrl = slot.data?.highUrl || slot.data?.lowUrl;
  if (!highUrl) {
    showMainDirect(slot.player);
    document.getElementById("mainStatus").textContent = "SOOP 원본";
    document.getElementById("mainMeta").textContent = "프록시 주소가 없어 SOOP 원본 화면으로 표시합니다.";
    return;
  }

  document.getElementById("mainStatus").textContent = slot.data?.highUrl ? "프록시 HIGH" : "프록시 LOW";
  document.getElementById("mainMeta").textContent = `${playerLabel(slot.player)} | 프록시 MAIN · 선택한 한 명만 재생 중`;
  mainHls = attach(video, cacheBust(highUrl), `${slot.data?.highUrl ? "PROXY-HIGH" : "PROXY-LOW"} ${slot.player.name}`, null, {
    onUnstable: () => {
      if (mainPlayId !== currentPlayId) return;
      if (slot.data?.highUrl && slot.data?.lowUrl && slot.data.highUrl !== slot.data.lowUrl) {
        log(`${slot.player.name} 프록시 HIGH 멈춤 반복 - LOW로 전환합니다.`);
        playLow();
      } else {
        destroyHls(mainHls);
        mainHls = null;
        showMainDirect(slot.player);
        document.getElementById("mainStatus").textContent = "SOOP 원본";
        document.getElementById("mainMeta").textContent = "프록시가 반복해서 멈춰 SOOP 원본 화면으로 되돌렸습니다.";
      }
    },
    onFatal: () => {
      if (mainPlayId !== currentPlayId) return;
      if (slot.data?.highUrl && slot.data?.lowUrl && slot.data.highUrl !== slot.data.lowUrl) {
        log(`${slot.player.name} 프록시 HIGH 불안정 - LOW로 전환합니다.`);
        playLow();
      } else {
        destroyHls(mainHls);
        mainHls = null;
        showMainDirect(slot.player);
        document.getElementById("mainStatus").textContent = "SOOP 원본";
        document.getElementById("mainMeta").textContent = "프록시가 불안정해서 SOOP 원본 화면으로 되돌렸습니다.";
      }
    }
  });
}

async function proxyMain() {
  await setProxyMain(activeIndex);
}

async function loadVisibleUnloaded(limit = Infinity) {
  if (loadingVisible) return;
  if (isServerCoolingDown()) {
    log("서버가 잠시 쉬는 중입니다. 조금 뒤 다시 시도해 주세요.");
    return;
  }
  loadingVisible = true;
  let cursor = 0;
  const targets = slots
    .filter((slot) => matchesFilter(slot) && isSlotLive(slot) && !isSlotKnownOffline(slot) && !slot.directPreview && !slot.data && !slot.tried)
    .slice(0, limit);
  async function worker() {
    while (cursor < targets.length && !isServerCoolingDown()) {
      const slot = targets[cursor++];
      await loadSlot(slot.index, { attachSmall: true });
    }
  }
  await Promise.all(Array.from({ length: Math.min(BOOTSTRAP_CONCURRENCY, targets.length) }, worker));
  loadingVisible = false;
  refreshSlotVisibilityAndOrder();
}

async function startVisibleLive() {
  await prepareCurrentFilterScreens(false);
}

async function openSlotMain(index) {
  const slot = slots[index];
  if (!slot) return;
  await setProxyMain(index);
}

async function randomMain() {
  let candidates = slots.filter((slot) => matchesFilter(slot) && isSlotLive(slot) && !isSlotKnownOffline(slot));
  if (!candidates.length) {
    await refreshCurrentFilterLive(false);
    candidates = slots.filter((slot) => matchesFilter(slot) && isSlotLive(slot) && !isSlotKnownOffline(slot));
    if (!candidates.length) {
      log("현재 기준에서 재생 가능한 방송이 아직 없습니다.");
      return;
    }
  }
  const slot = candidates[Math.floor(Math.random() * candidates.length)];
  await setProxyMain(slot.index);
}

function stopMainOnly(options = {}) {
  mainPlayId += 1;
  destroyHls(mainHls);
  mainHls = null;
  activeIndex = -1;
  document.querySelectorAll(".cctv-card").forEach((card) => card.classList.remove("active"));
  clearMainFrame();
  const mainVideo = document.getElementById("mainVideo");
  mainVideo.pause();
  mainVideo.removeAttribute("src");
  mainVideo.src = "";
  mainVideo.load();
  document.getElementById("mainTitle").textContent = "MAIN - 선택 없음";
  document.getElementById("mainStatus").textContent = "정지";
  document.getElementById("mainMeta").textContent = "작은화면은 계속 유지됩니다. 보고 싶은 작은화면을 클릭하면 MAIN에 표시됩니다.";
  if (!options.fromShare) shareMainStop();
}

function stopAll(finalStop = false) {
  if (finalStop) isShuttingDown = true;
  mainPlayId += 1;
  slots.forEach((slot) => {
    if (slot.reloadTimer) {
      clearTimeout(slot.reloadTimer);
      slot.reloadTimer = null;
    }
    destroyHls(slot.hls);
    slot.hls = null;
    restoreSlotVideo(slot);
    slot.video.pause();
    slot.video.removeAttribute("src");
    slot.video.src = "";
    slot.video.load();
    slot.status.textContent = "정지";
  });
  destroyHls(mainHls);
  mainHls = null;
  activeIndex = -1;
  clearMainFrame();
  const mainVideo = document.getElementById("mainVideo");
  mainVideo.pause();
  mainVideo.removeAttribute("src");
  mainVideo.src = "";
  mainVideo.load();
}

function shutdownPlayers() {
  closeCctvSession();
  try { stopAll(true); } catch {}
  try { if (channel) channel.close(); } catch {}
}

async function refreshLive() {
  slots.forEach((slot) => {
    slot.tried = false;
  });
  await prepareCurrentFilterScreens(true);
}

function handleShared(payload) {
  return;
  if (payload?.stopMain) {
    stopMainOnly({ fromShare: true });
    return;
  }
  if (!payload?.broadcastId) return;
  const index = slots.findIndex((slot) => slot.data?.bj === payload.broadcastId);
  if (index >= 0 && index !== activeIndex) setMain(index, { fromShare: true });
}

function mergePlayers(tierPlayers, manualPlayers) {
  const merged = new Map();
  tierPlayers.forEach((player) => merged.set(key(player.name), { ...player }));
  manualPlayers.forEach((manual) => {
    const existing = merged.get(key(manual.name)) || {};
    merged.set(key(manual.name), { ...existing, ...manual, live: existing.live || null });
  });
  return [...merged.values()];
}

function renderManualParticipants() {
  const manualPlayers = loadManualParticipants();
  participantList.innerHTML = "";
  if (!manualPlayers.length) {
    participantList.textContent = "보조로 저장한 SOOP 아이디가 없습니다.";
    return;
  }
  manualPlayers.forEach((player) => {
    const tag = document.createElement("button");
    tag.type = "button";
    tag.className = "cctv-participant-tag";
    tag.textContent = playerLabel(player) + ` · ${player.broadcastId}`;
    tag.onclick = () => {
      document.getElementById("addName").value = player.name;
      document.getElementById("addBroadcastId").value = player.broadcastId;
      document.getElementById("addTier").value = player.tier;
      document.getElementById("addUniversity").value = player.university;
      document.getElementById("addDivision").value = player.division;
    };
    participantList.appendChild(tag);
  });
}

function saveParticipantFromForm() {
  const item = cleanManualParticipant({
    name: document.getElementById("addName").value,
    broadcastId: document.getElementById("addBroadcastId").value,
    tier: document.getElementById("addTier").value,
    university: document.getElementById("addUniversity").value,
    division: document.getElementById("addDivision").value
  });
  if (!item.name || !item.broadcastId) {
    log("티어표 이름과 SOOP 아이디를 입력해 주세요.");
    return;
  }
  const manualPlayers = loadManualParticipants();
  const next = manualPlayers.filter((player) => key(player.name) !== key(item.name));
  next.push(item);
  saveManualParticipants(next);
  renderManualParticipants();
  init(false);
}

function applyTierFromForm() {
  const tier = tierNumber(tierSelect?.value);
  if (tier) applyFilter(`tier:${tier}`, true);
  else log("티어를 선택해 주세요.");
}

function applyUniversityFromForm() {
  const university = universitySelect?.value || "";
  const division = universityDivisionSelect?.value || "women";
  if (!university) {
    log("대학을 선택해 주세요.");
    return;
  }
  if (isNewcastleUniversity(university) && division === "all") applyFilter(`university:${university}`, true);
  else applyFilter(`university_division:${university}:${division}`, true);
}

function showMode(mode) {
  const tierPanel = document.getElementById("tierPanel");
  const universityPanel = document.getElementById("universityPanel");
  const tierModeBtn = document.getElementById("tierModeBtn");
  const universityModeBtn = document.getElementById("universityModeBtn");
  const isTier = mode === "tier";
  tierPanel?.classList.toggle("hidden", !isTier);
  universityPanel?.classList.toggle("hidden", isTier);
  tierModeBtn?.classList.toggle("active", isTier);
  universityModeBtn?.classList.toggle("active", !isTier);
}

async function init(force = false) {
  log(`${CCTV_VERSION} 적용됨 · 기본은 6티어 목록만 먼저 표시하고, 영상은 버튼을 누르면 구성합니다.`);
  log("티어표를 불러오는 중");
  let tierPlayers = [];
  try {
    const tiers = await fetchJson(`/api/tiers${force ? "?refresh=1" : ""}`);
    tierPlayers = (tiers.players || []).filter((player) => player.name && player.tier);
  } catch (error) {
    log("티어표 로딩 실패: " + error.message);
  }

  players = mergePlayers(tierPlayers, loadManualParticipants());
  grid.innerHTML = "";
  slots.length = 0;
  activeIndex = -1;
  players.forEach(createSlot);
  renderSelectors();
  applyFilter(currentFilter);
  log(`티어표 기준 화면 표시 완료: ${players.length}명`);
  log(`cctv 목록 준비 완료: ${filterLabel(currentFilter)} · 사이트 접속 속도를 위해 영상은 자동 시작하지 않습니다. '현재 LIVE 다시 구성'을 눌러 주세요.`);
}

setInterval(() => {
  slots.forEach((slot) => {
    if (!slot.data || !slot.video || slot.video.paused) return;
    const now = slot.video.currentTime || 0;
    if (Math.abs(now - slot.lastTime) < 0.15) {
      slot.stuck += 1;
      if (slot.stuck >= 7) {
        slot.stuck = 0;
        scheduleSlotReload(slot, "stuck");
      }
    } else {
      slot.stuck = 0;
    }
    slot.lastTime = now;
  });
}, 2000);

document.getElementById("randomBtn").onclick = randomMain;
document.getElementById("startSmallBtn").onclick = startVisibleLive;
document.getElementById("proxyMainBtn").onclick = proxyMain;
document.getElementById("retryBtn").onclick = () => {
  prepareCurrentFilterScreens(false);
};
document.getElementById("refreshBtn").onclick = refreshLive;
document.getElementById("stopBtn").onclick = stopMainOnly;
document.getElementById("addParticipantBtn").onclick = saveParticipantFromForm;
document.getElementById("applyTierBtn").onclick = applyTierFromForm;
document.getElementById("applyUniversityBtn").onclick = applyUniversityFromForm;
document.getElementById("tierModeBtn").onclick = () => showMode("tier");
document.getElementById("universityModeBtn").onclick = () => showMode("university");
if (universitySelect) universitySelect.onchange = updateUniversityDivisionOptions;
if (showOfflineToggle) showOfflineToggle.onchange = refreshSlotVisibilityAndOrder;
showMode("tier");

window.addEventListener("storage", (event) => {
  if (event.key === SHARED_KEY) {
    try { handleShared(JSON.parse(event.newValue || "null")); } catch {}
  }
});
window.addEventListener("pagehide", shutdownPlayers);
window.addEventListener("beforeunload", shutdownPlayers);
window.addEventListener("unload", shutdownPlayers);
if (channel) channel.onmessage = (event) => handleShared(event.data);

renderManualParticipants();
startCctvSession();
init().catch((error) => log("초기화 실패: " + error.message));
