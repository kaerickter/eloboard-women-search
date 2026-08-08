const BOOTSTRAP_CONCURRENCY = 5;
const DEFAULT_FILTER = "tier:6";
const MANUAL_KEY = "elo-kitten-cctv-manual-participants-v3";
const SHARED_KEY = "elo-kitten-cctv-main-v3";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("elo-kitten-cctv") : null;

const grid = document.getElementById("grid");
const filterbar = document.getElementById("filterbar");
const logBox = document.getElementById("log");
const participantList = document.getElementById("participantList");
const groupSummary = document.getElementById("groupSummary");
const slots = [];
let players = [];
let currentFilter = DEFAULT_FILTER;
let mainHls = null;
let activeIndex = -1;
let loadingVisible = false;

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

function attach(video, url, label, slot = null) {
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
  });
  hls.on(Hls.Events.ERROR, (_, data) => {
    log(`${label} 오류: ${data.type} / ${data.details}${data.fatal ? " [FATAL]" : ""}`);
    if (!data.fatal) return;
    try {
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else if (slot) setTimeout(() => reloadSlot(slot.index), 1200);
    } catch {
      if (slot) setTimeout(() => reloadSlot(slot.index), 1200);
    }
  });
  return hls;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "요청 실패");
  return data;
}

function createFilter(label, filter) {
  const button = document.createElement("button");
  button.className = "cctv-filter";
  button.type = "button";
  button.dataset.filter = filter;
  button.textContent = label;
  button.onclick = () => applyFilter(filter, true);
  return button;
}

function appendFilterOnce(seen, label, filter) {
  if (seen.has(filter)) return;
  seen.add(filter);
  filterbar.appendChild(createFilter(label, filter));
}

function renderFilters() {
  filterbar.innerHTML = "";
  const seen = new Set();
  appendFilterOnce(seen, "전체", "all");
  appendFilterOnce(seen, "5티어", "tier:5");
  appendFilterOnce(seen, "6티어", "tier:6");
  appendFilterOnce(seen, "뉴캐슬대학", "university:뉴캐슬대학");
  appendFilterOnce(seen, "뉴캐슬대학 여자", "university_division:뉴캐슬대학:women");
  appendFilterOnce(seen, "뉴캐슬대학 남자", "university_division:뉴캐슬대학:men");

  const tiers = [...new Set(players.map((player) => tierNumber(player.tier)).filter(Boolean))]
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"));
  tiers.forEach((tier) => appendFilterOnce(seen, `${tier}티어`, `tier:${tier}`));

  const universities = [...new Set(players.flatMap(universityNames))]
    .sort((a, b) => a.localeCompare(b, "ko"));
  universities.forEach((university) => appendFilterOnce(seen, university, `university:${university}`));

  universities.forEach((university) => {
    ["women", "men"].forEach((division) => {
      if (players.some((player) => player.division === division && hasUniversity(player, university))) {
        appendFilterOnce(
          seen,
          `${university} ${division === "men" ? "남자" : "여자"}`,
          `university_division:${university}:${division}`
        );
      }
    });
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

function updateGroupSummary() {
  const count = slots.filter(matchesFilter).length;
  const liveReady = slots.filter((slot) => matchesFilter(slot) && slot.data).length;
  if (groupSummary) groupSummary.textContent = `현재 기준: ${filterLabel(currentFilter)} · 티어표 인원 ${count}명 · 재생 준비 ${liveReady}명`;
}

function applyFilter(filter, shouldLoad = false) {
  currentFilter = filter;
  document.querySelectorAll(".cctv-filter").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === filter);
  });
  slots.forEach((slot) => slot.card.classList.toggle("hidden", !matchesFilter(slot)));
  updateGroupSummary();
  if (shouldLoad) loadVisibleUnloaded();
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
  card.onclick = () => setMain(index);
  grid.appendChild(card);

  slots.push({ index, player, card, status, video, meta, hls: null, data: null, lastTime: 0, stuck: 0, tried: false });
}

function broadcastIdOf(player) {
  return safeBroadcastId(player.live?.broadcastId || player.broadcastId);
}

