const universityState = { universities: [], rosters: new Map(), result: null };
const universityById = (id) => document.getElementById(id);
const universitySafe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));

function setUniversityError(message = "") {
  const node = universityById("universityError");
  node.hidden = !message;
  node.textContent = message;
}

function recordText(record) {
  return record.games ? record.wins + "승 " + record.losses + "패" : "전적 없음";
}

function renderRoster(side, name, players) {
  universityById("roster" + side + "Title").textContent = name ? name + " · " + players.length + "명" : "대학 " + side + " 선수";
  universityById("roster" + side).innerHTML = players.length
    ? players.map((player) => '<span class="roster-chip">' + universitySafe(player.name) + ' <b>(' + universitySafe(player.tier) + ')</b></span>').join("")
    : "대학을 선택해 주세요.";
}

async function loadRoster(side) {
  const name = universityById("university" + side).value;
  if (!name) return renderRoster(side, "", []);
  try {
    let players = universityState.rosters.get(name);
    if (!players) {
      const response = await fetch("/api/universities/roster?name=" + encodeURIComponent(name));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      players = data.players || [];
      universityState.rosters.set(name, players);
    }
    renderRoster(side, name, players);
  } catch (error) {
    renderRoster(side, name, []);
    setUniversityError(error.message || "선수 명단을 불러오지 못했습니다.");
  }
}

function updateSearchState() {
  const a = universityById("universityA").value;
  const b = universityById("universityB").value;
  universityById("searchUniversities").disabled = !a || !b || a === b;
}

function renderPair(row, universityA, universityB) {
  const totalGames = row.total[0] + row.total[1];
  const recentGames = row.recent[0] + row.recent[1];
  const rateA = totalGames ? Math.round(row.total[0] / totalGames * 1000) / 10 : 0;
  const rateB = totalGames ? Math.round(row.total[1] / totalGames * 1000) / 10 : 0;
  const recentRate = recentGames ? Math.round(row.recent[0] / recentGames * 1000) / 10 : 0;
  return '<article class="university-duel-card"><div class="university-duel-stage">'
    + '<div class="university-duel-side side-a"><small>' + universitySafe(universityA) + ' · ' + universitySafe(row.tier) + '티어</small><strong class="university-player-name">' + universitySafe(row.playerA.name) + '</strong><b class="university-duel-wins">' + row.total[0] + '</b><span>' + rateA + '% WINS</span></div>'
    + '<div class="university-duel-center"><div class="university-vs-logo"><b>VS</b></div><div class="university-duel-recent"><span>최근 90일</span><strong>' + row.recent[0] + '승 ' + row.recent[1] + '패</strong><em>' + recentRate + '%</em></div></div>'
    + '<div class="university-duel-side side-b"><small>' + universitySafe(universityB) + ' · ' + universitySafe(row.tier) + '티어</small><strong class="university-player-name">' + universitySafe(row.playerB.name) + '</strong><b class="university-duel-wins">' + row.total[1] + '</b><span>' + rateB + '% WINS</span></div>'
    + '</div><footer class="university-duel-meta"><span>전체 전적 <strong>' + (totalGames ? row.total[0] + '승 ' + row.total[1] + '패' : '전적 없음') + '</strong></span><span>최근 경기 <strong>' + universitySafe(row.lastPlayed) + '</strong></span></footer></article>';
}

function renderResults(data) {
  universityById("resultTitle").textContent = data.universityA + " vs " + data.universityB;
  universityById("resultStatus").textContent = data.pairCount ? "동일 티어 " + data.tiers.length + "개 · 선수 조합 " + data.pairCount + "개를 모두 조회했습니다." : "두 대학 사이에 동일 티어 선수 조합이 없습니다.";
  universityById("allScore").textContent = recordText(data.total);
  universityById("allRate").textContent = "승률 " + data.total.rate + "%";
  universityById("recentScore").textContent = recordText(data.recent);
  universityById("recentRate").textContent = "승률 " + data.recent.rate + "%";
  universityById("pairCount").textContent = data.pairCount + "개";
  universityById("tierCount").textContent = data.tiers.length + "개 티어";
  universityById("tierResults").innerHTML = data.tiers.length ? data.tiers.map((tier) => {
    const rows = data.rows.filter((row) => row.tier === tier.tier);
    return '<article class="tier-card"><header class="tier-head"><span class="tier-badge">' + universitySafe(tier.tier) + '</span><div><h3>' + universitySafe(tier.tier) + '티어 대결</h3><small>' + tier.pairCount + '개 교차 조합</small></div><div class="tier-totals"><span>총 전적<b>' + recordText(tier.total) + '</b></span><span>최근 90일<b>' + recordText(tier.recent) + '</b></span></div></header><div class="university-duel-list">' + rows.map((row) => renderPair(row, data.universityA, data.universityB)).join("") + '</div></article>';
  }).join("") : '<div class="university-empty">동일 티어 선수 조합이 없습니다.</div>';
}

async function searchUniversities() {
  const button = universityById("searchUniversities");
  const universityA = universityById("universityA").value;
  const universityB = universityById("universityB").value;
  setUniversityError();
  button.disabled = true;
  button.textContent = "전체 조합 조회 중…";
  universityById("resultStatus").textContent = "같은 티어의 모든 선수 조합을 조회하고 있습니다. 조합 수에 따라 잠시 걸릴 수 있습니다.";
  try {
    const response = await fetch("/api/universities/matchup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ universityA, universityB }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    universityState.result = data;
    renderResults(data);
  } catch (error) {
    setUniversityError(error.message || "대학대결 전적을 불러오지 못했습니다.");
    universityById("resultStatus").textContent = "조회에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  } finally {
    button.innerHTML = '대학대결 검색 <span>→</span>';
    updateSearchState();
  }
}

async function loadUniversities() {
  try {
    const response = await fetch("/api/universities");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    universityState.universities = data.universities || [];
    const options = '<option value="">대학 선택</option>' + universityState.universities.map((item) => '<option value="' + universitySafe(item.name) + '">' + universitySafe(item.label) + '</option>').join("");
    universityById("universityA").innerHTML = options;
    universityById("universityB").innerHTML = options;
    universityById("resultStatus").textContent = "FA를 제외한 " + universityState.universities.length + "개 대학을 불러왔습니다.";
  } catch (error) {
    setUniversityError((error.message || "대학 목록을 불러오지 못했습니다.") + (location.protocol === "file:" ? " 로컬에서는 npm start로 서버를 실행해 주세요." : ""));
  }
}

["A", "B"].forEach((side) => universityById("university" + side).addEventListener("change", async () => { setUniversityError(); await loadRoster(side); updateSearchState(); }));
universityById("searchUniversities").addEventListener("click", searchUniversities);
loadUniversities();
