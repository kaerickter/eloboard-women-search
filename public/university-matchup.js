const universityState = { universities: [], rosters: new Map(), results: new Map(), result: null, requestId: 0 };
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

function universityPhotoSources(player) {
  const id = String(player?.broadcastId || "").trim();
  const soop = /^[a-z0-9_-]{2,40}$/i.test(id)
    ? "https://profile.img.sooplive.co.kr/LOGO/" + encodeURIComponent(id.slice(0, 2).toLowerCase()) + "/" + encodeURIComponent(id) + "/" + encodeURIComponent(id) + ".jpg"
    : "";
  return [...new Set([player?.tierStaticImage, soop, player?.image]
    .map((value) => String(value || "").trim())
    .filter((value) => /^https?:\/\//i.test(value) || value.startsWith("/")))];
}

function playerPortrait(player, side) {
  const initial = String(player?.name || "?").trim().slice(0, 1);
  const sources = universityPhotoSources(player);
  const image = sources.length
    ? '<img src="' + universitySafe(sources[0]) + '" data-fallback-src="' + universitySafe(sources[1] || "") + '" data-last-src="' + universitySafe(sources[2] || "") + '" alt="' + universitySafe(player.name) + ' 프로필 사진" loading="lazy">'
    : "";
  return '<span class="university-player-photo photo-' + side + '"><span aria-hidden="true">' + universitySafe(initial) + '</span>' + image + '</span>';
}

function bindPlayerImages() {
  universityById("tierResults").querySelectorAll(".university-player-photo img").forEach((image) => {
    const tryFallback = () => {
      const next = image.dataset.fallbackSrc;
      if (!next) { image.hidden = true; return; }
      image.dataset.fallbackSrc = image.dataset.lastSrc || "";
      image.dataset.lastSrc = "";
      image.src = next;
    };
    image.addEventListener("error", tryFallback);
    if (image.complete && !image.naturalWidth) tryFallback();
  });
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

function renderPair(row, universityA, universityB, partial = false) {
  const unverified = row.pending || row.unavailable;
  const totalGames = row.total[0] + row.total[1];
  const recentGames = row.recent[0] + row.recent[1];
  const rateA = totalGames ? Math.round(row.total[0] / totalGames * 1000) / 10 : 0;
  const rateB = totalGames ? Math.round(row.total[1] / totalGames * 1000) / 10 : 0;
  const recentRate = recentGames ? Math.round(row.recent[0] / recentGames * 1000) / 10 : 0;
  const totalA = unverified ? "–" : row.total[0];
  const totalB = unverified ? "–" : row.total[1];
  const rateAText = unverified ? "전적 미확인" : rateA + "% WINS";
  const rateBText = unverified ? "전적 미확인" : rateB + "% WINS";
  const recentText = partial ? "집계 중" : row.recent[0] + "승 " + row.recent[1] + "패";
  const recentRateText = partial ? "" : recentRate + "%";
  const totalText = unverified ? "전적 미확인" : totalGames ? row.total[0] + "승 " + row.total[1] + "패" : "전적 없음";
  return '<article class="university-duel-card"><div class="university-duel-stage">'
    + '<div class="university-duel-side side-a"><small>' + universitySafe(universityA) + ' · ' + universitySafe(row.tier) + '티어</small>' + playerPortrait(row.playerA, "a") + '<strong class="university-player-name">' + universitySafe(row.playerA.name) + '</strong><b class="university-duel-wins">' + totalA + '</b><span>' + rateAText + '</span></div>'
    + '<div class="university-duel-center"><div class="university-vs-logo"><b>VS</b></div><div class="university-duel-recent"><span>최근 90일</span><strong>' + recentText + '</strong><em>' + recentRateText + '</em></div></div>'
    + '<div class="university-duel-side side-b"><small>' + universitySafe(universityB) + ' · ' + universitySafe(row.tier) + '티어</small>' + playerPortrait(row.playerB, "b") + '<strong class="university-player-name">' + universitySafe(row.playerB.name) + '</strong><b class="university-duel-wins">' + totalB + '</b><span>' + rateBText + '</span></div>'
    + '</div><footer class="university-duel-meta"><span>전체 전적 <strong>' + totalText + '</strong></span><span>최근 경기 <strong>' + universitySafe(row.lastPlayed) + '</strong></span></footer></article>';
}

function renderResults(data) {
  universityById("resultTitle").textContent = data.universityA + " vs " + data.universityB;
  universityById("resultStatus").textContent = !data.pairCount ? "두 대학 사이에 동일 티어 선수 조합이 없습니다."
    : data.pendingPairs ? "확인된 " + (data.pairCount - data.pendingPairs) + "/" + data.pairCount + "개 조합의 전적을 표시합니다. 미확인 조합은 합계에서 제외했습니다."
    : data.partial ? "전체 전적 먼저 표시 · 최근 90일 전적 집계 중…"
    : "동일 티어 " + data.tiers.length + "개 · 선수 조합 " + data.pairCount + "개를 모두 조회했습니다.";
  universityById("allScore").textContent = data.pendingPairs
    ? (data.total.games ? recordText(data.total) : "확인된 전적 없음") + " · " + data.pendingPairs + "개 미확인"
    : recordText(data.total);
  universityById("allRate").textContent = data.pendingPairs ? "확인된 전적 기준 승률 " + data.total.rate + "%" : "승률 " + data.total.rate + "%";
  universityById("recentScore").textContent = data.partial ? "집계 중" : recordText(data.recent);
  universityById("recentRate").textContent = data.partial ? "잠시 후 표시됩니다" : "승률 " + data.recent.rate + "%";
  universityById("pairCount").textContent = data.pairCount + "개";
  universityById("tierCount").textContent = data.tiers.length + "개 티어";
  universityById("tierResults").innerHTML = data.tiers.length ? data.tiers.map((tier) => {
    const rows = data.rows.filter((row) => row.tier === tier.tier);
    const missing = rows.filter((row) => row.pending || row.unavailable).length;
    const totalText = missing ? (tier.total.games ? recordText(tier.total) : "확인된 전적 없음") + " · " + missing + "개 미확인" : recordText(tier.total);
    return '<article class="tier-card"><header class="tier-head"><span class="tier-badge">' + universitySafe(tier.tier) + '</span><div><h3>' + universitySafe(tier.tier) + '티어 대결</h3><small>' + tier.pairCount + '개 교차 조합</small></div><div class="tier-totals"><span>총 전적<b>' + totalText + '</b></span><span>최근 90일<b>' + (data.partial ? "집계 중" : recordText(tier.recent)) + '</b></span></div></header><div class="university-duel-list">' + rows.map((row) => renderPair(row, data.universityA, data.universityB, data.partial)).join("") + '</div></article>';
  }).join("") : '<div class="university-empty">동일 티어 선수 조합이 없습니다.</div>';
  bindPlayerImages();
}

async function requestUniversityMatchup(universityA, universityB, summaryOnly) {
  const response = await fetch("/api/universities/matchup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ universityA, universityB, summaryOnly })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "대학대결 전적을 불러오지 못했습니다.");
  return data;
}

async function searchUniversities() {
  const button = universityById("searchUniversities");
  const universityA = universityById("universityA").value;
  const universityB = universityById("universityB").value;
  const requestId = ++universityState.requestId;
  const cacheKey = universityA + "\u0000" + universityB;
  const cached = universityState.results.get(cacheKey);
  setUniversityError();
  button.disabled = true;
  button.textContent = "전적 조회 중…";
  try {
    if (cached) {
      universityState.result = cached.data;
      renderResults(cached.data);
      if (Date.now() - cached.savedAt < 30 * 1000) return;
      universityById("resultStatus").textContent = "이전 결과 표시 중 · 최신 전적 확인 중…";
      const full = await requestUniversityMatchup(universityA, universityB, false);
      if (requestId !== universityState.requestId) return;
      universityState.result = full;
      universityState.results.set(cacheKey, { savedAt: Date.now(), data: full });
      renderResults(full);
      return;
    }
    universityState.result = null;
    universityById("resultTitle").textContent = universityA + " vs " + universityB;
    universityById("resultStatus").textContent = "전체 전적을 먼저 불러오고 있습니다…";
    universityById("allScore").textContent = "조회 중";
    universityById("allRate").textContent = "";
    universityById("recentScore").textContent = "집계 중";
    universityById("recentRate").textContent = "";
    universityById("pairCount").textContent = "조회 중";
    universityById("tierCount").textContent = "";
    universityById("tierResults").innerHTML = '<div class="university-empty">선수별 전체 전적을 불러오고 있습니다…</div>';
    try {
      const quick = await requestUniversityMatchup(universityA, universityB, true);
      if (requestId !== universityState.requestId) return;
      universityState.result = quick;
      renderResults(quick);
      if (!quick.partial) {
        universityState.results.set(cacheKey, { savedAt: Date.now(), data: quick });
        return;
      }
    } catch {
      // 빠른 단계가 실패해도 기존 전체 조회를 계속 시도합니다.
    }
    const full = await requestUniversityMatchup(universityA, universityB, false);
    if (requestId !== universityState.requestId) return;
    universityState.result = full;
    universityState.results.set(cacheKey, { savedAt: Date.now(), data: full });
    renderResults(full);
  } catch (error) {
    if (requestId === universityState.requestId) {
      setUniversityError(error.message || "대학대결 전적을 불러오지 못했습니다.");
      universityById("resultStatus").textContent = cached
        ? "최신 전적 확인에 실패했습니다. 이전 결과를 표시합니다. 다시 검색해 주세요."
        : universityState.result?.partial
        ? "전체 전적은 표시했습니다. 최근 90일 전적을 불러오지 못했습니다. 다시 검색해 주세요."
        : "조회에 실패했습니다. 잠시 후 다시 시도해 주세요.";
    }
  } finally {
    if (requestId === universityState.requestId) {
      button.innerHTML = '대학대결 검색 <span>→</span>';
      updateSearchState();
    }
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

["A", "B"].forEach((side) => universityById("university" + side).addEventListener("change", async () => { universityState.requestId += 1; setUniversityError(); await loadRoster(side); updateSearchState(); }));
universityById("searchUniversities").addEventListener("click", searchUniversities);
loadUniversities();
