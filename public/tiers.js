const board = document.getElementById("tierBoard");
const statusLine = document.getElementById("boardStatus");
const refreshButton = document.getElementById("refreshButton");
const countdown = document.getElementById("refreshCountdown");
const universityFilters = document.getElementById("universityFilters");
const universityFilterSummary = document.getElementById("universityFilterSummary");
const tierAdminOpen = document.getElementById("tierAdminOpen");
const tierAdminDialog = document.getElementById("tierAdminDialog");
const tierAdminClose = document.getElementById("tierAdminClose");
const tierAdminLogin = document.getElementById("tierAdminLogin");
const tierAdminPassword = document.getElementById("tierAdminPassword");
const tierAdminManager = document.getElementById("tierAdminManager");
const tierAdminHeader = tierAdminDialog.querySelector(".tier-admin-header");
const tierAdminPlayerSearch = document.getElementById("tierAdminPlayerSearch");
const tierAdminPlayerSuggestions = document.getElementById("tierAdminPlayerSuggestions");
const tierAdminCreatePlayer = document.getElementById("tierAdminCreatePlayer");
const tierAdminNewName = document.getElementById("tierAdminNewName");
const tierAdminNewTier = document.getElementById("tierAdminNewTier");
const tierAdminNewRace = document.getElementById("tierAdminNewRace");
const tierAdminNewUniversity = document.getElementById("tierAdminNewUniversity");
const tierAdminNewBroadcastId = document.getElementById("tierAdminNewBroadcastId");
const tierAdminCreateConfirm = document.getElementById("tierAdminCreateConfirm");
const tierAdminCreateCancel = document.getElementById("tierAdminCreateCancel");
const tierAdminTier = document.getElementById("tierAdminTier");
const tierAdminPromotion = document.getElementById("tierAdminPromotion");
const tierAdminMemberships = document.getElementById("tierAdminMemberships");
const tierAdminUniversity = document.getElementById("tierAdminUniversity");
const tierAdminUniversityOptions = document.getElementById("tierAdminUniversityOptions");
const tierAdminAdd = document.getElementById("tierAdminAdd");
const tierAdminMakeFa = document.getElementById("tierAdminMakeFa");
const tierAdminRevert = document.getElementById("tierAdminRevert");
const tierAdminLogout = document.getElementById("tierAdminLogout");
const tierAdminStatus = document.getElementById("tierAdminStatus");
const LIVE_POLL_MS = 15000;
const MAX_ANIMATED_PROFILES = 4;
const ALL_UNIVERSITIES = "__all__";
const FREE_AGENTS = "__fa__";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let livePollTimer = null;
let profileObserver = null;
let tierAdminCsrf = "";
let tierAdminSaving = false;
let tierAdminSelectedName = "";
let tierAdminSuggestionIndex = -1;
let tierAdminDrag = null;
let tierAdminStorage = { mode: "unknown", durable: false, message: "" };

const state = {
  players: [],
  liveByName: new Map(),
  loadingLive: false,
  refreshingTiers: new Set(),
  openCard: null,
  selectedUniversity: ALL_UNIVERSITIES
};

function keyOf(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function formatViewers(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value || 0)) + "명 시청";
}

function avatar(player) {
  const initial = Array.from(player.name || "?")[0] || "?";
  const fallbackUrl = safeExternalUrl(player.image);
  const staticUrl = safeExternalUrl(player.tierStaticImage) || fallbackUrl;
  const animatedUrl = safeExternalUrl(player.tierAnimatedImage);
  const image = staticUrl
    ? '<img class="player-photo" src="' + escapeHtml(staticUrl) + '" alt="" loading="lazy" decoding="async" fetchpriority="low"' +
      ' data-static-src="' + escapeHtml(staticUrl) + '"' +
      ' data-animated-src="' + escapeHtml(animatedUrl) + '"' +
      ' data-fallback-src="' + escapeHtml(fallbackUrl) + '">'
    : "";
  return '<span class="player-avatar">' + escapeHtml(initial) + image + "</span>";
}

function popover(live) {
  if (!live?.isLive) return "";
  const thumbnailUrl = safeExternalUrl(live.thumbnail);
  const broadcastUrl = safeExternalUrl(live.broadcastUrl);
  const image = thumbnailUrl
    ? '<img src="' + escapeHtml(thumbnailUrl) + '" alt="현재 방송 썸네일" loading="lazy">'
    : "";
  return [
    '<aside class="live-popover" aria-label="현재 방송 정보">',
    '<div class="popover-thumb" data-viewers="' + escapeHtml(formatViewers(live.viewerCount)) + '">' + image + "</div>",
    '<div class="popover-copy">',
    '<p class="popover-title">' + escapeHtml(live.title || "현재 방송 중입니다.") + "</p>",
    broadcastUrl ? '<a class="watch-link" href="' + escapeHtml(broadcastUrl) + '" target="_blank" rel="noreferrer">방송 보러가기</a>' : "",
    "</div></aside>"
  ].join("");
}

const RACE_GROUPS = [
  { code: "T", label: "테란", className: "terran" },
  { code: "P", label: "프로토스", className: "protoss" },
  { code: "Z", label: "저그", className: "zerg" }
];

