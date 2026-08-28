const UNIVERSITIES = [
  "BGM", "DM", "HM", "JSA", "뉴캣슬", "수술대", "신세계",
  "씨나인", "엠비대", "와플대", "캄몬스타즈", "케이대", "흑카데미"
];
const GROUPS = ["A", "B", "C", "D"];
const PLAYOFFS = [
  { key: "quarterfinals", title: "8강", count: 4 },
  { key: "semifinals", title: "4강", count: 2 },
  { key: "final", title: "결승", count: 1 }
];
const STORAGE_KEY = "jungman-cup-preview-v2";
const PREVIOUS_STORAGE_KEY = "jungman-cup-preview-v1";

const groupGrid = document.getElementById("groupGrid");
const knockoutGrid = document.getElementById("knockoutGrid");
const matchPanel = document.getElementById("matchPanel");
const cupAdminOpen = document.getElementById("cupAdminOpen");
const cupAdminDialog = document.getElementById("cupAdminDialog");
const cupAdminClose = document.getElementById("cupAdminClose");
const cupAdminStatus = document.getElementById("cupAdminStatus");
const groupEditor = document.getElementById("groupEditor");
const playoffEditor = document.getElementById("playoffEditor");
const cupAdminSave = document.getElementById("cupAdminSave");
const cupAdminReset = document.getElementById("cupAdminReset");
const cupStatsOpen = document.getElementById("cupStatsOpen");
const cupStatsDialog = document.getElementById("cupStatsDialog");
const cupStatsClose = document.getElementById("cupStatsClose");
const cupStatsSummary = document.getElementById("cupStatsSummary");
const cupStatsRows = document.getElementById("cupStatsRows");
const cupStatsEmpty = document.getElementById("cupStatsEmpty");

const authenticated = true;
let selectedMatch = null;
let state = readState();
PLAYOFFS.forEach((stage) => {
  if (!Array.isArray(state.playoffs?.[stage.key])) state.playoffs[stage.key] = emptyPlayoffs()[stage.key];
});

function emptyFixtures() {
  return Object.fromEntries(GROUPS.map((group) => [
    group,
    Array.from({ length: 3 }, () => ({ date: "", home: "", away: "" }))
  ]));
}

function emptyPlayoffs() {
  return Object.fromEntries(PLAYOFFS.map((stage) => [
    stage.key,
    Array.from({ length: stage.count }, () => ({ date: "", home: "", away: "" }))
  ]));
}

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const previous = JSON.parse(localStorage.getItem(PREVIOUS_STORAGE_KEY) || "{}");
    return {
      fixtures: saved.fixtures && typeof saved.fixtures === "object" ? saved.fixtures : emptyFixtures(),
      playoffs: saved.playoffs && typeof saved.playoffs === "object" ? saved.playoffs : emptyPlayoffs(),
      matches: saved.matches && typeof saved.matches === "object"
        ? saved.matches
        : (previous.matches && typeof previous.matches === "object" ? previous.matches : {})
    };
  } catch {
    return { fixtures: emptyFixtures(), playoffs: emptyPlayoffs(), matches: {} };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function matchKey(group, home, away) {
  return [group, home, away].join("::");
}

function formatGroupDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "날짜 미정";
  const date = new Date(value + "T00:00:00");
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date);
  return (date.getMonth() + 1) + "월 " + date.getDate() + "일 (" + weekday + ")";
}

function fixtureStageName(value) {
  return GROUPS.includes(value) ? value + "조" : value;
}

function individualStandings() {
  const players = new Map();
  let completedGames = 0;
  const addGame = (name, won) => {
    const key = String(name || "").trim();
    if (!players.has(key)) players.set(key, { name: key, wins: 0, games: 0 });
    const player = players.get(key);
    player.games += 1;
    if (won) player.wins += 1;
  };

  Object.values(state.matches || {}).forEach((match) => {
    (match.games || []).forEach((game) => {
      const home = String(game.homePlayer || "").trim();
      const away = String(game.awayPlayer || "").trim();
      if (!home || !away || !["home", "away"].includes(game.winner)) return;
      completedGames += 1;
      addGame(home, game.winner === "home");
      addGame(away, game.winner === "away");
    });
  });

  return {
    completedGames,
    rows: [...players.values()].sort((a, b) =>
      b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name, "ko")
    )
  };
}