async function loadSlot(index) {
  const slot = slots[index];
  slot.tried = true;
  const broadcastId = broadcastIdOf(slot.player);
  if (!broadcastId) {
    slot.status.textContent = "SOOP ID 없음";
    return false;
  }
  if (!slot.player.customCctv && slot.player.live && !slot.player.live.isLive) {
    slot.status.textContent = "오프라인";
    return false;
  }

  slot.status.textContent = "조회 중";
  try {
    const data = await fetchJson(`/api/cctv/bootstrap/${encodeURIComponent(broadcastId)}`);
    slot.data = data;
    slot.status.textContent = "LIVE";
    slot.meta.textContent = `${playerLabel(slot.player)} | LOW ${(data.lowMeta || {}).height || "?"}p | HIGH ${(data.highMeta || {}).height || "?"}p`;
    destroyHls(slot.hls);
    slot.video.pause();
    slot.video.removeAttribute("src");
    slot.video.load();
    slot.video.muted = true;
    slot.hls = attach(slot.video, data.lowUrl, `LOW ${slot.player.name}`, slot);
    updateGroupSummary();
    return true;
  } catch (error) {
    slot.status.textContent = "실패";
    slot.meta.textContent = error.message;
    log(`${slot.player.name}: ${error.message}`);
    return false;
  }
}

