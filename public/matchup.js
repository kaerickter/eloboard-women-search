const byId = (id) => document.getElementById(id);
const state = {
  players: [], quick: [], quickStatus: "최근 전적 확인 중…",
  mains: ["이아깽"], opponents: [], rows: [], mode: "many",
  range: "all", sort: "games", expanded: "", recommendationRequest: 0
};
const raceName = { T: "테란", Z: "저그", P: "프로토스" };
const fallback = [{name:"이아깽",race:"T"},{name:"오리꿍",race:"Z"},{name:"비재희",race:"Z"},{name:"치리",race:"Z"},{name:"귀요민정",race:"Z"},{name:"태린",race:"P"}];
const pct = (record) => Math.round((record[0] / (record[0] + record[1] || 1)) * 100);
const safe = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const player = (name) => state.players.find((item) => item.name === name) || { name, race: "P" };
const sideNames = (side) => side === "main" ? state.mains : state.opponents;
const sideLimit = (side) => state.mode === "group" ? 6 : side === "main" || state.mode === "one" ? 1 : 12;

function setError(message = "") {
  byId("errorMessage").textContent = message;
  byId("errorMessage").hidden = !message;
}

function chipMarkup(name, side, index) {
  const p = player(name);
  return '<span class="player-chip"><i class="race ' + p.race + '">' + p.race + '</i><b>' + safe(name) + '</b><button type="button" data-remove-side="' + side + '" data-remove-index="' + index + '" aria-label="' + safe(name) + ' 삭제">×</button></span>';
}

function renderPickers() {
  byId("mainChips").innerHTML = state.mains.map((name, index) => chipMarkup(name, "main", index)).join("");
  byId("opponentChips").innerHTML = state.opponents.map((name, index) => chipMarkup(name, "opponent", index)).join("");
  document.querySelectorAll("[data-remove-side]").forEach((button) => {
    button.onclick = () => removePlayer(button.dataset.removeSide, Number(button.dataset.removeIndex));
  });

  const group = state.mode === "group";
  byId("mainLabel").textContent = group ? "A팀 선수" : "기준 선수";
  byId("opponentLabel").childNodes[0].textContent = group ? "B팀 선수 " : "상대 선수 ";
  byId("multiHint").textContent = state.mode === "one" ? "1명" : group ? "최대 6명" : "여러 명 선택 가능";
  byId("mainInput").placeholder = group ? "A팀에 추가할 선수를 검색하세요" : "기준 선수를 검색하세요";
  byId("opponentInput").placeholder = group ? "B팀에 추가할 선수를 검색하세요" : "상대 선수를 검색하세요";
  byId("clearMains").hidden = !state.mains.length;
  byId("clearOpponents").hidden = !state.opponents.length;
  byId("clearAll").disabled = !state.mains.length && !state.opponents.length;

  const combinations = state.mains.length * state.opponents.length;
  byId("selectionGuide").textContent = group
    ? "A팀 " + state.mains.length + "/6명 · B팀 " + state.opponents.length + "/6명 · " + combinations + "개 대결 조합"
    : state.mode === "one"
      ? "기준 선수 1명과 상대 선수 1명을 선택하세요."
      : "기준 선수 1명 · 상대 " + state.opponents.length + "/12명";
  byId("searchButton").disabled = !state.mains.length || !state.opponents.length;
  renderQuickPlayers();
}

function addPlayer(side, rawName) {
  const name = String(rawName || "").trim();
  if (!name) return;
  const target = sideNames(side);
  const other = sideNames(side === "main" ? "opponent" : "main");
  if (target.includes(name)) return;
  if (other.includes(name)) return setError("같은 선수를 양쪽 팀에 동시에 넣을 수 없습니다.");
  if (target.length >= sideLimit(side)) return setError((side === "main" ? "기준/A팀" : "상대/B팀") + "은 최대 " + sideLimit(side) + "명까지 선택할 수 있습니다.");
  if (sideLimit(side) === 1) target.splice(0, target.length, name);
  else target.push(name);
  setError();
  state.rows = [];
  state.expanded = "";
  byId(side === "main" ? "mainInput" : "opponentInput").value = "";
  byId(side === "main" ? "mainSuggestions" : "opponentSuggestions").hidden = true;
  renderPickers();
  renderResults();
  if (side === "main") loadRecommendations(false);
}

