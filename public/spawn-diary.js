"use strict";

const PAGE_SIZE = 50;
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
  status: document.querySelector("#statusMessage")
};

let entries = [];
let filteredEntries = [];
let currentPage = 1;

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

function searchableText(entry) {
  return Object.values(entry).map(text).join(" ").toLocaleLowerCase("ko");
}

function formatDate(value) {
  const date = text(value).slice(0, 10);
  return date.replaceAll("-", "/");
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
  elements.map.insertAdjacentHTML("beforeend", maps
    .map((map) => `<option value="${escapeHtml(map)}">${escapeHtml(map)}</option>`)
    .join(""));
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
        <td>${escapeHtml(formatDate(entry.match_date))}</td>
        <td>${escapeHtml(entry.game_format)}</td>
        <td>${escapeHtml(entry.opponent)}</td>
        <td>${escapeHtml(entry.tier)}</td>
        <td>${escapeHtml(entry.opponent_race)}</td>
        <td>${escapeHtml(entry.map_name)}</td>
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

function applyFilters() {
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
  });
  currentPage = 1;
  render();
}

async function loadDiary() {
  try {
    const response = await fetch("/api/spawn-diary");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "스폰일지를 불러오지 못했습니다.");
    entries = Array.isArray(payload.entries) ? payload.entries : [];
    filteredEntries = entries;
    updateSummary();
    populateMaps();
    render();
  } catch (error) {
    elements.rows.innerHTML = '<tr><td class="empty-cell" colspan="11">기록을 불러오지 못했습니다.</td></tr>';
    elements.filterSummary.textContent = "연결 상태를 확인해 주세요.";
    elements.status.textContent = error.message;
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
  }
});
elements.next.addEventListener("click", () => {
  if (currentPage * PAGE_SIZE < filteredEntries.length) {
    currentPage += 1;
    render();
  }
});

loadDiary();