function playerCard(player) {
  const live = state.liveByName.get(keyOf(player.name));
  const href = safeExternalUrl(live?.broadcastUrl || player.profileUrl) || "#";
  const raceClass = RACE_GROUPS.find((item) => item.code === player.race)?.className || "unknown";
  return [
    '<article class="player-card race-' + raceClass +
      (live?.isLive ? " is-live" : "") +
      (player.promotionLight ? " is-promotion" : "") + '"',
    ' tabindex="0" role="link"',
    ' data-href="' + escapeHtml(href) + '"',
    ' data-player="' + escapeHtml(keyOf(player.name)) + '"',
    ' aria-label="' + escapeHtml(player.name + (live?.isLive ? " LIVE, 방송 정보 보기" : " 프로필 열기")) + '">',
    '<span class="live-badge">LIVE</span>',
    player.promotionLight ? '<span class="promotion-badge">승급불</span>' : "",
    avatar(player),
    '<span class="player-name">' + escapeHtml(player.name) + "</span>",
    popover(live),
    "</article>"
  ].join("");
}

function raceSection(players, race) {
  const racePlayers = players.filter((player) => player.race === race.code);
  if (!racePlayers.length) return "";
  return [
    '<section class="race-group race-' + race.className + '" aria-label="' + race.label + '">',
    '<div class="tier-cards">' + racePlayers.map(playerCard).join("") + "</div>",
    "</section>"
  ].join("");
}

function playerUniversities(player) {
  const values = Array.isArray(player?.universities) && player.universities.length
    ? player.universities
    : [player?.university];
  return [...new Set(values
    .map((value) => String(value || "").trim())
    .filter((value) => value && value !== "FA" && value !== "연합팀"))];
}

function isFreeAgent(player) {
  return playerUniversities(player).length === 0;
}

function universityOptions() {
  const names = [...new Set(state.players.flatMap(playerUniversities))]
    .sort((nameA, nameB) => nameA.localeCompare(nameB, "ko"));
  return names.map((name) => ({
    value: name,
    label: name,
    count: state.players.filter((player) => playerUniversities(player).includes(name)).length
  }));
}

function matchesUniversity(player) {
  if (state.selectedUniversity === ALL_UNIVERSITIES) return true;
  if (state.selectedUniversity === FREE_AGENTS) return isFreeAgent(player);
  return playerUniversities(player).includes(state.selectedUniversity);
}

function renderUniversityFilters() {
  const universities = universityOptions();
  const freeAgentCount = state.players.filter(isFreeAgent).length;
  const validFilters = new Set([
    ALL_UNIVERSITIES,
    FREE_AGENTS,
    ...universities.map((item) => item.value)
  ]);
  if (!validFilters.has(state.selectedUniversity)) state.selectedUniversity = ALL_UNIVERSITIES;

  const options = [
    { value: ALL_UNIVERSITIES, label: "전체", count: state.players.length },
    ...universities,
    { value: FREE_AGENTS, label: "FA", count: freeAgentCount }
  ];
  universityFilters.innerHTML = options.map((option) => {
    const active = option.value === state.selectedUniversity;
    return [
      '<button class="university-filter-button' + (active ? " is-active" : "") + '" type="button"',
      ' data-university-filter="' + escapeHtml(option.value) + '"',
      ' aria-pressed="' + String(active) + '">',
      '<span>' + escapeHtml(option.label) + "</span>",
      '<span class="university-filter-count">' + option.count + "</span>",
      "</button>"
    ].join("");
  }).join("");

  if (state.selectedUniversity === ALL_UNIVERSITIES) {
    universityFilterSummary.textContent = "전체 " + state.players.length + "명";
  } else if (state.selectedUniversity === FREE_AGENTS) {
    universityFilterSummary.textContent = "FA " + freeAgentCount + "명";
  } else {
    const selected = universities.find((item) => item.value === state.selectedUniversity);
    universityFilterSummary.textContent = state.selectedUniversity + " " + Number(selected?.count || 0) + "명";
  }
}

function adminSelectedPlayer() {
  const selectedKey = keyOf(tierAdminSelectedName || tierAdminPlayerSearch.value);
  return state.players.find((player) => keyOf(player.name) === selectedKey) || null;
}

function playerSearchKey(value) {
  return keyOf(value).replace(/[^0-9a-z가-힣]/gi, "");
}

function playerNameDistance(valueA, valueB) {
  const charsA = Array.from(valueA);
  const charsB = Array.from(valueB);
  const row = Array.from({ length: charsB.length + 1 }, (_, index) => index);
  for (let indexA = 1; indexA <= charsA.length; indexA += 1) {
    let diagonal = row[0];
    row[0] = indexA;
    for (let indexB = 1; indexB <= charsB.length; indexB += 1) {
      const previous = row[indexB];
      row[indexB] = Math.min(
        row[indexB] + 1,
        row[indexB - 1] + 1,
        diagonal + Number(charsA[indexA - 1] !== charsB[indexB - 1])
      );
      diagonal = previous;
    }
  }
  return row[charsB.length];
}

function playerSearchScore(name, query) {
  const nameKey = playerSearchKey(name);
  const queryKey = playerSearchKey(query);
  if (!queryKey) return 10;
  if (nameKey === queryKey) return 0;
  if (nameKey.startsWith(queryKey)) return 1;
  if (nameKey.includes(queryKey)) return 2;
  let cursor = 0;
  for (const character of nameKey) {
    if (character === Array.from(queryKey)[cursor]) cursor += 1;
    if (cursor === Array.from(queryKey).length) return 3;
  }
  const distance = playerNameDistance(nameKey, queryKey);
  return distance <= Math.max(1, Math.floor(queryKey.length * .34)) ? 4 + distance : Number.POSITIVE_INFINITY;
}