function removePlayer(side, index) {
  sideNames(side).splice(index, 1);
  state.rows = [];
  state.expanded = "";
  renderPickers();
  renderResults();
  if (side === "main" && state.mains.length) loadRecommendations(false);
}

function clearSide(side) {
  sideNames(side).splice(0);
  state.rows = [];
  renderPickers();
  renderResults();
}

function renderSuggestions(side, query) {
  const box = byId(side === "main" ? "mainSuggestions" : "opponentSuggestions");
  const unavailable = new Set([...state.mains, ...state.opponents]);
  const normalized = query.toLocaleLowerCase("ko");
  const items = state.players.filter((item) => !unavailable.has(item.name) && item.name.toLocaleLowerCase("ko").includes(normalized)).slice(0, 12);
  box.hidden = !query || !items.length;
  box.innerHTML = items.map((item, index) => '<button type="button" data-suggestion-index="' + index + '"><i class="race ' + item.race + '">' + item.race + '</i><b>' + safe(item.name) + '</b><small>' + raceName[item.race] + '</small></button>').join("");
  box.querySelectorAll("[data-suggestion-index]").forEach((button) => {
    button.onclick = () => addPlayer(side, items[Number(button.dataset.suggestionIndex)].name);
  });
}

function renderQuickPlayers() {
  byId("quickLabel").textContent = state.mode === "group" ? "B팀 빠른 선택" : "상대 빠른 선택";
  byId("quickPlayers").innerHTML = state.quick.length
    ? state.quick.filter((item) => !state.mains.includes(item.name)).slice(0, 9).map((item, index) => '<button type="button" data-quick-index="' + index + '" class="' + (state.opponents.includes(item.name) ? "on" : "") + '" title="최근 90일 ' + item.games + '경기">' + (state.opponents.includes(item.name) ? "✓ " : "+ ") + safe(item.name) + '<small>' + item.games + '경기</small></button>').join("")
    : '<span class="quick-status">' + safe(state.quickStatus) + '</span>';
  const visible = state.quick.filter((item) => !state.mains.includes(item.name)).slice(0, 9);
  document.querySelectorAll("[data-quick-index]").forEach((button) => {
    button.onclick = () => {
      const name = visible[Number(button.dataset.quickIndex)].name;
      const existing = state.opponents.indexOf(name);
      if (existing >= 0) removePlayer("opponent", existing); else addPlayer("opponent", name);
    };
  });
}

function sortedRows() {
  return [...state.rows].sort((a, b) => {
    const ar = state.range === "all" ? a.total : a.recent;
    const br = state.range === "all" ? b.total : b.recent;
    if (state.sort === "rate") return pct(br) - pct(ar);
    if (state.sort === "recent") return b.lastPlayed.localeCompare(a.lastPlayed);
    return br[0] + br[1] - ar[0] - ar[1];
  });
}

