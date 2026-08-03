"use strict";

const PAGE_SIZE = 50;
const DIARY_DATA_CACHE_KEY = "spawn-diary-data-v1";
const DIARY_VIEW_STATE_KEY = "spawn-diary-view-state-v1";
const elements = {
  rows: document.querySelector("#diaryRows"),
  search: document.querySelector("#searchInput"),
  result: document.querySelector("#resultFilter"),
  map: document.querySelector("#mapFilter"),
  reset: document.querySelector("#resetButton"),
  total: document.querySelector("#totalCount"),
  wins: document.querySelector("#winCount"),
  losses: document.querySelector("#lossCount"),
  rate: document.querySelector("#winRate"),
  filterSummary: document.querySelector("#filterSummary"),
  pageSummary: document.querySelector("#pageSummary"),
  page: document.querySelector("#currentPage"),
  previous: document.querySelector("#previousButton"),
  next: document.querySelector("#nextButton"),
  status: document.querySelector("#statusMessage"),
  recordOpen: document.querySelector("#recordOpenButton"),
  recordDialog: document.querySelector("#recordDialog"),
  recordClose: document.querySelector("#recordCloseButton"),
  recordLogin: document.querySelector("#recordLoginForm"),
  recordPassword: document.querySelector("#recordAdminPassword"),
  recordDialogStatus: document.querySelector("#recordDialogStatus"),
  recordTitle: document.querySelector("#recordDialogTitle"),
  recordDescription: document.querySelector("#recordDialogDescription"),
  recordForm: document.querySelector("#recordEntryForm"),
  recordFormStatus: document.querySelector("#recordFormStatus"),
  recordSave: document.querySelector("#recordSaveButton"),
  recordDelete: document.querySelector("#recordDeleteButton"),
  recordMaps: document.querySelector("#recordMapOptions"),
  recordDate: document.querySelector("#recordDateInput"),
  recordOpponent: document.querySelector("#recordOpponentInput"),
  recordOpponentSuggestions: document.querySelector("#recordOpponentSuggestions"),
  recordTier: document.querySelector("#recordTierInput"),
  recordRace: document.querySelector("#recordRaceInput")
};

let entries = [];
let filteredEntries = [];
let currentPage = 1;
let recordCsrf = "";
let recordPlayers = [];
let recordLockOwned = false;
let recordLockTimer = null;
let recordSuggestionIndex = -1;
let recordSuggestedPlayers = [];
let recordSelectedPlayer = "";
let editingEntry = null;

function saveDiaryData() {
  try {
    sessionStorage.setItem(DIARY_DATA_CACHE_KEY, JSON.stringify(entries));
  } catch {
    // 저장 공간을 사용할 수 없으면 서버 데이터만 사용합니다.
  }
}

function saveDiaryViewState() {
  try {
    sessionStorage.setItem(DIARY_VIEW_STATE_KEY, JSON.stringify({
      search: elements.search.value,
      result: elements.result.value,
      map: elements.map.value,
      page: currentPage
    }));
  } catch {
    // 필터 상태 저장을 지원하지 않는 환경에서는 기본값을 사용합니다.
  }
}

function readDiaryViewState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DIARY_VIEW_STATE_KEY) || "null");
    return saved && typeof saved === "object" ? saved : null;
  } catch {
    return null;
  }
}