function matchingAdminPlayers(query) {
  return state.players
    .map((player) => ({ player, score: playerSearchScore(player.name, query) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((itemA, itemB) =>
      itemA.score - itemB.score || itemA.player.name.localeCompare(itemB.player.name, "ko"))
    .slice(0, 10)
    .map((item) => item.player);
}

function hideTierAdminSuggestions() {
  tierAdminPlayerSuggestions.hidden = true;
  tierAdminPlayerSuggestions.innerHTML = "";
  tierAdminPlayerSearch.setAttribute("aria-expanded", "false");
  tierAdminPlayerSearch.removeAttribute("aria-activedescendant");
  tierAdminSuggestionIndex = -1;
}

function renderTierAdminSuggestions() {
  const query = String(tierAdminPlayerSearch.value || "").replace(/\s+/g, " ").trim();
  const players = matchingAdminPlayers(tierAdminPlayerSearch.value);
  const hasExact = state.players.some((player) => keyOf(player.name) === keyOf(query));
  tierAdminSuggestionIndex = players.length ? 0 : -1;
  const playerButtons = players.map((player, index) => [
        '<button id="tierAdminSuggestion-' + index + '" class="tier-admin-player-suggestion',
        index === 0 ? " is-active" : "",
        '" type="button" role="option" aria-selected="' + String(index === 0) + '"',
        ' data-player-name="' + escapeHtml(player.name) + '">',
        '<strong>' + escapeHtml(player.name) + "</strong>",
        '<span>' + escapeHtml(player.tier === "FA" ? "FA" : player.tier + "티어") + "</span>",
        "</button>"
      ].join("")).join("");
  const createButton = query && !hasExact
    ? '<button class="tier-admin-create-suggestion" type="button" data-create-player="' +
      escapeHtml(query) + '"><strong>＋ ' + escapeHtml(query) +
      '</strong><span>새 선수로 등록</span></button>'
    : "";
  tierAdminPlayerSuggestions.innerHTML = playerButtons + createButton ||
    '<p class="tier-admin-no-results">등록된 선수가 없습니다.</p>';
  tierAdminPlayerSuggestions.hidden = false;
  tierAdminPlayerSearch.setAttribute("aria-expanded", "true");
  if (players.length) tierAdminPlayerSearch.setAttribute("aria-activedescendant", "tierAdminSuggestion-0");
}

function openTierAdminCreatePlayer(name) {
  tierAdminSelectedName = "";
  tierAdminNewName.value = String(name || tierAdminPlayerSearch.value || "").replace(/\s+/g, " ").trim();
  tierAdminNewTier.value = "6";
  tierAdminNewRace.value = "T";
  tierAdminNewUniversity.value = "";
  tierAdminNewBroadcastId.value = "";
  tierAdminCreatePlayer.hidden = false;
  hideTierAdminSuggestions();
  renderTierAdminMemberships();
  tierAdminNewName.focus();
}

function closeTierAdminCreatePlayer() {
  tierAdminCreatePlayer.hidden = true;
}

function moveTierAdminSuggestion(direction) {
  const buttons = [...tierAdminPlayerSuggestions.querySelectorAll("[data-player-name]")];
  if (!buttons.length) return;
  tierAdminSuggestionIndex = (tierAdminSuggestionIndex + direction + buttons.length) % buttons.length;
  buttons.forEach((button, index) => {
    const active = index === tierAdminSuggestionIndex;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const active = buttons[tierAdminSuggestionIndex];
  tierAdminPlayerSearch.setAttribute("aria-activedescendant", active.id);
  active.scrollIntoView({ block: "nearest" });
}

function selectTierAdminPlayer(name) {
  const player = state.players.find((item) => keyOf(item.name) === keyOf(name));
  if (!player) return;
  tierAdminSelectedName = player.name;
  tierAdminPlayerSearch.value = player.name;
  closeTierAdminCreatePlayer();
  hideTierAdminSuggestions();
  renderTierAdminMemberships();
}

function setTierAdminView(authenticated) {
  tierAdminLogin.hidden = authenticated;
  tierAdminManager.hidden = !authenticated;
  if (authenticated) renderTierAdminEditor();
}

function renderTierAdminEditor(preferredName = "") {
  const players = [...state.players].sort((playerA, playerB) =>
    playerA.name.localeCompare(playerB.name, "ko"));
  const currentName = preferredName || tierAdminSelectedName;
  const selected = players.find((player) => keyOf(player.name) === keyOf(currentName)) || players[0];
  tierAdminSelectedName = selected?.name || "";
  tierAdminPlayerSearch.value = tierAdminSelectedName;
  closeTierAdminCreatePlayer();
  hideTierAdminSuggestions();

  tierAdminUniversityOptions.innerHTML = universityOptions().map((item) =>
    '<option value="' + escapeHtml(item.value) + '"></option>'
  ).join("");
  renderTierAdminMemberships();
}

function renderTierAdminMemberships() {
  const player = adminSelectedPlayer();
  if (!player) {
    tierAdminTier.disabled = true;
    tierAdminPromotion.disabled = true;
    tierAdminMemberships.innerHTML = '<span class="tier-admin-fa-label">선수를 선택해 주세요.</span>';
    return;
  }
  tierAdminTier.disabled = false;
  tierAdminTier.value = String(player.tier || "FA");
  tierAdminPromotion.checked = Boolean(player.promotionLight);
  tierAdminPromotion.disabled = tierAdminTier.value === "FA";
  tierAdminRevert.textContent = player.customPlayer ? "등록 선수 삭제" : "모든 변경 원본으로 되돌리기";
  const universities = playerUniversities(player);
  tierAdminMemberships.innerHTML = universities.length
    ? universities.map((university) => [
        '<span class="tier-admin-membership">',
        escapeHtml(university),
        '<button type="button" data-remove-university="' + escapeHtml(university) + '"',
        ' aria-label="' + escapeHtml(university + " 소속 삭제") + '">×</button>',
        "</span>"
      ].join("")).join("")
    : '<span class="tier-admin-fa-label">FA · 소속 대학 없음</span>';
}

function setTierAdminControlsDisabled(disabled) {
  [
    tierAdminPlayerSearch,
    tierAdminNewName,
    tierAdminNewTier,
    tierAdminNewRace,
    tierAdminNewUniversity,
    tierAdminNewBroadcastId,
    tierAdminCreateConfirm,
    tierAdminCreateCancel,
    tierAdminTier,
    tierAdminPromotion,
    tierAdminUniversity,
    tierAdminAdd,
    tierAdminMakeFa,
    tierAdminRevert
  ].forEach((control) => { control.disabled = disabled; });
  tierAdminPlayerSuggestions.querySelectorAll("button").forEach((button) => {
    button.disabled = disabled;
  });
  tierAdminMemberships.querySelectorAll("button").forEach((button) => {
    button.disabled = disabled;
  });
  if (!disabled) renderTierAdminMemberships();
}

async function readAdminResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "관리자 요청을 처리하지 못했습니다.");
  return data;
}

function updateTierAdminStorage(storage) {
  if (!storage || typeof storage !== "object") return;
  tierAdminStorage = {
    mode: String(storage.mode || "unknown"),
    durable: storage.durable === true,
    message: String(storage.message || "")
  };
  tierAdminDialog.classList.toggle("has-storage-warning", !tierAdminStorage.durable);
}

function savedAdminMessage(message) {
  return tierAdminStorage.durable
    ? message + " PostgreSQL에 영구 저장했습니다."
    : message;
}

async function checkTierAdminSession() {
  tierAdminStatus.textContent = "관리자 상태를 확인하고 있습니다.";
  try {
    const response = await fetch("/api/admin/status", { headers: { "Accept": "application/json" } });
    const data = await readAdminResponse(response);
    updateTierAdminStorage(data.storage);
    if (!data.configured) {
      tierAdminStatus.textContent = "Render 환경변수 TIER_ADMIN_PASSWORD를 먼저 설정해 주세요.";
      tierAdminPassword.disabled = true;
      setTierAdminView(false);
      return;
    }
    tierAdminPassword.disabled = false;
    tierAdminCsrf = data.csrf || "";
    setTierAdminView(Boolean(data.authenticated));
    tierAdminStatus.textContent = !tierAdminStorage.durable
      ? tierAdminStorage.message
      : (data.authenticated
        ? "로그인되었습니다. 변경 내용은 PostgreSQL에 영구 저장됩니다."
        : "관리자 비밀번호로 로그인해 주세요. 변경 내용은 PostgreSQL에 영구 저장됩니다.");
  } catch (error) {
    setTierAdminView(false);
    tierAdminStatus.textContent = error.message;
  }
}

async function saveTierAdminPlayer(changes, successMessage) {
  const player = adminSelectedPlayer();
  if (!player || tierAdminSaving) return;
  const playerName = player.name;
  const tier = changes.tier ?? String(player.tier || "FA");
  const promotionLight = tier === "FA"
    ? false
    : (changes.promotionLight ?? Boolean(player.promotionLight));
  const universities = changes.universities ?? playerUniversities(player);
  tierAdminSaving = true;
  setTierAdminControlsDisabled(true);
  tierAdminStatus.textContent = "변경 내용을 저장하고 있습니다.";
  try {
    const response = await fetch("/api/admin/tier-memberships", {
      method: "PUT",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": tierAdminCsrf
      },
      body: JSON.stringify({ playerName, universities, tier, promotionLight })
    });
    const data = await readAdminResponse(response);
    updateTierAdminStorage(data.storage);
    await loadRoster(false);
    renderTierAdminEditor(playerName);
    tierAdminStatus.textContent = savedAdminMessage(successMessage);
  } catch (error) {
    tierAdminStatus.textContent = error.message;
    if (/인증|로그인/.test(error.message)) {
      tierAdminCsrf = "";
      setTierAdminView(false);
    }
  } finally {
    tierAdminSaving = false;
    if (!tierAdminManager.hidden) setTierAdminControlsDisabled(false);
  }
}

function saveTierAdminMemberships(universities, successMessage) {
  return saveTierAdminPlayer({ universities }, successMessage);
}

async function createTierAdminPlayer() {
  if (tierAdminSaving) return;
  const playerName = String(tierAdminNewName.value || "").replace(/\s+/g, " ").trim();
  const university = String(tierAdminNewUniversity.value || "").replace(/\s+/g, " ").trim();
  if (!playerName) {
    tierAdminStatus.textContent = "새 선수 이름을 입력해 주세요.";
    tierAdminNewName.focus();
    return;
  }
  tierAdminSaving = true;
  setTierAdminControlsDisabled(true);
  tierAdminStatus.textContent = playerName + " 선수를 등록하고 있습니다.";
  try {
    const response = await fetch("/api/admin/tier-players", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": tierAdminCsrf
      },
      body: JSON.stringify({
        playerName,
        tier: tierAdminNewTier.value,
        race: tierAdminNewRace.value,
        university,
        universities: university ? [university] : [],
        broadcastId: tierAdminNewBroadcastId.value
      })
    });
    const data = await readAdminResponse(response);
    updateTierAdminStorage(data.storage);
    await loadRoster(false);
    tierAdminSelectedName = playerName;
    renderTierAdminEditor(playerName);
    tierAdminStatus.textContent = savedAdminMessage(playerName + " 선수를 새 명단에 등록했습니다.");
  } catch (error) {
    tierAdminStatus.textContent = error.message;
  } finally {
    tierAdminSaving = false;
    if (!tierAdminManager.hidden) setTierAdminControlsDisabled(false);
  }
}