async function reloadSlot(index) {
  const slot = slots[index];
  if (!slot.data) return loadSlot(index);
  destroyHls(slot.hls);
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

async function setMain(index, options = {}) {
  const slot = slots[index];
  if (!slot?.data) return;
  activeIndex = index;
  document.querySelectorAll(".cctv-card").forEach((card, cardIndex) => {
    card.classList.toggle("active", cardIndex === index);
  });
  if (!options.fromShare) shareMain(slot.data.bj);

  document.getElementById("mainTitle").textContent = "MAIN - " + slot.player.name;
  document.getElementById("mainStatus").textContent = "최고화질 연결 중";
  try {
    const data = await fetchJson(`/api/cctv/high/${encodeURIComponent(slot.data.bj)}`);
    slot.data = Object.assign({}, slot.data, data);
    destroyHls(mainHls);
    const video = document.getElementById("mainVideo");
    video.pause();
    video.removeAttribute("src");
    video.load();
    document.getElementById("mainTitle").textContent = "MAIN - " + slot.player.name;
    document.getElementById("mainStatus").textContent = "최고화질";
    document.getElementById("mainMeta").textContent = `${playerLabel(slot.player)} | HIGH ${(data.highMeta || {}).height || "?"}p`;
    mainHls = attach(video, data.highUrl + "?r=" + Date.now(), `HIGH ${slot.player.name}`);
  } catch (error) {
    document.getElementById("mainStatus").textContent = "실패";
    document.getElementById("mainMeta").textContent = error.message;
  }
}

async function loadVisibleUnloaded() {
  if (loadingVisible) return;
  loadingVisible = true;
  let first = -1;
  let cursor = 0;
  const targets = slots.filter((slot) => matchesFilter(slot) && !slot.data && !slot.tried);
  async function worker() {
    while (cursor < targets.length) {
      const slot = targets[cursor++];
      const ok = await loadSlot(slot.index);
      if (ok && first < 0) first = slot.index;
    }
  }
  await Promise.all(Array.from({ length: Math.min(BOOTSTRAP_CONCURRENCY, targets.length) }, worker));
  if (activeIndex < 0 && first >= 0) await setMain(first);
  loadingVisible = false;
  updateGroupSummary();
}

async function startVisibleLive() {
  await loadVisibleUnloaded();
  const first = slots.find((slot) => matchesFilter(slot) && slot.data);
  if (first) await setMain(first.index);
}

async function randomMain() {
  const candidates = slots.filter((slot) => slot.data && matchesFilter(slot));
  if (!candidates.length) {
    log("현재 기준에서 재생 가능한 방송이 아직 없습니다.");
    await loadVisibleUnloaded();
    return;
  }
  const slot = candidates[Math.floor(Math.random() * candidates.length)];
  await setMain(slot.index);
}

function stopAll() {
  slots.forEach((slot) => {
    destroyHls(slot.hls);
    slot.hls = null;
    slot.video.pause();
    slot.video.removeAttribute("src");
    slot.video.load();
    slot.status.textContent = "정지";
  });
  destroyHls(mainHls);
  mainHls = null;
  activeIndex = -1;
  const mainVideo = document.getElementById("mainVideo");
  mainVideo.pause();
  mainVideo.removeAttribute("src");
  mainVideo.load();
}

async function refreshLive() {
  stopAll();
  await init(true);
}

function handleShared(payload) {
  if (!payload?.broadcastId) return;
  const index = slots.findIndex((slot) => slot.data?.bj === payload.broadcastId);
  if (index >= 0 && index !== activeIndex) setMain(index, { fromShare: true });
}

function mergePlayers(tierPlayers, manualPlayers, liveByName) {
  const merged = new Map();
  tierPlayers.forEach((player) => {
    const normalized = {
      ...player,
      live: liveByName.get(key(player.name)) || null
    };
    merged.set(key(normalized.name), normalized);
  });
  manualPlayers.forEach((manual) => {
    const existing = merged.get(key(manual.name)) || {};
    merged.set(key(manual.name), {
      ...existing,
      ...manual,
      live: existing.live || null
    });
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

function applyGroupFromForm() {
  const type = document.getElementById("groupType").value;
  const tier = tierNumber(document.getElementById("groupTier").value);
  const university = document.getElementById("groupUniversity").value.trim();
  const division = document.getElementById("groupDivision").value;
  if (type === "tier" && tier) applyFilter(`tier:${tier}`, true);
  else if (type === "university" && university) applyFilter(`university:${university}`, true);
  else if (type === "university_division" && university && division) applyFilter(`university_division:${university}:${division}`, true);
  else log("티어 또는 대학 이름을 입력해 주세요.");
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

  players = mergePlayers(tierPlayers, loadManualParticipants(), new Map());

  grid.innerHTML = "";
  slots.length = 0;
  activeIndex = -1;
  players.forEach(createSlot);
  renderFilters();
  applyFilter(currentFilter);
  log(`티어표 기준 화면 표시 완료: ${players.length}명`);

  const names = tierPlayers.map((player) => player.name);
  try {
    const live = names.length ? await fetchJson("/api/live-status" + (force ? "?refresh=1" : ""), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ names, refresh: force })
    }) : { statuses: [] };
    const liveByName = new Map((live.statuses || []).map((status) => [key(status.name), status]));
    players = mergePlayers(tierPlayers, loadManualParticipants(), liveByName);
    grid.innerHTML = "";
    slots.length = 0;
    activeIndex = -1;
    players.forEach(createSlot);
    renderFilters();
    applyFilter(currentFilter);
    log("LIVE 상태 반영 완료");
  } catch (error) {
    log("LIVE 상태 조회 실패 - 티어표 목록은 그대로 표시합니다: " + error.message);
  }

  await startVisibleLive();
  log(`cctv 준비 완료: ${players.length}명`);
}

setInterval(() => {
  slots.forEach((slot) => {
    if (!slot.data || !slot.video || slot.video.paused) return;
    const now = slot.video.currentTime || 0;
    if (Math.abs(now - slot.lastTime) < 0.15) {
      slot.stuck += 1;
      if (slot.stuck >= 5) {
        slot.stuck = 0;
        reloadSlot(slot.index);
      }
    } else {
      slot.stuck = 0;
    }
    slot.lastTime = now;
  });
}, 2000);

document.getElementById("randomBtn").onclick = randomMain;
document.getElementById("retryBtn").onclick = () => slots.forEach((slot) => { if (slot.data) reloadSlot(slot.index); });
document.getElementById("refreshBtn").onclick = refreshLive;
document.getElementById("stopBtn").onclick = stopAll;
document.getElementById("addParticipantBtn").onclick = saveParticipantFromForm;
document.getElementById("applyGroupBtn").onclick = applyGroupFromForm;
document.getElementById("groupType").onchange = () => {
  const type = document.getElementById("groupType").value;
  document.getElementById("groupTier").style.display = type === "tier" ? "" : "none";
  document.getElementById("groupUniversity").style.display = type === "tier" ? "none" : "";
  document.getElementById("groupDivision").style.display = type === "university_division" ? "" : "none";
};
document.getElementById("groupType").dispatchEvent(new Event("change"));

window.addEventListener("storage", (event) => {
  if (event.key === SHARED_KEY) {
    try { handleShared(JSON.parse(event.newValue || "null")); } catch {}
  }
});
if (channel) channel.onmessage = (event) => handleShared(event.data);

renderManualParticipants();
init().catch((error) => log("초기화 실패: " + error.message));