function renderIndividualStats() {
  const standings = individualStandings();
  cupStatsSummary.textContent = standings.rows.length + "명 · 완료 경기 " + standings.completedGames + "경기";
  cupStatsRows.innerHTML = standings.rows.map((player, index) => {
    const winRate = player.games ? Math.round((player.wins / player.games) * 100) : 0;
    return '<tr class="' + (index < 3 ? "is-top-rank" : "") + '"><td><b class="stats-rank">' +
      (index + 1) + '</b></td><td class="stats-player">' + escapeHtml(player.name) + '</td><td class="stats-wins">' +
      player.wins + '</td><td>' + player.games + '</td><td>' + winRate + "%</td></tr>";
  }).join("");
  cupStatsEmpty.hidden = standings.rows.length > 0;
}

function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + month + "-" + day;
}

function isToday(value) {
  return Boolean(value) && value === localDateKey();
}

function getMatch(group, index) {
  const fixture = state.fixtures?.[group]?.[index];
  const home = fixture?.home || "";
  const away = fixture?.away || "";
  if (!home || !away) return null;
  const key = matchKey(group, home, away);
  if (!state.matches[key]) {
    state.matches[key] = {
      group,
      home,
      away,
      fixtureIndex: index,
      games: Array.from({ length: 9 }, () => ({ homePlayer: "", awayPlayer: "", mapName: "", winner: "" }))
    };
  }
  state.matches[key].fixtureIndex = index;
  state.matches[key].fixtureDate = fixture.date || "";
  return { key, match: state.matches[key] };
}

function getPlayoffMatch(stageKey, index) {
  const fixture = state.playoffs?.[stageKey]?.[index];
  const home = fixture?.home || "";
  const away = fixture?.away || "";
  if (!home || !away) return null;
  const stage = PLAYOFFS.find((item) => item.key === stageKey);
  const group = stage?.title || stageKey;
  const key = matchKey(group, home, away);
  if (!state.matches[key]) {
    state.matches[key] = {
      group, home, away, fixtureIndex: index,
      games: Array.from({ length: 9 }, () => ({ homePlayer: "", awayPlayer: "", mapName: "", winner: "" }))
    };
  }
  state.matches[key].fixtureIndex = index;
  state.matches[key].fixtureDate = fixture.date || "";
  return { key, match: state.matches[key] };
}

function renderGroups() {
  groupGrid.innerHTML = GROUPS.map((group) => {
    const groupFixtures = state.fixtures?.[group] || [];
    const fixtures = [0, 1, 2].map((index) => {
      const fixture = groupFixtures[index] || {};
      const home = fixture.home || "왼쪽 대학 미정";
      const away = fixture.away || "오른쪽 대학 미정";
      const fixtureDate = formatGroupDate(fixture.date);
      const today = isToday(fixture.date);
      const disabled = !fixture.home || !fixture.away;
      return [
        '<div class="fixture' + (today ? " is-today" : "") + '">',
        '<button class="fixture-team" type="button" data-group="' + group + '" data-fixture="' + index +
          '"' + (disabled ? " disabled" : "") + ">" + escapeHtml(home) + "</button>",
        '<span class="fixture-vs"><b>' + (index + 1) + '경기 · VS</b><time>' + escapeHtml(fixtureDate) +
          '</time>' + (today ? '<em class="today-badge">오늘 경기</em>' : "") + "</span>",
        '<button class="fixture-team" type="button" data-group="' + group + '" data-fixture="' + index +
          '"' + (disabled ? " disabled" : "") + ">" + escapeHtml(away) + "</button>",
        "</div>"
      ].join("");
    }).join("");

    return [
      '<article class="group-card">',
      '<header class="group-header"><div><span class="group-letter">' + group + "</span><strong>" + group +
        '조</strong></div><small>대전 3경기</small></header>',
      '<div class="fixture-list">' + fixtures + "</div>",
      "</article>"
    ].join("");
  }).join("");
}

function matchScore(match) {
  let home = 0;
  let away = 0;
  let clinchedAt = 9;
  match.games.forEach((game, index) => {
    if (index >= clinchedAt) return;
    if (game.winner === "home") home += 1;
    if (game.winner === "away") away += 1;
    if (home === 5 || away === 5) clinchedAt = index + 1;
  });
  return { home, away, clinchedAt };
}