async function revertTierAdminMembership() {
  const player = adminSelectedPlayer();
  if (!player || tierAdminSaving) return;
  const playerName = player.name;
  const customPlayer = Boolean(player.customPlayer);
  tierAdminSaving = true;
  setTierAdminControlsDisabled(true);
  tierAdminStatus.textContent = customPlayer
    ? "등록한 선수를 명단에서 삭제하고 있습니다."
    : "가져온 원본 명단으로 되돌리고 있습니다.";
  try {
    const response = await fetch("/api/admin/tier-memberships", {
      method: "DELETE",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": tierAdminCsrf
      },
      body: JSON.stringify({ playerName })
    });
    const data = await readAdminResponse(response);
    updateTierAdminStorage(data.storage);
    await loadRoster(false);
    tierAdminSelectedName = "";
    renderTierAdminEditor();
    tierAdminStatus.textContent = savedAdminMessage(customPlayer
      ? playerName + " 등록 선수를 명단에서 삭제했습니다."
      : playerName + " 선수의 티어·승급불·소속을 가져온 원본으로 되돌렸습니다.");
  } catch (error) {
    tierAdminStatus.textContent = error.message;
  } finally {
    tierAdminSaving = false;
    if (!tierAdminManager.hidden) setTierAdminControlsDisabled(false);
  }
}