function renderResults() {
  const rows = sortedRows();
  const summary = rows.reduce((total, row) => {
    const record = state.range === "all" ? row.total : row.recent;
    return [total[0] + record[0], total[1] + record[1]];
  }, [0, 0]);
  const best = [...rows].sort((a, b) => pct(state.range === "all" ? b.total : b.recent) - pct(state.range === "all" ? a.total : a.recent))[0];
  const group = state.mode === "group";
  byId("summaryTitle").textContent = (state.range === "all" ? "전체" : "최근 90일") + (group ? " 팀 합산" : " 종합");
  byId("summaryWins").textContent = summary[0] + "승";
  byId("summaryLosses").textContent = summary[1] + "패";
  byId("summaryRate").textContent = pct(summary) + "%";
  byId("summaryBar").style.width = pct(summary) + "%";
  const bestPlayer = best ? player(best.opponent) : { race: "T" };
  byId("bestRace").className = "race " + bestPlayer.race;
  byId("bestRace").textContent = best ? bestPlayer.race : "-";
  byId("bestName").textContent = best ? (group ? best.main + " vs " + best.opponent : best.opponent) : "-";
  byId("bestTitle").textContent = group ? "가장 우세한 조합" : "가장 우세한 상대";
  byId("bestDescription").textContent = group ? "A팀 관점 최고 승률 대결" : "선택한 상대 중 최고 승률";
  byId("latestDate").textContent = rows.map((row) => row.lastPlayed).filter((date) => date !== "경기 없음").sort((a, b) => b.localeCompare(a))[0] || "경기 없음";
  byId("resultMain").textContent = group ? "A팀 " + state.mains.length + "명 vs B팀 " + state.opponents.length + "명" : (state.mains[0] || "-");
  byId("resultHeading").textContent = group ? "팀 비교" : "기준 상대전적";
  byId("resultStatus").textContent = rows.length ? rows.length + "개 대결 조합 · 총 " + (summary[0] + summary[1]) + "경기" : "검색할 선수를 선택해 주세요.";
  byId("recordRows").innerHTML = rows.length ? rows.map((row) => {
    const record = state.range === "all" ? row.total : row.recent;
    const rate = pct(record);
    const p = player(row.opponent);
    const key = row.main + "|" + row.opponent;
    const recentRate = pct(row.recent);
    const playerLabel = safe(group ? row.main + " vs " + row.opponent : row.opponent);
    const detail = state.expanded === key ? '<div class="match-detail">' + (row.maps.length ? row.maps.map((match) => '<span><b class="' + (match.result === "승" ? "win" : "loss") + '">' + match.result + '</b>' + safe(match.date) + ' · ' + safe(match.map) + '</span>').join("") : "등록된 맞대결이 없습니다.") + '</div>' : "";
    return '<article class="record-graph-card"><div class="graph-card-head"><span class="matchup-player"><i class="race ' + p.race + '">' + p.race + '</i><span><b>' + playerLabel + '</b><small>' + raceName[p.race] + '</small></span></span><span class="last-played">최근 경기 <b>' + safe(row.lastPlayed) + '</b></span></div><div class="graph-card-body"><div class="donut" style="--rate:' + rate + '"><div><strong>' + rate + '%</strong><small>승률</small></div></div><div class="graph-stats"><div class="score-pair"><span><small>WIN</small><strong>' + record[0] + '<em>승</em></strong></span><i></i><span class="loss"><small>LOSS</small><strong>' + record[1] + '<em>패</em></strong></span></div><div class="battle-bar" aria-label="승률 ' + rate + '%"><i class="win-bar" style="width:' + rate + '%"></i><i class="loss-bar" style="width:' + (100-rate) + '%"></i></div><div class="bar-labels"><span>승리 ' + rate + '%</span><span>패배 ' + (100-rate) + '%</span></div></div></div><div class="recent-panel"><div><span>최근 90일</span><strong>' + row.recent[0] + '승 ' + row.recent[1] + '패</strong></div><div class="recent-meter"><i style="width:' + recentRate + '%"></i></div><b>' + recentRate + '%</b><button class="details" type="button" data-detail="' + safe(key) + '" aria-label="상세 경기 ' + (state.expanded === key ? "닫기" : "열기") + '">' + (state.expanded === key ? "−" : "+") + '</button></div>' + detail + '</article>';
  }).join("") : '<div class="empty-row">검색 결과가 없습니다.</div>';
  document.querySelectorAll("[data-detail]").forEach((button) => button.onclick = () => {
    state.expanded = state.expanded === button.dataset.detail ? "" : button.dataset.detail;
    renderResults();
  });
}

