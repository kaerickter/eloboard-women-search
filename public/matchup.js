const byId = (id) => document.getElementById(id);
const state = { players: [], picked: ["오리꿍", "비재희", "치리"], rows: [], mode: "many", range: "all", sort: "games", expanded: "" };
const raceName = { T: "테란", Z: "저그", P: "프로토스" };
const fallback = [{name:"이아깽",race:"T"},{name:"오리꿍",race:"Z"},{name:"비재희",race:"Z"},{name:"치리",race:"Z"},{name:"귀요민정",race:"Z"},{name:"태린",race:"P"}];
const pct = (record) => Math.round((record[0] / (record[0] + record[1] || 1)) * 100);
const safe = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const mainNames = () => byId("mainInput").value.split(/[,，]/).map((value) => value.trim()).filter(Boolean);
const player = (name) => state.players.find((item) => item.name === name) || { name, race: "P" };

function renderPickers() {
  byId("chips").innerHTML = state.picked.map((name) => '<button type="button" data-remove="' + safe(name) + '">' + safe(name) + ' ×</button>').join("");
  byId("quickPlayers").innerHTML = state.players.filter((item) => !mainNames().includes(item.name)).slice(0, 7).map((item) => '<button type="button" data-pick="' + safe(item.name) + '" class="' + (state.picked.includes(item.name) ? "on" : "") + '">+ ' + safe(item.name) + '</button>').join("");
  byId("playerList").innerHTML = state.players.map((item) => '<option value="' + safe(item.name) + '">' + raceName[item.race] + '</option>').join("");
  document.querySelectorAll("[data-remove]").forEach((button) => button.onclick = () => toggle(button.dataset.remove));
  document.querySelectorAll("[data-pick]").forEach((button) => button.onclick = () => toggle(button.dataset.pick));
}
function toggle(name) {
  if (!name || mainNames().includes(name)) return;
  if (state.mode === "one") state.picked = state.picked.includes(name) ? [] : [name];
  else state.picked = state.picked.includes(name) ? state.picked.filter((item) => item !== name) : state.picked.length < 12 ? [...state.picked, name] : state.picked;
  renderPickers();
}
function renderSuggestions(query) {
  const box = byId("suggestions");
  const items = state.players.filter((item) => !mainNames().includes(item.name) && !state.picked.includes(item.name) && item.name.includes(query)).slice(0, 12);
  box.hidden = !query || !items.length;
  box.innerHTML = items.map((item) => '<button type="button" data-suggest="' + safe(item.name) + '"><i class="race ' + item.race + '">' + item.race + '</i><b>' + safe(item.name) + '</b><small>' + raceName[item.race] + '</small></button>').join("");
  box.querySelectorAll("[data-suggest]").forEach((button) => button.onclick = () => { toggle(button.dataset.suggest); byId("opponentInput").value = ""; box.hidden = true; });
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
  const summary = rows.reduce((total, row) => { const record = state.range === "all" ? row.total : row.recent; return [total[0] + record[0], total[1] + record[1]]; }, [0, 0]);
  const best = [...rows].sort((a, b) => pct(state.range === "all" ? b.total : b.recent) - pct(state.range === "all" ? a.total : a.recent))[0];
  byId("summaryTitle").textContent = (state.range === "all" ? "전체" : "최근 90일") + " 종합";
  byId("summaryWins").textContent = summary[0] + "승"; byId("summaryLosses").textContent = summary[1] + "패";
  byId("summaryRate").textContent = pct(summary) + "%"; byId("summaryBar").style.width = pct(summary) + "%";
  const bestPlayer = best ? player(best.opponent) : { race: "T" };
  byId("bestRace").className = "race " + bestPlayer.race; byId("bestRace").textContent = best ? bestPlayer.race : "-"; byId("bestName").textContent = best?.opponent || "-";
  byId("latestDate").textContent = rows.find((row) => row.lastPlayed !== "경기 없음")?.lastPlayed || "경기 없음";
  byId("resultMain").textContent = state.mode === "group" ? mainNames().length + "명" : (mainNames()[0] || "-");
  byId("resultStatus").textContent = rows.length + "개 대결 조합 · 총 " + (summary[0] + summary[1]) + "경기";
  byId("recordRows").innerHTML = rows.length ? rows.map((row) => {
    const record = state.range === "all" ? row.total : row.recent; const rate = pct(record); const p = player(row.opponent); const key = row.main + "|" + row.opponent;
    const detail = state.expanded === key ? '<div class="match-detail">' + (row.maps.length ? row.maps.map((match) => '<span><b class="' + (match.result === "승" ? "win" : "loss") + '">' + match.result + '</b>' + safe(match.date) + ' · ' + safe(match.map) + '</span>').join("") : "등록된 맞대결이 없습니다.") + '</div>' : "";
    return '<div><div class="matchup-tr"><span class="matchup-player"><i class="race ' + p.race + '">' + p.race + '</i><b>' + safe(state.mode === "group" ? row.main + " vs " + row.opponent : row.opponent) + '</b></span><span class="score"><b>' + record[0] + '</b>승 <em>' + record[1] + '</em>패</span><span><b class="' + (rate >= 50 ? "rate-positive" : "rate-negative") + '">' + rate + '%</b><i class="mini"><i style="width:' + rate + '%"></i></i></span><span class="recent">' + row.recent[0] + '승 ' + row.recent[1] + '패<small>' + pct(row.recent) + '%</small></span><span>' + safe(row.lastPlayed) + '</span><span><button class="details" type="button" data-detail="' + safe(key) + '">' + (state.expanded === key ? "−" : "+") + '</button></span></div>' + detail + '</div>';
  }).join("") : '<div class="empty-row">검색 결과가 없습니다.</div>';
  document.querySelectorAll("[data-detail]").forEach((button) => button.onclick = () => { state.expanded = state.expanded === button.dataset.detail ? "" : button.dataset.detail; renderResults(); });
}
async function search() {
  const mains = mainNames(); if (!mains.length || !state.picked.length) return;
  const button = byId("searchButton"); const error = byId("errorMessage"); button.disabled = true; button.textContent = "불러오는 중…"; error.hidden = true; byId("resultStatus").textContent = "eloboard에서 최신 기록을 가져오고 있습니다.";
  try {
    const response = await fetch("/api/matchup/records", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mains: state.mode === "group" ? mains : [mains[0]], opponents: state.picked }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "전적을 불러오지 못했습니다.");
    state.rows = data.rows || []; byId("updatedAt").textContent = "갱신 " + new Date(data.updatedAt).toLocaleTimeString("ko-KR"); renderResults();
  } catch (cause) { error.textContent = cause.message; error.hidden = false; byId("resultStatus").textContent = "조회에 실패했습니다."; }
  finally { button.disabled = false; button.innerHTML = '전적 검색 <span>→</span>'; }
}
document.querySelectorAll("[data-mode]").forEach((button) => button.onclick = () => { state.mode = button.dataset.mode; document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("selected", item === button)); if (state.mode === "one") state.picked = state.picked.slice(0, 1); byId("mainLabel").textContent = state.mode === "group" ? "기준 선수들 · 쉼표로 구분" : "기준 선수"; byId("mainInput").placeholder = state.mode === "group" ? "이아깽, 오리꿍, 비재희" : "선수 이름을 직접 입력하세요"; byId("multiHint").hidden = state.mode === "one"; renderPickers(); });
document.querySelectorAll("[data-range]").forEach((button) => button.onclick = () => { state.range = button.dataset.range; document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("selected", item === button)); renderResults(); });
byId("opponentInput").addEventListener("input", (event) => renderSuggestions(event.target.value.trim())); byId("mainInput").addEventListener("input", renderPickers); byId("searchButton").onclick = search; byId("sortSelect").onchange = (event) => { state.sort = event.target.value; renderResults(); };
fetch("/api/matchup/players").then((response) => response.json()).then((data) => { state.players = data.players?.length ? data.players : fallback; renderPickers(); }).catch(() => { state.players = fallback; renderPickers(); });
state.players = fallback; renderPickers(); search();