function render() {
  renderUniversityFilters();
  if (!state.players.length) {
    board.innerHTML = '<div class="empty-card">표시할 티어 선수가 없습니다.</div>';
    return;
  }

  const visiblePlayers = state.players.filter(matchesUniversity);
  if (!visiblePlayers.length) {
    board.innerHTML = '<div class="empty-card">선택한 대학에 표시할 선수가 없습니다.</div>';
    return;
  }

  const groups = new Map();
  for (const player of visiblePlayers) {
    if (!groups.has(player.tier)) groups.set(player.tier, []);
    groups.get(player.tier).push(player);
  }

  board.innerHTML = [...groups.entries()].map(([tier, players]) => {
    const tierLabel = tier === "FA" ? "FA" : tier + "티어";
    const raceSections = RACE_GROUPS.map((race) => raceSection(players, race)).join("");
    const unknownPlayers = players.filter((player) => !RACE_GROUPS.some((race) => race.code === player.race));
    const unknownSection = unknownPlayers.length
      ? '<section class="race-group race-unknown" aria-label="종족 미확인">' +
        '<div class="tier-cards">' + unknownPlayers.map(playerCard).join("") + "</div></section>"
      : "";
    const refreshing = state.refreshingTiers.has(String(tier));

    return [
      '<section class="tier-row" aria-labelledby="tier-' + escapeHtml(tier) + '">',
      '<header class="tier-header">',
      '<div class="tier-label"><strong id="tier-' + escapeHtml(tier) + '">' + escapeHtml(tierLabel) + "</strong>",
      '<span>' + players.length + "명</span></div>",
      '<button class="tier-refresh" type="button" data-tier="' + escapeHtml(tier) + '"' +
        (refreshing ? " disabled" : "") +
        ' aria-label="' + escapeHtml(tierLabel + " LIVE 새로고침") + '">' +
        (refreshing ? "확인 중…" : "↻ 새로고침") + "</button>",
      "</header>",
      '<div class="tier-races">' + raceSections + unknownSection + "</div>",
      "</section>"
    ].join("");
  }).join("");

  bindCards();
}