function renderMatchPanel() {
  if (!selectedMatch || !state.matches[selectedMatch]) {
    matchPanel.innerHTML = [
      '<div class="match-empty"><div>',
      "<strong>경기를 선택해 주세요</strong>",
      "<span>조별 대진표에서 대학 이름을 누르면<br>9판 5선승 결과표가 여기에 표시됩니다.</span>",
      "</div></div>"
    ].join("");
    return;
  }

  const match = state.matches[selectedMatch];
  const score = matchScore(match);
  const rows = match.games.map((game, index) => {
    const closed = index >= score.clinchedAt;
    const disabled = !authenticated || closed;
    const homeWon = game.winner === "home";
    const awayWon = game.winner === "away";
    return [
      '<div class="set-row' + (closed ? " is-closed" : "") + (game.winner ? " has-winner" : "") + '" data-game="' + index + '">',
      '<span class="set-number">' + (index + 1) + "SET</span>",
      '<label class="player-entry' + (homeWon ? " is-winner" : "") + '"><input type="text" data-field="homePlayer" value="' +
        escapeHtml(game.homePlayer) + '" placeholder="' + escapeHtml(match.home) + ' 선수"' +
        (disabled ? " disabled" : "") + ">" + (homeWon ? '<span>승리</span>' : "") + "</label>",
      '<div class="winner-controls" aria-label="' + (index + 1) + '세트 승자">',
      '<button type="button" data-winner="home" class="' + (homeWon ? "is-home" : "") +
        '" aria-pressed="' + homeWon + '" title="' + escapeHtml(match.home) + ' 승"' +
        (disabled ? " disabled" : "") + ">" + (homeWon ? "승자" : "승") + "</button>",
      '<input class="set-map" type="text" data-field="mapName" value="' + escapeHtml(game.mapName) +
        '" placeholder="맵" aria-label="' + (index + 1) + '세트 맵"' + (disabled ? " disabled" : "") + ">",
      '<button type="button" data-winner="away" class="' + (awayWon ? "is-away" : "") +
        '" aria-pressed="' + awayWon + '" title="' + escapeHtml(match.away) + ' 승"' +
        (disabled ? " disabled" : "") + ">" + (awayWon ? "승자" : "승") + "</button>",
      "</div>",
      '<label class="player-entry' + (awayWon ? " is-winner" : "") + '"><input type="text" data-field="awayPlayer" value="' +
        escapeHtml(game.awayPlayer) + '" placeholder="' + escapeHtml(match.away) + ' 선수"' +
        (disabled ? " disabled" : "") + ">" + (awayWon ? '<span>승리</span>' : "") + "</label>",
      "</div>"
    ].join("");
  }).join("");

  const resultText = score.home === 5 || score.away === 5
    ? (score.home === 5 ? match.home : match.away) + " 승리"
    : "9판 5선승 · 경기 전";

  matchPanel.innerHTML = [
    '<header class="match-sheet-head">',
    '<div class="match-sheet-meta"><span>' + match.group + (GROUPS.includes(match.group) ? "조" : "") + ' MATCH RESULT</span><time>' +
      escapeHtml(formatGroupDate(match.fixtureDate)) + '</time>' +
      (isToday(match.fixtureDate) ? '<em>오늘 경기</em>' : "") + "</div>",
    '<div class="match-title"><strong>' + escapeHtml(match.home) + "</strong>",
    '<div class="match-score"><b>' + score.home + "</b><i>:</i><b>" + score.away + "</b></div>",
    "<strong>" + escapeHtml(match.away) + "</strong></div>",
    '<p class="match-sheet-note">' + escapeHtml(resultText) + "</p>",
    "</header>",
    '<div class="set-table">' + rows + "</div>",
    '<p class="result-lock-note">' +
      "선수명과 세트 승자를 바로 입력할 수 있습니다." +
      "</p>"
  ].join("");
}

