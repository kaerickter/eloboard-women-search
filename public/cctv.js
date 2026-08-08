const BOOTSTRAP_CONCURRENCY = 5;
const DEFAULT_FILTER = "tier:6";
const SHARED_KEY = "elo-kitten-cctv-main-v1";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("elo-kitten-cctv") : null;
const grid = document.getElementById("grid");
const filterbar = document.getElementById("filterbar");
const logBox = document.getElementById("log");
const slots = [];
let players = [];
let currentFilter = DEFAULT_FILTER;
let mainHls = null;
let activeIndex = -1;

function log(message) {
  const time = new Date().toLocaleTimeString();
  logBox.textContent += `[${time}] ${message}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

function destroyHls(hls) {
  if (hls) {
    try { hls.destroy(); } catch {}
  }
}

function key(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function tierNumber(value) {
  const match = String(value || "").match(/\d+/);
  return match ? match[0] : String(value || "").trim();
}

function universityNames(player) {
  return [...new Set([
    ...(Array.isArray(player.universities) ? player.universities : []),
    player.university
  ].map((item) => String(item || "").trim()).filter(Boolean))];
}

function playerDivisionLabel(player) {
  if (player.division === "men") return "남자";
  if (player.division === "women") return "여자";
  return "미지정";
}

function playerLabel(player) {
  return `${player.name} · ${player.tier || "티어 미지정"} · ${universityNames(player)[0] || "대학 미지정"} · ${playerDivisionLabel(player)}`;
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
  button.onclick = () => applyFilter(filter);
  return button;
}

function renderFilters() {
  filterbar.innerHTML = "";
  filterbar.appendChild(createFilter("전체", "all"));

  const tiers = [...new Set(players.map((player) => tierNumber(player.tier)).filter(Boolean))]
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"));
  tiers.forEach((tier) => filterbar.appendChild(createFilter(`${tier}티어`, `tier:${tier}`)));

  const universities = [...new Set(players.flatMap(universityNames))]
    .sort((a, b) => a.localeCompare(b, "ko"));
  universities.forEach((university) => filterbar.appendChild(createFilter(university, `university:${university}`)));

  const genderGroups = [];
  universities.forEach((university) => {
    ["women", "men"].forEach((division) => {
      if (players.some((player) => player.division === division && universityNames(player).includes(university))) {
        genderGroups.push({ university, division });
      }
    });
  });
  genderGroups.forEach(({ university, division }) => {
    filterbar.appendChild(createFilter(`${university} ${division === "men" ? "남자" : "여자"}`, `university_division:${university}:${division}`));
  });
}

function matchesFilter(slot) {
  const player = slot.player;
  if (currentFilter === "all") return true;
  const parts = currentFilter.split(":");
  if (parts[0] === "tier") return tierNumber(player.tier) === parts[1];
  if (parts[0] === "university") return universityNames(player).includes(parts[1]);
  if (parts[0] === "university_division") return universityNames(player).includes(parts[1]) && player.division === parts[2];
  return true;
}

function applyFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll(".cctv-filter").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === filter);
  });
  slots.forEach((slot) => slot.card.classList.toggle("hidden", !matchesFilter(slot)));
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

  slots.push({ index, player, card, status, video, meta, hls: null, data: null, lastTime: 0, stuck: 0 });
}

async function loadSlot(index) {
  const slot = slots[index];
  const broadcastId = slot.player.live?.broadcastId || slot.player.broadcastId;
  if (!broadcastId) {
    slot.status.textContent = "채널 없음";
    return false;
  }
  if (!slot.player.live?.isLive) {
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

async function startVisibleLive() {
  let first = -1;
  let cursor = 0;
  async function worker() {
    while (cursor < slots.length) {
      const index = cursor++;
      const ok = matchesFilter(slots[index]) ? await loadSlot(index) : false;
      if (ok && first < 0) first = index;
    }
  }
  await Promise.all(Array.from({ length: Math.min(BOOTSTRAP_CONCURRENCY, slots.length) }, worker));
  if (first >= 0) await setMain(first);
}

async function randomMain() {
  const candidates = slots.filter((slot) => slot.data && matchesFilter(slot));
  if (!candidates.length) {
    log("현재 필터에 재생 가능한 방송이 없습니다.");
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

async function init(force = false) {
  log("티어표와 LIVE 상태를 불러오는 중");
  const tiers = await fetchJson(`/api/tiers${force ? "?refresh=1" : ""}`);
  const sourcePlayers = (tiers.players || []).filter((player) => player.name && player.tier);
  const names = sourcePlayers.map((player) => player.name);
  const live = await fetchJson("/api/live-status" + (force ? "?refresh=1" : ""), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ names, refresh: force })
  });
  const liveByName = new Map((live.statuses || []).map((status) => [key(status.name), status]));
  players = sourcePlayers
    .map((player) => ({ ...player, live: liveByName.get(key(player.name)) || null }))
    .filter((player) => player.live?.broadcastId || player.broadcastId);

  grid.innerHTML = "";
  slots.length = 0;
  players.forEach(createSlot);
  renderFilters();
  applyFilter(currentFilter);
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
window.addEventListener("storage", (event) => {
  if (event.key === SHARED_KEY) {
    try { handleShared(JSON.parse(event.newValue || "null")); } catch {}
  }
});
if (channel) channel.onmessage = (event) => handleShared(event.data);

init().catch((error) => log("초기화 실패: " + error.message));