function bindCards() {
  board.querySelectorAll(".tier-refresh").forEach((button) => {
    button.addEventListener("click", () => refreshTierLive(button.dataset.tier));
  });

  board.querySelectorAll(".player-photo").forEach((image) => {
    image.addEventListener("error", () => {
      const failedSource = image.currentSrc || image.src;
      const animatedSource = image.dataset.animatedSrc || "";
      const fallbackSource = image.dataset.fallbackSrc || "";
      if (animatedSource && failedSource === animatedSource) {
        image.dataset.animatedSrc = "";
        image.src = image.dataset.staticSrc || fallbackSource;
        return;
      }
      if (fallbackSource && failedSource !== fallbackSource) {
        image.dataset.staticSrc = fallbackSource;
        image.src = fallbackSource;
        return;
      }
      image.hidden = true;
    });
  });

  board.querySelectorAll(".player-card").forEach((card) => {
    const openDestination = () => {
      const href = card.dataset.href;
      if (href && href !== "#") window.open(href, "_blank", "noopener,noreferrer");
    };
    card.addEventListener("click", (event) => {
      if (event.target.closest(".watch-link")) return;
      const hasAnimation = Boolean(card.querySelector(".player-photo")?.dataset.animatedSrc);
      const touchPreview = window.matchMedia("(hover: none)").matches && hasAnimation;
      const canPreview = card.classList.contains("is-live") || touchPreview;
      if (canPreview && !card.classList.contains("is-open")) {
        event.preventDefault();
        closeOpenCard();
        card.classList.add("is-open");
        state.openCard = card;
        syncProfileAnimations();
        return;
      }
      openDestination();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const canPreview = card.classList.contains("is-live") ||
        Boolean(card.querySelector(".player-photo")?.dataset.animatedSrc);
      if (canPreview && !card.classList.contains("is-open")) {
        closeOpenCard();
        card.classList.add("is-open");
        state.openCard = card;
        syncProfileAnimations();
        return;
      }
      openDestination();
    });
    card.addEventListener("mouseenter", () => {
      card.classList.add("is-hovered");
      syncProfileAnimations();
    });
    card.addEventListener("mouseleave", () => {
      card.classList.remove("is-hovered");
      syncProfileAnimations();
    });
    card.addEventListener("focusin", syncProfileAnimations);
    card.addEventListener("focusout", () => requestAnimationFrame(syncProfileAnimations));
  });

  observeProfilePhotos();
}

function closeOpenCard() {
  if (state.openCard) state.openCard.classList.remove("is-open");
  state.openCard = null;
  syncProfileAnimations();
}

function observeProfilePhotos() {
  profileObserver?.disconnect();
  if (!("IntersectionObserver" in window)) {
    board.querySelectorAll(".player-photo").forEach((image) => { image.dataset.inView = "1"; });
    syncProfileAnimations();
    return;
  }
  profileObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.dataset.inView = entry.isIntersecting ? "1" : "0";
    syncProfileAnimations();
  }, { rootMargin: "80px 0px", threshold: 0.01 });
  board.querySelectorAll(".player-photo").forEach((image) => profileObserver.observe(image));
}

function syncProfileAnimations() {
  const photos = [...board.querySelectorAll(".player-photo")];
  const canAnimate = document.visibilityState === "visible" && !reducedMotion.matches;
  const candidates = canAnimate
    ? photos.filter((image) => {
        if (image.dataset.inView !== "1" || !image.dataset.animatedSrc) return false;
        const card = image.closest(".player-card");
        return card?.classList.contains("is-live") ||
          card?.classList.contains("is-open") ||
          card?.classList.contains("is-hovered") ||
          card?.matches(":focus-within");
      }).sort((imageA, imageB) => {
        const cardA = imageA.closest(".player-card");
        const cardB = imageB.closest(".player-card");
        const selectedA = Number(cardA?.classList.contains("is-open") || cardA?.classList.contains("is-hovered") || cardA?.matches(":focus-within"));
        const selectedB = Number(cardB?.classList.contains("is-open") || cardB?.classList.contains("is-hovered") || cardB?.matches(":focus-within"));
        return selectedB - selectedA;
      }).slice(0, MAX_ANIMATED_PROFILES)
    : [];
  const animated = new Set(candidates);

  for (const image of photos) {
    const shouldAnimate = animated.has(image);
    const target = shouldAnimate ? image.dataset.animatedSrc : image.dataset.staticSrc;
    image.classList.toggle("is-animated", shouldAnimate);
    if (!target || (image.currentSrc || image.src) === target) continue;
    image.src = target;
  }
}

async function loadRoster(force = false) {
  refreshButton.disabled = true;
  statusLine.textContent = force ? "최신 티어 명단을 확인하고 있습니다." : "";
  try {
    const response = await fetch("/api/tiers" + (force ? "?refresh=1" : ""));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "티어 명단을 불러오지 못했습니다.");
    state.players = Array.isArray(data.players) ? data.players : [];
    render();
    await loadLive();
    if (data.refreshing) await syncDailyRoster();
  } catch (error) {
    board.innerHTML = '<div class="empty-card">' + escapeHtml(error.message) + "</div>";
    statusLine.textContent = "잠시 후 새로고침해 주세요.";
  } finally {
    refreshButton.disabled = false;
  }
}

async function syncDailyRoster() {
  try {
    const response = await fetch("/api/tiers?wait=1");
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.players) || !data.players.length) return;
    state.players = data.players;
    render();
    await loadLive();
  } catch {
    // 저장된 명단은 이미 표시 중이므로 다음 방문에서 다시 시도합니다.
  }
}

function statusSignature(status) {
  return JSON.stringify([
    Boolean(status?.isLive),
    status?.broadcastUrl || "",
    status?.title || "",
    Number(status?.viewerCount || 0),
    status?.thumbnail || ""
  ]);
}

function mergeLiveStatuses(statuses) {
  let changed = 0;
  for (const [name, status] of statuses) {
    if (statusSignature(state.liveByName.get(name)) !== statusSignature(status)) changed += 1;
    state.liveByName.set(name, status);
  }
  return changed;
}

function scheduleLivePoll() {
  clearTimeout(livePollTimer);
  livePollTimer = setTimeout(() => {
    if (document.visibilityState === "visible") loadLive(false);
    else scheduleLivePoll();
  }, LIVE_POLL_MS);
}