function restoreDiaryData() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DIARY_DATA_CACHE_KEY) || "[]");
    if (!Array.isArray(saved) || !saved.length) return false;
    entries = saved;
    updateSummary();
    populateMaps();
    const view = readDiaryViewState();
    if (view) {
      elements.search.value = text(view.search);
      elements.result.value = text(view.result);
      elements.map.value = text(view.map);
      currentPage = Math.max(1, Number(view.page) || 1);
    }
    applyFilters(false);
    return true;
  } catch {
    return false;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resultKind(value) {
  const normalized = text(value);
  if (normalized.includes("승")) return "win";
  if (normalized.includes("패")) return "loss";
  return "pending";
}

function resultLabel(value) {
  const kind = resultKind(value);
  return kind === "win" ? "승" : kind === "loss" ? "패" : (text(value) || "미정");
}

function raceKind(value) {
  const normalized = text(value).toLocaleLowerCase("ko");
  if (normalized === "t" || normalized.includes("테란")) return "terran";
  if (normalized === "p" || normalized.includes("프로토스")) return "protoss";
  if (normalized === "z" || normalized.includes("저그")) return "zerg";
  return "unknown";
}

function raceAbbreviation(value) {
  const kind = raceKind(value);
  if (kind === "terran") return "T";
  if (kind === "zerg") return "Z";
  if (kind === "protoss") return "P";
  return "?";
}

function pillHue(value, seed = 0) {
  const label = text(value);
  let hash = seed;
  for (let index = 0; index < label.length; index += 1) {
    hash = ((hash * 31) + label.charCodeAt(index)) >>> 0;
  }
  return hash % 360;
}

function coloredPill(kind, value, seed) {
  const label = text(value);
  const shown = label || "미정";
  const emptyClass = label ? "" : " empty";
  const style = label ? ` style="--pill-hue:${pillHue(label, seed)}"` : "";
  return `<span class="${kind}-pill${emptyClass}"${style} title="${escapeHtml(shown)}">${escapeHtml(shown)}</span>`;
}

function coloredText(kind, value, seed) {
  const label = text(value);
  const shown = label || "미정";
  const emptyClass = label ? "" : " empty";
  const style = label ? ` style="--text-hue:${pillHue(label, seed)}"` : "";
  return `<span class="${kind}-text${emptyClass}"${style}>${escapeHtml(shown)}</span>`;
}

function formatPill(value) {
  const label = text(value);
  const kind = label === "스폰" ? "spawn" : label === "CK" ? "ck" : label === "대학대전" ? "university" : "empty";
  return `<span class="format-pill ${kind}">${escapeHtml(label || "미정")}</span>`;
}

function searchableText(entry) {
  return Object.values(entry).map(text).join(" ").toLocaleLowerCase("ko");
}

function formatDate(value) {
  const date = text(value).slice(0, 10);
  return date.replaceAll("-", "/");
}

function newestMatchFirst(a, b) {
  const aDate = text(a?.match_date).slice(0, 10) || "0000-00-00";
  const bDate = text(b?.match_date).slice(0, 10) || "0000-00-00";
  return bDate.localeCompare(aDate);
}

function updateSummary() {
  const wins = entries.filter((entry) => resultKind(entry.result) === "win").length;
  const losses = entries.filter((entry) => resultKind(entry.result) === "loss").length;
  const decided = wins + losses;
  elements.total.textContent = entries.length.toLocaleString("ko-KR") + "건";
  elements.wins.textContent = wins.toLocaleString("ko-KR") + "승";
  elements.losses.textContent = losses.toLocaleString("ko-KR") + "패";
  elements.rate.textContent = decided ? Math.round(wins / decided * 100) + "%" : "—";
}

function populateMaps() {
  const maps = [...new Set(entries.map((entry) => text(entry.map_name)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ko"));
  elements.map.innerHTML = '<option value="">전체 맵</option>' + maps
    .map((map) => `<option value="${escapeHtml(map)}">${escapeHtml(map)}</option>`)
    .join("");
  elements.recordMaps.innerHTML = maps
    .map((map) => `<option value="${escapeHtml(map)}"></option>`)
    .join("");
}

function render() {
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visibleEntries = filteredEntries.slice(start, start + PAGE_SIZE);

  if (!visibleEntries.length) {
    elements.rows.innerHTML = '<tr><td class="empty-cell" colspan="11">조건에 맞는 기록이 없습니다.</td></tr>';
  } else {
    elements.rows.innerHTML = visibleEntries.map((entry) => {
      const kind = resultKind(entry.result);
      return `<tr>
        <td><button class="date-edit-button" type="button" data-entry-id="${escapeHtml(entry.id)}"
          aria-label="${escapeHtml(formatDate(entry.match_date))} 기록 수정 또는 삭제">
          ${escapeHtml(formatDate(entry.match_date))}<small>수정</small>
        </button></td>
        <td>${formatPill(entry.game_format)}</td>
        <td>${escapeHtml(entry.opponent)}</td>
        <td>${coloredText("tier", playerTierSnapshot({ tier: entry.tier }), 47)}</td>
        <td><span class="race-pill ${raceKind(entry.opponent_race)}" title="${escapeHtml(entry.opponent_race || "미정")}">${raceAbbreviation(entry.opponent_race)}</span></td>
        <td>${coloredPill("map", entry.map_name, 131)}</td>
        <td><span class="result-pill ${kind}">${escapeHtml(resultLabel(entry.result))}</span></td>
        <td>${escapeHtml(entry.opponent_build)}</td>
        <td>${escapeHtml(entry.my_build)}</td>
        <td>${escapeHtml(entry.feedback)}</td>
        <td>${escapeHtml(entry.reflection)}</td>
      </tr>`;
    }).join("");
  }

  elements.filterSummary.textContent = `전체 ${entries.length.toLocaleString("ko-KR")}건 중 ${filteredEntries.length.toLocaleString("ko-KR")}건`;
  elements.pageSummary.textContent = visibleEntries.length
    ? `${start + 1}–${start + visibleEntries.length}번째 기록`
    : "표시할 기록 없음";
  elements.page.textContent = `${currentPage} / ${pageCount}`;
  elements.previous.disabled = currentPage <= 1;
  elements.next.disabled = currentPage >= pageCount;
}

function applyFilters(resetPage = true) {
  const query = text(elements.search.value).toLocaleLowerCase("ko");
  const result = elements.result.value;
  const map = elements.map.value;
  filteredEntries = entries.filter((entry) => {
    const kind = resultKind(entry.result);
    const matchesResult = !result ||
      (result === "승" && kind === "win") ||
      (result === "패" && kind === "loss") ||
      (result === "미정" && kind === "pending");
    return matchesResult &&
      (!map || text(entry.map_name) === map) &&
      (!query || searchableText(entry).includes(query));
  }).sort(newestMatchFirst);
  if (resetPage) currentPage = 1;
  render();
  saveDiaryViewState();
}

async function loadDiary() {
  try {
    const response = await fetch("/api/spawn-diary");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "스폰일지를 불러오지 못했습니다.");
    entries = Array.isArray(payload.entries) ? payload.entries : [];
    saveDiaryData();
    updateSummary();
    populateMaps();
    const view = readDiaryViewState();
    if (view) {
      elements.search.value = text(view.search);
      elements.result.value = text(view.result);
      elements.map.value = text(view.map);
      currentPage = Math.max(1, Number(view.page) || 1);
    }
    applyFilters(false);
  } catch (error) {
    if (!entries.length) {
      elements.rows.innerHTML = '<tr><td class="empty-cell" colspan="11">기록을 불러오지 못했습니다.</td></tr>';
      elements.filterSummary.textContent = "연결 상태를 확인해 주세요.";
    }
    elements.status.textContent = error.message;
  }
}

function playerNameKey(value) {
  return text(value).replace(/\s+/g, "").toLocaleLowerCase("ko");
}

function playerTierSnapshot(player) {
  const tier = text(player?.tier);
  if (!tier) return "";
  if (tier === "FA") return "FA";
  const hasPromotion = Boolean(player?.promotionLight) || /승급\s*불/u.test(tier);
  const base = tier.replace(/\s*승급\s*불\s*$/u, "").trim();
  const label = base.endsWith("티어") ? base : base + "티어";
  return label + (hasPromotion ? " 승급불" : "");
}

function playerRaceLabel(value) {
  return ({ T: "테란", P: "프로토스", Z: "저그" })[text(value).toUpperCase()] || text(value);
}

async function loadRecordPlayers() {
  if (recordPlayers.length) return recordPlayers;
  const response = await fetch("/api/tiers?wait=1");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "선수 목록을 불러오지 못했습니다.");
  recordPlayers = (Array.isArray(payload.players) ? payload.players : [])
    .filter((player) => text(player.name))
    .sort((a, b) =>
      Number(b.division === "women") - Number(a.division === "women") ||
      text(a.name).localeCompare(text(b.name), "ko"));
  return recordPlayers;
}

function hideOpponentSuggestions() {
  recordSuggestedPlayers = [];
  recordSuggestionIndex = -1;
  elements.recordOpponentSuggestions.hidden = true;
  elements.recordOpponentSuggestions.innerHTML = "";
  elements.recordOpponent.setAttribute("aria-expanded", "false");
}

function selectRecordPlayer(player) {
  recordSelectedPlayer = text(player.name);
  elements.recordOpponent.value = recordSelectedPlayer;
  elements.recordTier.value = playerTierSnapshot(player);
  elements.recordRace.value = playerRaceLabel(player.race);
  hideOpponentSuggestions();
}

function renderOpponentSuggestions() {
  const query = playerNameKey(elements.recordOpponent.value);
  if (!query) {
    hideOpponentSuggestions();
    return;
  }
  recordSuggestedPlayers = recordPlayers
    .filter((player) => playerNameKey(player.name).includes(query))
    .sort((a, b) =>
      Number(playerNameKey(b.name).startsWith(query)) - Number(playerNameKey(a.name).startsWith(query)) ||
      text(a.name).localeCompare(text(b.name), "ko"))
    .slice(0, 8);
  if (!recordSuggestedPlayers.length) {
    hideOpponentSuggestions();
    return;
  }
  recordSuggestionIndex = -1;
  elements.recordOpponentSuggestions.innerHTML = recordSuggestedPlayers.map((player, index) => {
    const tier = playerTierSnapshot(player) || "티어 미정";
    const race = playerRaceLabel(player.race) || "종족 미정";
    return `<button class="record-opponent-option" type="button" role="option" data-player-index="${index}">
      <strong>${escapeHtml(player.name)}</strong>
      <span>${escapeHtml(tier)} · ${escapeHtml(race)}</span>
    </button>`;
  }).join("");
  elements.recordOpponentSuggestions.hidden = false;
  elements.recordOpponent.setAttribute("aria-expanded", "true");
}

async function requestRecordLock(action) {
  const response = await fetch("/api/spawn-diary-admin/lock", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": recordCsrf
    },
    body: JSON.stringify({ action }),
    keepalive: action === "release"
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "작성 권한을 얻지 못했습니다.");
  return payload;
}

function stopRecordLockHeartbeat() {
  clearInterval(recordLockTimer);
  recordLockTimer = null;
}

function startRecordLockHeartbeat() {
  stopRecordLockHeartbeat();
  recordLockTimer = setInterval(async () => {
    try {
      await requestRecordLock("heartbeat");
    } catch (error) {
      recordLockOwned = false;
      stopRecordLockHeartbeat();
      elements.recordSave.disabled = true;
      elements.recordFormStatus.textContent = error.message;
    }
  }, 45000);
}

async function releaseRecordLock() {
  stopRecordLockHeartbeat();
  if (!recordLockOwned || !recordCsrf) return;
  recordLockOwned = false;
  await requestRecordLock("release").catch(() => {});
}

async function showRecordForm(csrf) {
  recordCsrf = csrf;
  elements.recordDialogStatus.textContent = "작성 권한을 확인하고 있습니다.";
  try {
    await requestRecordLock("acquire");
  } catch (error) {
    elements.recordLogin.hidden = true;
    elements.recordForm.hidden = true;
    elements.recordDialogStatus.textContent = error.message;
    return;
  }
  recordLockOwned = true;
  startRecordLockHeartbeat();
  elements.recordLogin.hidden = true;
  elements.recordForm.hidden = false;
  elements.recordSave.disabled = false;
  elements.recordDialogStatus.textContent = "";
  elements.recordFormStatus.textContent = "";
  elements.recordForm.reset();
  recordSelectedPlayer = "";
  if (editingEntry) {
    elements.recordTitle.textContent = "경기 기록 수정";
    elements.recordDescription.textContent = "내용을 고쳐 저장하거나 이 기록을 삭제할 수 있습니다.";
    elements.recordDelete.hidden = false;
    elements.recordSave.textContent = "수정 저장";
    const values = {
      matchDate: text(editingEntry.match_date).slice(0, 10),
      gameFormat: text(editingEntry.game_format) || "스폰",
      opponent: text(editingEntry.opponent),
      tier: text(editingEntry.tier),
      opponentRace: text(editingEntry.opponent_race),
      mapName: text(editingEntry.map_name),
      result: text(editingEntry.result) || "미정",
      opponentBuild: text(editingEntry.opponent_build),
      myBuild: text(editingEntry.my_build),
      feedback: text(editingEntry.feedback),
      reflection: text(editingEntry.reflection)
    };
    for (const [name, value] of Object.entries(values)) {
      const field = elements.recordForm.elements[name];
      if (field) field.value = value;
    }
    recordSelectedPlayer = values.opponent;
  } else {
    elements.recordTitle.textContent = "새 경기 기록";
    elements.recordDescription.textContent = "저장하면 스폰일지 맨 위에 바로 추가됩니다.";
    elements.recordDelete.hidden = true;
    elements.recordSave.textContent = "기록 저장";
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    elements.recordDate.value = localDate.toISOString().slice(0, 10);
  }
  await loadRecordPlayers().catch((error) => {
    elements.recordFormStatus.textContent = error.message;
  });
}

async function openRecordDialog(entry = null) {
  editingEntry = entry && entry.id ? entry : null;
  elements.recordDialog.showModal();
  elements.recordForm.hidden = true;
  elements.recordLogin.hidden = false;
  elements.recordPassword.value = "";
  elements.recordDialogStatus.textContent = "";
  elements.recordFormStatus.textContent = "";
  try {
    const response = await fetch("/api/spawn-diary-admin/status");
    const payload = await response.json();
    if (!payload.configured) throw new Error("스폰일지 관리자 비밀번호가 아직 설정되지 않았습니다.");
    if (payload.authenticated && payload.csrf) {
      await showRecordForm(payload.csrf);
    } else {
      elements.recordPassword.focus();
    }
  } catch (error) {
    elements.recordDialogStatus.textContent = error.message || "관리자 상태를 확인하지 못했습니다.";
  }
}

elements.search.addEventListener("input", applyFilters);
elements.result.addEventListener("change", applyFilters);
elements.map.addEventListener("change", applyFilters);
elements.reset.addEventListener("click", () => {
  elements.search.value = "";
  elements.result.value = "";
  elements.map.value = "";
  applyFilters();
});
elements.previous.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage -= 1;
    render();
    saveDiaryViewState();
  }
});
elements.next.addEventListener("click", () => {
  if (currentPage * PAGE_SIZE < filteredEntries.length) {
    currentPage += 1;
    render();
    saveDiaryViewState();
  }
});
elements.rows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-entry-id]");
  if (!button) return;
  const entry = entries.find((item) => String(item.id) === String(button.dataset.entryId));
  if (entry) openRecordDialog(entry);
});
elements.recordOpen.addEventListener("click", () => openRecordDialog());
elements.recordClose.addEventListener("click", () => elements.recordDialog.close());
elements.recordDialog.addEventListener("click", (event) => {
  if (event.target === elements.recordDialog) elements.recordDialog.close();
});
elements.recordDialog.addEventListener("close", releaseRecordLock);
window.addEventListener("pagehide", releaseRecordLock);
elements.recordDate.addEventListener("click", () => {
  try {
    elements.recordDate.showPicker?.();
  } catch {
    // 브라우저 기본 달력 동작을 그대로 사용합니다.
  }
});
elements.recordOpponent.addEventListener("input", () => {
  if (playerNameKey(elements.recordOpponent.value) !== playerNameKey(recordSelectedPlayer)) {
    recordSelectedPlayer = "";
    elements.recordTier.value = "";
    elements.recordRace.value = "";
  }
  renderOpponentSuggestions();
});
elements.recordOpponent.addEventListener("change", () => {
  const exact = recordPlayers.find((player) =>
    playerNameKey(player.name) === playerNameKey(elements.recordOpponent.value));
  if (exact) selectRecordPlayer(exact);
});
elements.recordOpponent.addEventListener("keydown", (event) => {
  if (elements.recordOpponentSuggestions.hidden || !recordSuggestedPlayers.length) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    recordSuggestionIndex = (recordSuggestionIndex + direction + recordSuggestedPlayers.length) %
      recordSuggestedPlayers.length;
    elements.recordOpponentSuggestions.querySelectorAll(".record-opponent-option").forEach((option, index) => {
      option.classList.toggle("is-active", index === recordSuggestionIndex);
    });
  } else if (event.key === "Enter") {
    event.preventDefault();
    const selectedIndex = recordSuggestionIndex >= 0 ? recordSuggestionIndex : 0;
    selectRecordPlayer(recordSuggestedPlayers[selectedIndex]);
  } else if (event.key === "Escape") {
    hideOpponentSuggestions();
  }
});
elements.recordOpponentSuggestions.addEventListener("click", (event) => {
  const option = event.target.closest("[data-player-index]");
  if (!option) return;
  const player = recordSuggestedPlayers[Number(option.dataset.playerIndex)];
  if (player) selectRecordPlayer(player);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".record-opponent-field")) hideOpponentSuggestions();
});
elements.recordForm.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
    event.preventDefault();
  }
});
elements.recordLogin.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = elements.recordLogin.querySelector("button");
  submitButton.disabled = true;
  try {
    const response = await fetch("/api/spawn-diary-admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: elements.recordPassword.value })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "로그인하지 못했습니다.");
    await showRecordForm(payload.csrf);
  } catch (error) {
    elements.recordPassword.setCustomValidity(error.message);
    elements.recordPassword.reportValidity();
    elements.recordPassword.setCustomValidity("");
  } finally {
    submitButton.disabled = false;
  }
});
elements.recordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter !== elements.recordSave) return;
  elements.recordSave.disabled = true;
  elements.recordFormStatus.textContent = "저장하고 있습니다.";
  const formData = new FormData(elements.recordForm);
  try {
    const editingId = editingEntry?.id;
    const response = await fetch(editingId
      ? `/api/admin/spawn-diary/${encodeURIComponent(editingId)}`
      : "/api/admin/spawn-diary", {
      method: editingId ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": recordCsrf
      },
      body: JSON.stringify(Object.fromEntries(formData.entries()))
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "기록을 저장하지 못했습니다.");
    elements.recordForm.reset();
    recordSelectedPlayer = "";
    const successMessage = editingId ? "경기 기록을 수정했습니다." : "새 경기 기록을 저장했습니다.";
    editingEntry = null;
    elements.recordDialog.close();
    elements.status.classList.add("success");
    elements.status.textContent = successMessage;
    await loadDiary();
  } catch (error) {
    elements.recordFormStatus.textContent = error.message;
  } finally {
    elements.recordSave.disabled = false;
  }
});
elements.recordDelete.addEventListener("click", async () => {
  const editingId = editingEntry?.id;
  if (!editingId || !window.confirm("이 경기 기록을 삭제할까요? 삭제한 기록은 되돌릴 수 없습니다.")) return;
  elements.recordDelete.disabled = true;
  elements.recordSave.disabled = true;
  elements.recordFormStatus.textContent = "삭제하고 있습니다.";
  try {
    const response = await fetch(`/api/admin/spawn-diary/${encodeURIComponent(editingId)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": recordCsrf }
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "기록을 삭제하지 못했습니다.");
    editingEntry = null;
    elements.recordDialog.close();
    elements.status.classList.add("success");
    elements.status.textContent = "경기 기록을 삭제했습니다.";
    await loadDiary();
  } catch (error) {
    elements.recordFormStatus.textContent = error.message;
  } finally {
    elements.recordDelete.disabled = false;
    elements.recordSave.disabled = false;
  }
});

restoreDiaryData();
loadDiary();