function selectMatch(group, index) {
  const result = getMatch(group, index);
  if (!result) return;
  selectedMatch = result.key;
  renderMatchPanel();
  if (window.innerWidth < 1320) matchPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectPlayoffMatch(stageKey, index) {
  const result = getPlayoffMatch(stageKey, index);
  if (!result) return;
  selectedMatch = result.key;
  renderMatchPanel();
  if (window.innerWidth < 1320) matchPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderGroupEditor() {
  groupEditor.innerHTML = GROUPS.map((group) => {
    const fixtures = state.fixtures?.[group] || [];
    const rows = [0, 1, 2].map((index) => {
      const fixture = fixtures[index] || { date: "", home: "", away: "" };
      const options = (value, placeholder) => ['<option value="">' + placeholder + '</option>'].concat(UNIVERSITIES.map((university) => (
        '<option value="' + escapeHtml(university) + '"' + (university === value ? " selected" : "") +
        ">" + escapeHtml(university) + "</option>"
      ))).join("");
      return '<div class="fixture-edit-row"><span class="fixture-edit-number">' + (index + 1) + '경기</span>' +
        '<input type="date" aria-label="' + group + '조 ' + (index + 1) + '경기 날짜" data-fixture-field="date" data-group="' +
        group + '" data-index="' + index + '" value="' + escapeHtml(fixture.date) + '">' +
        '<select aria-label="' + group + '조 ' + (index + 1) + '경기 왼쪽 대학" data-fixture-field="home" data-group="' +
        group + '" data-index="' + index + '">' + options(fixture.home, "왼쪽 대학 선택") + '</select><b>VS</b>' +
        '<select aria-label="' + group + '조 ' + (index + 1) + '경기 오른쪽 대학" data-fixture-field="away" data-group="' +
        group + '" data-index="' + index + '">' + options(fixture.away, "오른쪽 대학 선택") + "</select></div>";
    }).join("");
    return '<div class="group-edit-card"><strong>' + group + '조</strong><span class="group-editor-label">날짜와 대전 대학을 경기별로 선택</span>' + rows + "</div>";
  }).join("");
}

function renderPlayoffEditor() {
  const options = (value, placeholder) => ['<option value="">' + placeholder + '</option>'].concat(UNIVERSITIES.map((university) => (
    '<option value="' + escapeHtml(university) + '"' + (university === value ? " selected" : "") + '>' + escapeHtml(university) + "</option>"
  ))).join("");
  playoffEditor.innerHTML = PLAYOFFS.map((stage) => {
    const rows = (state.playoffs?.[stage.key] || []).map((fixture, index) =>
      '<div class="fixture-edit-row"><span class="fixture-edit-number">' + (index + 1) + '경기</span>' +
      '<input type="date" data-playoff-field="date" data-stage="' + stage.key + '" data-index="' + index + '" value="' + escapeHtml(fixture.date) + '">' +
      '<select data-playoff-field="home" data-stage="' + stage.key + '" data-index="' + index + '">' + options(fixture.home, "왼쪽 대학 선택") + '</select><b>VS</b>' +
      '<select data-playoff-field="away" data-stage="' + stage.key + '" data-index="' + index + '">' + options(fixture.away, "오른쪽 대학 선택") + "</select></div>"
    ).join("");
    return '<div class="group-edit-card"><strong>' + stage.title + '</strong><span class="group-editor-label">날짜와 양쪽 대학을 경기별로 선택</span>' + rows + '</div>';
  }).join("");
}

function renderPlayoffs() {
  const stageCompleted = (stage) => (state.playoffs?.[stage.key] || []).every((fixture, index) => {
    const result = getPlayoffMatch(stage.key, index);
    if (!fixture.home || !fixture.away || !result) return false;
    const score = matchScore(result.match);
    return score.home === 5 || score.away === 5;
  });
  const activeIndex = PLAYOFFS.findIndex((stage) => !stageCompleted(stage));
  const orderedStages = activeIndex < 0
    ? PLAYOFFS
    : PLAYOFFS.slice(activeIndex).concat(PLAYOFFS.slice(0, activeIndex));

  knockoutGrid.innerHTML = orderedStages.map((stage) => {
    const fixtures = (state.playoffs?.[stage.key] || []).map((fixture, index) => {
      const home = fixture.home || "왼쪽 대학 미정";
      const away = fixture.away || "오른쪽 대학 미정";
      const today = isToday(fixture.date);
      const disabled = !fixture.home || !fixture.away;
      return [
        '<div class="fixture' + (today ? " is-today" : "") + '">',
        '<button class="fixture-team" type="button" data-playoff="' + stage.key + '" data-fixture="' + index + '"' + (disabled ? " disabled" : "") + ">" + escapeHtml(home) + "</button>",
        '<span class="fixture-vs"><b>' + (index + 1) + '경기 · VS</b><time>' + escapeHtml(formatGroupDate(fixture.date)) + '</time>' + (today ? '<em class="today-badge">오늘 경기</em>' : "") + "</span>",
        '<button class="fixture-team" type="button" data-playoff="' + stage.key + '" data-fixture="' + index + '"' + (disabled ? " disabled" : "") + ">" + escapeHtml(away) + "</button>",
        "</div>"
      ].join("");
    }).join("");
    return '<article class="knockout-card"><header><strong>' + stage.title + '</strong><span>' + stage.count + '경기</span></header><div class="knockout-fixtures">' + fixtures + '</div></article>';
  }).join("");
}

groupGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-group][data-fixture]");
  if (!button) return;
  selectMatch(button.dataset.group, Number(button.dataset.fixture));
});

knockoutGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-playoff][data-fixture]");
  if (!button) return;
  selectPlayoffMatch(button.dataset.playoff, Number(button.dataset.fixture));
});

matchPanel.addEventListener("input", (event) => {
  if (!authenticated || !selectedMatch) return;
  const row = event.target.closest("[data-game]");
  const field = event.target.dataset.field;
  if (!row || !field) return;
  state.matches[selectedMatch].games[Number(row.dataset.game)][field] = event.target.value;
  saveState();
});

matchPanel.addEventListener("click", (event) => {
  const winner = event.target.closest("[data-winner]");
  if (!authenticated || !winner || !selectedMatch) return;
  const row = winner.closest("[data-game]");
  const game = state.matches[selectedMatch].games[Number(row.dataset.game)];
  game.winner = game.winner === winner.dataset.winner ? "" : winner.dataset.winner;
  saveState();
  renderMatchPanel();
});

cupAdminOpen.addEventListener("click", () => {
  if (!cupAdminDialog.open) cupAdminDialog.showModal();
  renderGroupEditor();
  renderPlayoffEditor();
  cupAdminStatus.textContent = "등록할 경기 내용을 입력한 뒤 저장해 주세요.";
});

cupAdminClose.addEventListener("click", () => cupAdminDialog.close());
cupAdminDialog.addEventListener("click", (event) => {
  if (event.target === cupAdminDialog) cupAdminDialog.close();
});

cupStatsOpen.addEventListener("click", () => {
  renderIndividualStats();
  if (!cupStatsDialog.open) cupStatsDialog.showModal();
});

cupStatsClose.addEventListener("click", () => cupStatsDialog.close());
cupStatsDialog.addEventListener("click", (event) => {
  if (event.target === cupStatsDialog) cupStatsDialog.close();
});

groupEditor.addEventListener("change", (event) => {
  const field = event.target.closest("[data-fixture-field][data-group][data-index]");
  if (!field) return;
  state.fixtures[field.dataset.group][Number(field.dataset.index)][field.dataset.fixtureField] = field.value;
});

playoffEditor.addEventListener("change", (event) => {
  const field = event.target.closest("[data-playoff-field][data-stage][data-index]");
  if (!field) return;
  state.playoffs[field.dataset.stage][Number(field.dataset.index)][field.dataset.playoffField] = field.value;
});

cupAdminSave.addEventListener("click", () => {
  const entries = GROUPS.flatMap((group) => (state.fixtures[group] || []).map((fixture, index) => ({
    group,
    index,
    fixture
  })));
  const playoffEntries = PLAYOFFS.flatMap((stage) => (state.playoffs[stage.key] || []).map((fixture, index) => ({
    group: stage.title,
    index,
    fixture
  })));
  const allEntries = entries.concat(playoffEntries);
  const incomplete = allEntries.find(({ fixture }) => {
    const values = [fixture.date, fixture.home, fixture.away];
    return values.some(Boolean) && !values.every(Boolean);
  });
  if (incomplete) {
    cupAdminStatus.textContent = fixtureStageName(incomplete.group) + " " + (incomplete.index + 1) + "경기의 날짜와 양쪽 대학을 모두 선택해 주세요.";
    return;
  }
  const completed = allEntries.filter(({ fixture }) => fixture.date && fixture.home && fixture.away);
  if (!completed.length) {
    cupAdminStatus.textContent = "등록할 대전을 한 경기 이상 입력해 주세요.";
    return;
  }
  const sameUniversity = completed.find(({ fixture }) => fixture.home === fixture.away);
  if (sameUniversity) {
    cupAdminStatus.textContent = fixtureStageName(sameUniversity.group) + " " + (sameUniversity.index + 1) + "경기는 서로 다른 대학을 선택해 주세요.";
    return;
  }
  saveState();
  selectedMatch = null;
  renderGroups();
  renderPlayoffs();
  renderMatchPanel();
  cupAdminStatus.textContent = completed.length + "개 대전을 저장하고 화면에 반영했습니다.";
  cupAdminDialog.close();
});

cupAdminReset.addEventListener("click", () => {
  state = { fixtures: emptyFixtures(), playoffs: emptyPlayoffs(), matches: state.matches || {} };
  saveState();
  selectedMatch = null;
  renderGroupEditor();
  renderPlayoffEditor();
  renderGroups();
  renderPlayoffs();
  renderMatchPanel();
  cupAdminStatus.textContent = "등록된 날짜와 대학을 모두 초기화했습니다.";
});

renderGroups();
renderPlayoffs();
renderMatchPanel();