async function loadLive(force = false) {
  if (state.loadingLive || !state.players.length) return;
  state.loadingLive = true;
  countdown.textContent = "LIVE 확인 중";
  try {
    const names = state.players.map((player) => player.name);
    const statuses = await fetchLiveStatuses(names, force);
    const changed = mergeLiveStatuses(statuses);
    const liveCount = [...state.liveByName.values()].filter((item) => item.isLive).length;
    statusLine.textContent = liveCount
      ? "현재 " + liveCount + "명이 방송 중입니다."
      : "현재 확인된 LIVE 방송이 없습니다.";
    if (changed) render();
  } catch {
    statusLine.textContent = "LIVE 상태 확인이 지연되고 있습니다. 티어 명단은 정상적으로 볼 수 있습니다.";
  } finally {
    countdown.textContent = "15초마다 자동 갱신";
    state.loadingLive = false;
    scheduleLivePoll();
  }
}

async function fetchLiveStatuses(names, force = false) {
  const params = new URLSearchParams({ names: names.join(",") });
  if (force) params.set("refresh", "1");
  const response = await fetch("/api/live-status?" + params.toString(), {
    headers: { "Accept": "application/json" }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "방송 상태를 불러오지 못했습니다.");
  if (!Array.isArray(data.statuses)) throw new Error("LIVE 상태 응답 형식이 올바르지 않습니다.");
  const statuses = new Map();
  for (const item of data.statuses || []) statuses.set(keyOf(item.name), item);
  return statuses;
}

async function refreshTierLive(tier) {
  const tierKey = String(tier || "");
  if (!tierKey || state.loadingLive || state.refreshingTiers.has(tierKey)) return;
  const players = state.players.filter((player) =>
    String(player.tier) === tierKey && matchesUniversity(player));
  if (!players.length) return;

  state.refreshingTiers.add(tierKey);
  render();
  try {
    const statuses = await fetchLiveStatuses(players.map((player) => player.name), true);
    mergeLiveStatuses(statuses);
    const tierLiveCount = [...statuses.values()].filter((item) => item.isLive).length;
    const tierLabel = tierKey === "FA" ? "FA" : tierKey + "티어";
    statusLine.textContent = tierLabel + " LIVE 상태를 갱신했습니다" +
      (tierLiveCount ? " · 현재 " + tierLiveCount + "명 방송 중" : "") + ".";
  } catch {
    statusLine.textContent = "해당 티어의 LIVE 상태를 갱신하지 못했습니다. 잠시 후 다시 눌러 주세요.";
  } finally {
    state.refreshingTiers.delete(tierKey);
    render();
  }
}

function positionTierAdminDialog(left, top) {
  const rect = tierAdminDialog.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  tierAdminDialog.style.left = Math.min(Math.max(8, left), maxLeft) + "px";
  tierAdminDialog.style.top = Math.min(Math.max(8, top), maxTop) + "px";
  tierAdminDialog.style.transform = "none";
}

function centerTierAdminDialog() {
  tierAdminDialog.style.removeProperty("left");
  tierAdminDialog.style.removeProperty("top");
  tierAdminDialog.style.removeProperty("transform");
}

refreshButton.addEventListener("click", () => loadRoster(true));
universityFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-university-filter]");
  if (!button) return;
  state.selectedUniversity = button.dataset.universityFilter || ALL_UNIVERSITIES;
  closeOpenCard();
  render();
});
tierAdminOpen.addEventListener("click", () => {
  if (!tierAdminDialog.open) tierAdminDialog.showModal();
  checkTierAdminSession();
});
tierAdminClose.addEventListener("click", () => tierAdminDialog.close());
tierAdminDialog.addEventListener("click", (event) => {
  if (event.target === tierAdminDialog) tierAdminDialog.close();
});
tierAdminHeader.addEventListener("pointerdown", (event) => {
  if (window.innerWidth < 640 || event.button !== 0 || event.target.closest("button")) return;
  const rect = tierAdminDialog.getBoundingClientRect();
  tierAdminDrag = {
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };
  tierAdminHeader.setPointerCapture(event.pointerId);
  tierAdminDialog.classList.add("is-dragging");
  event.preventDefault();
});
tierAdminHeader.addEventListener("pointermove", (event) => {
  if (!tierAdminDrag || event.pointerId !== tierAdminDrag.pointerId) return;
  positionTierAdminDialog(
    event.clientX - tierAdminDrag.offsetX,
    event.clientY - tierAdminDrag.offsetY
  );
});
tierAdminHeader.addEventListener("pointerup", (event) => {
  if (!tierAdminDrag || event.pointerId !== tierAdminDrag.pointerId) return;
  tierAdminHeader.releasePointerCapture(event.pointerId);
  tierAdminDrag = null;
  tierAdminDialog.classList.remove("is-dragging");
});
tierAdminHeader.addEventListener("pointercancel", () => {
  tierAdminDrag = null;
  tierAdminDialog.classList.remove("is-dragging");
});
tierAdminHeader.addEventListener("dblclick", (event) => {
  if (!event.target.closest("button")) centerTierAdminDialog();
});
tierAdminLogin.addEventListener("submit", async (event) => {
  event.preventDefault();
  tierAdminStatus.textContent = "로그인하고 있습니다.";
  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ password: tierAdminPassword.value })
    });
    const data = await readAdminResponse(response);
    updateTierAdminStorage(data.storage);
    tierAdminCsrf = data.csrf || "";
    tierAdminPassword.value = "";
    setTierAdminView(true);
    tierAdminStatus.textContent = tierAdminStorage.durable
      ? "로그인되었습니다. 변경 내용은 PostgreSQL에 영구 저장됩니다."
      : tierAdminStorage.message;
  } catch (error) {
    tierAdminStatus.textContent = error.message;
  }
});
tierAdminPlayerSearch.addEventListener("focus", renderTierAdminSuggestions);
tierAdminPlayerSearch.addEventListener("input", () => {
  closeTierAdminCreatePlayer();
  const exact = state.players.find((player) => keyOf(player.name) === keyOf(tierAdminPlayerSearch.value));
  tierAdminSelectedName = exact?.name || "";
  renderTierAdminMemberships();
  renderTierAdminSuggestions();
});
tierAdminPlayerSearch.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (tierAdminPlayerSuggestions.hidden) renderTierAdminSuggestions();
    else moveTierAdminSuggestion(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Enter" && !tierAdminPlayerSuggestions.hidden) {
    const buttons = [...tierAdminPlayerSuggestions.querySelectorAll("[data-player-name]")];
    const selected = buttons[Math.max(0, tierAdminSuggestionIndex)];
    if (selected) {
      event.preventDefault();
      selectTierAdminPlayer(selected.dataset.playerName);
    } else {
      const createButton = tierAdminPlayerSuggestions.querySelector("[data-create-player]");
      if (createButton) {
        event.preventDefault();
        openTierAdminCreatePlayer(createButton.dataset.createPlayer);
      }
    }
    return;
  }
  if (event.key === "Escape") hideTierAdminSuggestions();
});
tierAdminPlayerSuggestions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-player-name]");
  if (button) {
    selectTierAdminPlayer(button.dataset.playerName);
    return;
  }
  const createButton = event.target.closest("[data-create-player]");
  if (createButton) openTierAdminCreatePlayer(createButton.dataset.createPlayer);
});
tierAdminCreateConfirm.addEventListener("click", createTierAdminPlayer);
tierAdminCreateCancel.addEventListener("click", () => {
  closeTierAdminCreatePlayer();
  tierAdminPlayerSearch.focus();
  renderTierAdminSuggestions();
});
tierAdminTier.addEventListener("change", () => {
  const player = adminSelectedPlayer();
  if (!player) return;
  const tier = tierAdminTier.value;
  saveTierAdminPlayer(
    { tier, promotionLight: tier === "FA" ? false : tierAdminPromotion.checked },
    player.name + " 선수를 " + (tier === "FA" ? "FA" : tier + "티어") + "로 변경했습니다."
  );
});
tierAdminPromotion.addEventListener("change", () => {
  const player = adminSelectedPlayer();
  if (!player) return;
  saveTierAdminPlayer(
    { promotionLight: tierAdminPromotion.checked },
    player.name + " 선수의 승급불을 " + (tierAdminPromotion.checked ? "켰습니다." : "해제했습니다.")
  );
});
tierAdminAdd.addEventListener("click", () => {
  const player = adminSelectedPlayer();
  const university = String(tierAdminUniversity.value || "").replace(/\s+/g, " ").trim();
  if (!player || !university || university === "FA" || university === "연합팀") {
    tierAdminStatus.textContent = "추가할 대학 이름을 정확히 입력해 주세요.";
    return;
  }
  const next = [...new Set([...playerUniversities(player), university])];
  tierAdminUniversity.value = "";
  saveTierAdminMemberships(next, player.name + " 선수를 " + university + "에 추가했습니다.");
});
tierAdminMemberships.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-university]");
  if (!button) return;
  const player = adminSelectedPlayer();
  if (!player) return;
  const removed = button.dataset.removeUniversity;
  const next = playerUniversities(player).filter((university) => university !== removed);
  saveTierAdminMemberships(next, player.name + " 선수를 " + removed + "에서 제외했습니다.");
});
tierAdminMakeFa.addEventListener("click", () => {
  const player = adminSelectedPlayer();
  if (player) saveTierAdminMemberships([], player.name + " 선수를 FA로 변경했습니다.");
});
tierAdminRevert.addEventListener("click", revertTierAdminMembership);
tierAdminLogout.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/admin/logout", {
      method: "POST",
      headers: { "Accept": "application/json", "X-CSRF-Token": tierAdminCsrf }
    });
    await readAdminResponse(response);
  } catch {
    // 세션이 이미 끝난 경우에도 로그인 화면으로 돌아갑니다.
  }
  tierAdminCsrf = "";
  setTierAdminView(false);
  tierAdminStatus.textContent = "로그아웃했습니다.";
});
document.addEventListener("visibilitychange", () => {
  syncProfileAnimations();
  if (document.visibilityState === "visible") loadLive(false);
});
reducedMotion.addEventListener?.("change", syncProfileAnimations);
document.addEventListener("click", (event) => {
  if (!event.target.closest(".tier-admin-player-search")) hideTierAdminSuggestions();
  if (state.openCard && !state.openCard.contains(event.target)) closeOpenCard();
});
window.addEventListener("resize", () => {
  if (window.innerWidth < 640) {
    centerTierAdminDialog();
    return;
  }
  if (tierAdminDialog.style.transform === "none") {
    const rect = tierAdminDialog.getBoundingClientRect();
    positionTierAdminDialog(rect.left, rect.top);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeOpenCard();
});

loadRoster();
