const BOOTSTRAP_CONCURRENCY = 2;
const FIRST_SMALL_COUNT = 2;
const SERVER_COOLDOWN_MS = 30000;
const DEFAULT_FILTER = "tier:6";
const MANUAL_KEY = "elo-kitten-cctv-manual-participants-v3";
const SHARED_KEY = "elo-kitten-cctv-main-v3";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("elo-kitten-cctv") : null;

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

function log(message) {
  const time = new Date().toLocaleTimeString();
  logBox.textContent += `[${time}] ${message}\n`;
  logBox.scrollTop = logBox.scrollHeight;
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

function attach(video, url, label, slot = null, options = {}) {
  let fatalHandled = false;
  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: true,
    liveSyncDurationCount: 2,
    liveMaxLatencyDurationCount: 5,
    backBufferLength: 8,
    maxBufferLength: 10,
    maxMaxBufferLength: 16,
    manifestLoadingMaxRetry: 4,
    levelLoadingMaxRetry: 4,
    fragLoadingMaxRetry: 4
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    video.play().catch(() => {});
    log(`${label} 연결 완료`);
    if (slot) {
      setTimeout(() => {
        if (!isShuttingDown && slot.hls === hls && slot.data && !slot.video.paused) slot.reloadCount = 0;
      }, 30000);
    }
  });
  hls.on(Hls.Events.ERROR, (_, data) => {
    log(`${label} 오류: ${data.type} / ${data.details}${data.fatal ? " [FATAL]" : ""}`);
    if (isShuttingDown) return;
    if (!data.fatal) return;
    if (!slot) {
      if (fatalHandled) return;
      fatalHandled = true;
      try { if (typeof options.onFatal === "function") options.onFatal(data, hls); }
      catch {}
      return;
    }
    try {
      if (data.details === "levelParsingError" && slot) scheduleSlotReload(slot, "playlist");
      else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
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
  return Boolean(slot?.data || slot?.player?.live?.isLive);
}

function isSlotKnownOffline(slot) {
  return Boolean(slot?.player?.live && !slot.player.live.isLive && !slot.data);
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
      if (!status) return;
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

function applyFilter(filter, shouldLoad = false) {
  currentFilter = filter;
  refreshSlotVisibilityAndOrder();
  if (shouldLoad) refreshCurrentFilterLive(false);
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

async function loadSlot(index) {
  const slot = slots[index];
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
    restoreSlotVideo(slot);
    destroyHls(slot.hls);
    slot.video.pause();
    slot.video.removeAttribute("src");
    slot.video.load();
    slot.video.muted = true;
    slot.hls = attach(slot.video, data.lowUrl, `LOW ${slot.player.name}`, slot);
    refreshSlotVisibilityAndOrder();
    return true;
  } catch (error) {
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
  const url = soopDirectUrl(slot.player);
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

  const open = document.createElement("a");
  open.href = url;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = "SOOP 바로 열기";
  open.onclick = (event) => event.stopPropagation();

  const hint = document.createElement("span");
  hint.textContent = "원본 화면";

  wrap.append(iframe, hint, open);
  slot.playerBox.appendChild(wrap);
  slot.directPreview = true;
  slot.status.textContent = "SOOP 원본";
  slot.meta.textContent = `${playerLabel(slot.player)} | 원본 화면 우선 · 클릭하면 MAIN`;
  refreshSlotVisibilityAndOrder();
  return true;
}

function restoreSlotVideo(slot) {
  if (!slot || !slot.directPreview) return;
  slot.playerBox.innerHTML = "";
  slot.playerBox.appendChild(slot.video);
  slot.directPreview = false;
}

function scheduleSlotReload(slot, reason = "error") {
  if (!slot || isShuttingDown || slot.reloadTimer) return;
  const delays = [5000, 15000, 30000, 60000];
  const delay = delays[Math.min(slot.reloadCount, delays.length - 1)];
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
  if (!slot.data) return loadSlot(index);
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
  const payload = { broadcastId, at: Date.now() };
  localStorage.setItem(SHARED_KEY, JSON.stringify(payload));
  if (channel) channel.postMessage(payload);
}

function shareMainStop() {
  const payload = { stopMain: true, at: Date.now() };
  localStorage.setItem(SHARED_KEY, JSON.stringify(payload));
  if (channel) channel.postMessage(payload);
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

async function setMain(index, options = {}) {
  const slot = slots[index];
  if (!slot?.data) return;
  const cachedHighUrl = slot.data.highUrl;
  const currentPlayId = ++mainPlayId;
  let usedLowFallback = false;
  activeIndex = index;
  document.querySelectorAll(".cctv-card").forEach((card, cardIndex) => {
    card.classList.toggle("active", cardIndex === index);
  });
  if (!options.fromShare) shareMain(slot.data.bj);

  document.getElementById("mainTitle").textContent = "MAIN - " + slot.player.name;
  document.getElementById("mainStatus").textContent = cachedHighUrl ? "최고화질 연결 중" : "최고화질 조회 중";
  const video = document.getElementById("mainVideo");
  const playMainUrl = (url, quality) => {
    destroyHls(mainHls);
    clearVideo(video);
    document.getElementById("mainStatus").textContent = quality;
    document.getElementById("mainMeta").textContent = `${playerLabel(slot.player)} | ${quality} ${(quality === "LOW" ? (slot.data.lowMeta || {}).height : (slot.data.highMeta || {}).height) || "?"}p`;
    mainHls = attach(video, cacheBust(url), `${quality} ${slot.player.name}`, null, {
      onFatal: () => {
        if (currentPlayId !== mainPlayId || isShuttingDown) return;
        destroyHls(mainHls);
        mainHls = null;
        if (!usedLowFallback && quality === "HIGH" && slot.data.lowUrl) {
          usedLowFallback = true;
          document.getElementById("mainStatus").textContent = "HIGH 불안정 · LOW로 전환";
          log(`${slot.player.name} MAIN HIGH 불안정 - LOW로 전환합니다.`);
          playMainUrl(slot.data.lowUrl, "LOW");
          return;
        }
        clearVideo(video);
        document.getElementById("mainStatus").textContent = "재생 불안정";
        document.getElementById("mainMeta").textContent = "이 방송 주소가 불안정해서 MAIN 재시도를 멈췄습니다. 다른 방송을 선택해 주세요.";
      }
    });
  };
  if (cachedHighUrl) {
    playMainUrl(cachedHighUrl, "HIGH");
    fetchJson(`/api/cctv/high/${encodeURIComponent(slot.data.bj)}`)
      .then((data) => { slot.data = Object.assign({}, slot.data, data); })
      .catch((error) => {
        if (error.code === "EMPTY_JSON" || error.code === "INVALID_JSON") enterServerCooldown(error.message);
        else log(`${slot.player.name} HIGH 갱신 실패: ${error.message}`);
      });
    return;
  }
  try {
    const data = await fetchJson(`/api/cctv/high/${encodeURIComponent(slot.data.bj)}`);
    slot.data = Object.assign({}, slot.data, data);
    playMainUrl(data.highUrl, "HIGH");
  } catch (error) {
    if (error.code === "EMPTY_JSON" || error.code === "INVALID_JSON") {
      enterServerCooldown(error.message);
      document.getElementById("mainStatus").textContent = "잠시 후";
      document.getElementById("mainMeta").textContent = error.message;
      return;
    }
    document.getElementById("mainStatus").textContent = "실패";
    document.getElementById("mainMeta").textContent = error.message;
  }
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
    .filter((slot) => matchesFilter(slot) && isSlotLive(slot) && !isSlotKnownOffline(slot) && !slot.data && !slot.tried)
    .slice(0, limit);
  async function worker() {
    while (cursor < targets.length && !isServerCoolingDown()) {
      const slot = targets[cursor++];
      await loadSlot(slot.index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(BOOTSTRAP_CONCURRENCY, targets.length) }, worker));
  loadingVisible = false;
  refreshSlotVisibilityAndOrder();
}

async function startVisibleLive() {
  const targets = slots
    .filter((slot) => matchesFilter(slot) && isSlotLive(slot) && !isSlotKnownOffline(slot) && !slot.directPreview)
    .slice(0, FIRST_SMALL_COUNT);
  let shown = 0;
  targets.forEach((slot) => {
    if (showSoopDirectPreview(slot.index)) shown += 1;
  });
  log(shown ? `SOOP 원본 빠른 화면 ${shown}명 표시 완료` : "표시할 LIVE 원본 화면이 아직 없습니다.");
}

async function openSlotMain(index) {
  const slot = slots[index];
  if (!slot) return;
  if (isServerCoolingDown() && !slot.data) {
    slot.status.textContent = "서버 쉬는 중";
    log("서버가 잠시 쉬는 중입니다. 30초 뒤 다시 클릭해 주세요.");
    return;
  }
  if (!slot.data) {
    const ok = await loadSlot(index);
    if (!ok) return;
  }
  await setMain(index);
}

async function randomMain() {
  if (isServerCoolingDown()) {
    log("서버가 잠시 쉬는 중입니다. 30초 뒤 다시 시도해 주세요.");
    return;
  }
  const candidates = slots.filter((slot) => slot.data && matchesFilter(slot));
  if (!candidates.length) {
    await refreshCurrentFilterLive(false);
    if (isServerCoolingDown()) return;
    const liveTargets = slots.filter((slot) => matchesFilter(slot) && isSlotLive(slot) && !slot.data && !isSlotKnownOffline(slot));
    if (!liveTargets.length) {
      log("현재 기준에서 재생 가능한 방송이 아직 없습니다.");
      return;
    }
    const target = liveTargets[Math.floor(Math.random() * liveTargets.length)];
    const ok = await loadSlot(target.index);
    if (ok) await setMain(target.index);
    return;
  }
  const slot = candidates[Math.floor(Math.random() * candidates.length)];
  await setMain(slot.index);
}

function stopMainOnly(options = {}) {
  mainPlayId += 1;
  destroyHls(mainHls);
  mainHls = null;
  activeIndex = -1;
  document.querySelectorAll(".cctv-card").forEach((card) => card.classList.remove("active"));
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
  const mainVideo = document.getElementById("mainVideo");
  mainVideo.pause();
  mainVideo.removeAttribute("src");
  mainVideo.src = "";
  mainVideo.load();
}

function shutdownPlayers() {
  try { stopAll(true); } catch {}
  try { if (channel) channel.close(); } catch {}
}

async function refreshLive() {
  slots.forEach((slot) => {
    slot.tried = false;
  });
  await refreshCurrentFilterLive(true);
}

function handleShared(payload) {
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
  await refreshCurrentFilterLive(force);
  log(`cctv 목록 준비 완료: ${filterLabel(currentFilter)} · 작은화면은 버튼을 누르면 시작됩니다.`);
}

setInterval(() => {
  slots.forEach((slot) => {
    if (!slot.data || !slot.video || slot.video.paused) return;
    const now = slot.video.currentTime || 0;
    if (Math.abs(now - slot.lastTime) < 0.15) {
      slot.stuck += 1;
      if (slot.stuck >= 5) {
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
document.getElementById("retryBtn").onclick = () => slots.forEach((slot) => { if (slot.data) reloadSlot(slot.index); });
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
init().catch((error) => log("초기화 실패: " + error.message));