async function loadRecommendations(autoSearch = false) {
  const main = state.mains[0];
  if (!main) {
    state.quick = [];
    state.quickStatus = "기준/A팀 선수를 먼저 선택하세요.";
    return renderQuickPlayers();
  }
  const requestId = ++state.recommendationRequest;
  state.quick = [];
  state.quickStatus = "최근 90일 상대를 찾는 중…";
  renderQuickPlayers();
  try {
    const response = await fetch("/api/matchup/recommendations?main=" + encodeURIComponent(main));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "최근 상대 목록을 불러오지 못했습니다.");
    if (requestId !== state.recommendationRequest) return;
    state.quick = data.recommendations || [];
    state.quickStatus = state.quick.length ? "" : "최근 90일 맞대결이 없습니다.";
    if (autoSearch && !state.opponents.length && state.quick.length) state.opponents = [state.quick[0].name];
    renderPickers();
    if (autoSearch && state.opponents.length) await search();
  } catch (cause) {
    if (requestId !== state.recommendationRequest) return;
    state.quick = [];
    state.quickStatus = cause.message || "최근 상대 목록을 불러오지 못했습니다.";
    renderQuickPlayers();
  }
}

async function search() {
  if (!state.mains.length || !state.opponents.length) return setError("양쪽에서 비교할 선수를 한 명 이상 선택해 주세요.");
  if (state.mains.length * state.opponents.length > 36) return setError("전체 대결 조합은 최대 36개까지 가능합니다.");
  const button = byId("searchButton");
  button.disabled = true;
  button.textContent = "불러오는 중…";
  setError();
  byId("resultStatus").textContent = "eloboard에서 최신 기록을 가져오고 있습니다.";
  try {
    const response = await fetch("/api/matchup/records", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mains: state.mains, opponents: state.opponents })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "전적을 불러오지 못했습니다.");
    state.rows = data.rows || [];
    byId("updatedAt").textContent = "갱신 " + new Date(data.updatedAt).toLocaleTimeString("ko-KR");
    renderResults();
  } catch (cause) {
    setError(cause.message);
    byId("resultStatus").textContent = "조회에 실패했습니다.";
  } finally {
    button.disabled = !state.mains.length || !state.opponents.length;
    button.innerHTML = '전적 검색 <span>→</span>';
  }
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("selected", button.dataset.mode === mode));
  if (mode !== "group") state.mains = state.mains.slice(0, 1);
  if (mode === "one") state.opponents = state.opponents.slice(0, 1);
  if (mode === "group") state.opponents = state.opponents.slice(0, 6);
  state.rows = [];
  state.expanded = "";
  setError();
  renderPickers();
  renderResults();
}

document.querySelectorAll("[data-mode]").forEach((button) => button.onclick = () => setMode(button.dataset.mode));
document.querySelectorAll("[data-range]").forEach((button) => button.onclick = () => {
  state.range = button.dataset.range;
  document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("selected", item === button));
  renderResults();
});
[["main", "mainInput"], ["opponent", "opponentInput"]].forEach(([side, id]) => {
  byId(id).addEventListener("input", (event) => renderSuggestions(side, event.target.value.trim()));
  byId(id).addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const first = byId(side === "main" ? "mainSuggestions" : "opponentSuggestions").querySelector("button");
    if (first) first.click(); else addPlayer(side, event.currentTarget.value);
  });
});
byId("clearMains").onclick = () => clearSide("main");
byId("clearOpponents").onclick = () => clearSide("opponent");
byId("clearAll").onclick = () => { state.mains = []; state.opponents = []; clearSide("main"); };
byId("searchButton").onclick = search;
byId("sortSelect").onchange = (event) => { state.sort = event.target.value; renderResults(); };
document.addEventListener("click", (event) => {
  if (!event.target.closest(".main-picker")) byId("mainSuggestions").hidden = true;
  if (!event.target.closest(".opponent-picker")) byId("opponentSuggestions").hidden = true;
});

async function boot() {
  state.players = fallback;
  renderPickers();
  renderResults();
  try {
    const response = await fetch("/api/matchup/players");
    const data = await response.json();
    if (data.players?.length) state.players = data.players;
  } catch {
    state.players = fallback;
  }
  renderPickers();
  await loadRecommendations(true);
}
boot();
