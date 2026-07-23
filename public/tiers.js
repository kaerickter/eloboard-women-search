const board = document.getElementById("tierBoard");
const statusLine = document.getElementById("boardStatus");
const refreshButton = document.getElementById("refreshButton");
const countdown = document.getElementById("refreshCountdown");

const state = {
  players: [],
  liveByName: new Map(),
  loadingLive: false,
  refreshingTiers: new Set(),
  openCard: null
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

function formatViewers(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value || 0)) + "명 시청";
}

function avatar(player) {
  const initial = Array.from(player.name || "?")[0] || "?";
  const image = player.image
    ? '<img src="' + escapeHtml(player.image) + '" alt="" loading="lazy">'
    : "";
  return '<span class="player-avatar">' + escapeHtml(initial) + image + "</span>";
}

function popover(live) {
  if (!live?.isLive) return "";
  const image = live.thumbnail
    ? '<img src="' + escapeHtml(live.thumbnail) + '" alt="현재 방송 썸네일" loading="lazy">'
    : "";
  return [
    '<aside class="live-popover" aria-label="현재 방송 정보">',
    '<div class="popover-thumb" data-viewers="' + escapeHtml(formatViewers(live.viewerCount)) + '">' + image + "</div>",
    '<div class="popover-copy">',
    '<p class="popover-title">' + escapeHtml(live.title || "현재 방송 중입니다.") + "</p>",
    '<a class="watch-link" href="' + escapeHtml(live.broadcastUrl) + '" target="_blank" rel="noreferrer">방송 보러가기</a>',
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
  const href = live?.broadcastUrl || player.profileUrl || "#";
  const raceClass = RACE_GROUPS.find((item) => item.code === player.race)?.className || "unknown";
  return [
    '<article class="player-card race-' + raceClass + (live?.isLive ? " is-live" : "") + '"',
    ' tabindex="0" role="link"',
    ' data-href="' + escapeHtml(href) + '"',
    ' data-player="' + escapeHtml(keyOf(player.name)) + '"',
    ' aria-label="' + escapeHtml(player.name + (live?.isLive ? " LIVE, 방송 정보 보기" : " 프로필 열기")) + '">',
    '<span class="live-badge">LIVE</span>',
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

function render() {
  if (!state.players.length) {
    board.innerHTML = '<div class="empty-card">표시할 티어 선수가 없습니다.</div>';
    return;
  }

  const groups = new Map();
  for (const player of state.players) {
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

  board.querySelectorAll(".player-avatar img").forEach((image) => {
    image.addEventListener("error", () => { image.hidden = true; }, { once: true });
  });

  board.querySelectorAll(".player-card").forEach((card) => {
    const openDestination = () => {
      const href = card.dataset.href;
      if (href && href !== "#") window.open(href, "_blank", "noopener,noreferrer");
    };
    card.addEventListener("click", (event) => {
      if (event.target.closest(".watch-link")) return;
      const canPreview = card.classList.contains("is-live");
      if (canPreview && !card.classList.contains("is-open")) {
        event.preventDefault();
        closeOpenCard();
        card.classList.add("is-open");
        state.openCard = card;
        return;
      }
      openDestination();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const canPreview = card.classList.contains("is-live");
      if (canPreview && !card.classList.contains("is-open")) {
        closeOpenCard();
        card.classList.add("is-open");
        state.openCard = card;
        return;
      }
      openDestination();
    });
    card.addEventListener("mouseenter", () => {
      if (card.classList.contains("is-live")) card.classList.add("is-hovered");
    });
    card.addEventListener("mouseleave", () => card.classList.remove("is-hovered"));
  });
}

function closeOpenCard() {
  if (state.openCard) state.openCard.classList.remove("is-open");
  state.openCard = null;
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
  } catch (error) {
    board.innerHTML = '<div class="empty-card">' + escapeHtml(error.message) + "</div>";
    statusLine.textContent = "잠시 후 새로고침해 주세요.";
  } finally {
    refreshButton.disabled = false;
  }
}

async function loadLive() {
  if (state.loadingLive || !state.players.length) return;
  state.loadingLive = true;
  countdown.textContent = "LIVE 확인 중";
  try {
    const names = state.players.map((player) => player.name);
    state.liveByName = await fetchLiveStatuses(names);
    const liveCount = [...state.liveByName.values()].filter((item) => item.isLive).length;
    statusLine.textContent = liveCount
      ? "현재 " + liveCount + "명이 방송 중입니다."
      : "현재 확인된 LIVE 방송이 없습니다.";
    render();
  } catch {
    statusLine.textContent = "LIVE 상태 확인이 지연되고 있습니다. 티어 명단은 정상적으로 볼 수 있습니다.";
  } finally {
    countdown.textContent = "페이지를 열 때 갱신";
    state.loadingLive = false;
  }
}

async function fetchLiveStatuses(names) {
  const response = await fetch("/api/live-status?refresh=1&names=" + encodeURIComponent(names.join(",")));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "방송 상태를 불러오지 못했습니다.");
  const statuses = new Map();
  for (const item of data.statuses || []) statuses.set(keyOf(item.name), item);
  return statuses;
}

async function refreshTierLive(tier) {
  const tierKey = String(tier || "");
  if (!tierKey || state.loadingLive || state.refreshingTiers.has(tierKey)) return;
  const players = state.players.filter((player) => String(player.tier) === tierKey);
  if (!players.length) return;

  state.refreshingTiers.add(tierKey);
  render();
  try {
    const statuses = await fetchLiveStatuses(players.map((player) => player.name));
    for (const [name, status] of statuses) state.liveByName.set(name, status);
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

refreshButton.addEventListener("click", () => window.location.reload());
document.addEventListener("click", (event) => {
  if (state.openCard && !state.openCard.contains(event.target)) closeOpenCard();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeOpenCard();
});

loadRoster();
