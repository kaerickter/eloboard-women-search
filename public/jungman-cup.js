const UNIVERSITIES = [
  "BGM", "DM", "HM", "JSA", "뉴캣슬", "수술대", "신세계",
  "씨나인", "엠비대", "와플대", "캄몬스타즈", "케이대", "흑카데미"
];
const GROUPS = ["A", "B", "C", "D"];
const STORAGE_KEY = "jungman-cup-preview-v2";
const PREVIOUS_STORAGE_KEY = "jungman-cup-preview-v1";

const groupGrid = document.getElementById("groupGrid");
const matchPanel = document.getElementById("matchPanel");
const cupAdminOpen = document.getElementById("cupAdminOpen");
const cupAdminDialog = document.getElementById("cupAdminDialog");
const cupAdminClose = document.getElementById("cupAdminClose");
const cupAdminLogin = document.getElementById("cupAdminLogin");
const cupAdminPassword = document.getElementById("cupAdminPassword");
const cupAdminManager = document.getElementById("cupAdminManager");
const cupAdminStatus = document.getElementById("cupAdminStatus");
const groupEditor = document.getElementById("groupEditor");
const cupAdminSave = document.getElementById("cupAdminSave");
const cupAdminReset = document.getElementById("cupAdminReset");

let authenticated = false;
let csrf = "";
let selectedMatch = null;
let state = readState();

function emptyFixtures() {
  return Object.fromEntries(GROUPS.map((group) => [
    group,
    Array.from({ length: 3 }, () => ({ date: "", home: "", away: "" }))
  ]));
}

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const previous = JSON.parse(localStorage.getItem(PREVIOUS_STORAGE_KEY) || "{}");
    return {
      fixtures: saved.fixtures && typeof saved.fixtures === "object" ? saved.fixtures : emptyFixtures(),
      matches: saved.matches && typeof saved.matches === "object"
        ? saved.matches
        : (previous.matches && typeof previous.matches === "object" ? previous.matches : {})
    };
  } catch {
    return { fixtures: emptyFixtures(), matches: {} };
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
  return value.replaceAll("-", ".") + " (" + weekday + ")";
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
      games: Array.from({ length: 9 }, () => ({ homePlayer: "", awayPlayer: "", winner: "" }))
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
      const disabled = !fixture.home || !fixture.away;
      return [
        '<div class="fixture">',
        '<button class="fixture-team" type="button" data-group="' + group + '" data-fixture="' + index +
          '"' + (disabled ? " disabled" : "") + ">" + escapeHtml(home) + "</button>",
        '<span class="fixture-vs"><b>' + (index + 1) + '경기 · VS</b><time>' + escapeHtml(fixtureDate) + "</time></span>",
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
    return [
      '<div class="set-row' + (closed ? " is-closed" : "") + '" data-game="' + index + '">',
      '<span class="set-number">' + (index + 1) + "SET</span>",
      '<input type="text" data-field="homePlayer" value="' + escapeHtml(game.homePlayer) +
        '" placeholder="' + escapeHtml(match.home) + ' 선수"' + (disabled ? " disabled" : "") + ">",
      '<div class="winner-controls" aria-label="' + (index + 1) + '세트 승자">',
      '<button type="button" data-winner="home" class="' + (game.winner === "home" ? "is-home" : "") +
        '" title="' + escapeHtml(match.home) + ' 승"' + (disabled ? " disabled" : "") + ">승</button>",
      '<button type="button" data-winner="away" class="' + (game.winner === "away" ? "is-away" : "") +
        '" title="' + escapeHtml(match.away) + ' 승"' + (disabled ? " disabled" : "") + ">승</button>",
      "</div>",
      '<input type="text" data-field="awayPlayer" value="' + escapeHtml(game.awayPlayer) +
        '" placeholder="' + escapeHtml(match.away) + ' 선수"' + (disabled ? " disabled" : "") + ">",
      "</div>"
    ].join("");
  }).join("");

  const resultText = score.home === 5 || score.away === 5
    ? (score.home === 5 ? match.home : match.away) + " 승리"
    : "9판 5선승 · 경기 전";

  matchPanel.innerHTML = [
    '<header class="match-sheet-head">',
    "<span>" + match.group + "조 MATCH RESULT · " +
      escapeHtml(formatGroupDate(match.fixtureDate)) + "</span>",
    '<div class="match-title"><strong>' + escapeHtml(match.home) + "</strong>",
    '<div class="match-score"><b>' + score.home + "</b><i>:</i><b>" + score.away + "</b></div>",
    "<strong>" + escapeHtml(match.away) + "</strong></div>",
    '<p class="match-sheet-note">' + escapeHtml(resultText) + "</p>",
    "</header>",
    '<div class="set-table">' + rows + "</div>",
    '<p class="result-lock-note">' +
      (authenticated ? "관리자 모드 · 선수명과 세트 승자를 입력할 수 있습니다." : "결과 입력은 관리자 로그인 후 사용할 수 있습니다.") +
      "</p>"
  ].join("");
}

function selectMatch(group, index) {
  const result = getMatch(group, index);
  if (!result) return;
  selectedMatch = result.key;
  renderMatchPanel();
  if (window.innerWidth < 1120) matchPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setAdminView(enabled) {
  authenticated = enabled;
  cupAdminLogin.hidden = enabled;
  cupAdminManager.hidden = !enabled;
  renderGroupEditor();
  renderMatchPanel();
}

function renderGroupEditor() {
  if (!authenticated) return;
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

async function checkAdminSession() {
  cupAdminStatus.textContent = "관리자 상태를 확인하고 있습니다.";
  try {
    const response = await fetch("/api/admin/status", { headers: { "Accept": "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "관리자 상태를 확인하지 못했습니다.");
    if (!data.configured) {
      setAdminView(false);
      cupAdminStatus.textContent = "관리자 비밀번호가 아직 설정되지 않았습니다.";
      cupAdminPassword.disabled = true;
      return;
    }
    cupAdminPassword.disabled = false;
    csrf = data.csrf || "";
    setAdminView(Boolean(data.authenticated));
    cupAdminStatus.textContent = data.authenticated
      ? "관리자 모드입니다. 대진과 경기 결과를 수정할 수 있습니다."
      : "관리자 비밀번호로 로그인해 주세요.";
  } catch (error) {
    setAdminView(false);
    cupAdminStatus.textContent = error.message;
  }
}

groupGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-group][data-fixture]");
  if (!button) return;
  selectMatch(button.dataset.group, Number(button.dataset.fixture));
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
  checkAdminSession();
});

cupAdminClose.addEventListener("click", () => cupAdminDialog.close());
cupAdminDialog.addEventListener("click", (event) => {
  if (event.target === cupAdminDialog) cupAdminDialog.close();
});

cupAdminLogin.addEventListener("submit", async (event) => {
  event.preventDefault();
  cupAdminStatus.textContent = "로그인하고 있습니다.";
  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ password: cupAdminPassword.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "로그인하지 못했습니다.");
    csrf = data.csrf || "";
    cupAdminPassword.value = "";
    setAdminView(true);
    cupAdminStatus.textContent = "로그인되었습니다. 조 편성을 등록해 주세요.";
  } catch (error) {
    cupAdminStatus.textContent = error.message;
  }
});

groupEditor.addEventListener("change", (event) => {
  const field = event.target.closest("[data-fixture-field][data-group][data-index]");
  if (!field) return;
  state.fixtures[field.dataset.group][Number(field.dataset.index)][field.dataset.fixtureField] = field.value;
});

cupAdminSave.addEventListener("click", () => {
  const incomplete = GROUPS.flatMap((group) => (state.fixtures[group] || []).map((fixture, index) => ({
    group,
    index,
    fixture
  }))).find(({ fixture }) => !fixture.date || !fixture.home || !fixture.away);
  if (incomplete) {
    cupAdminStatus.textContent = incomplete.group + "조 " + (incomplete.index + 1) + "경기의 날짜와 양쪽 대학을 모두 선택해 주세요.";
    return;
  }
  const sameUniversity = GROUPS.flatMap((group) => (state.fixtures[group] || []).map((fixture, index) => ({
    group,
    index,
    fixture
  }))).find(({ fixture }) => fixture.home === fixture.away);
  if (sameUniversity) {
    cupAdminStatus.textContent = sameUniversity.group + "조 " + (sameUniversity.index + 1) + "경기는 서로 다른 대학을 선택해 주세요.";
    return;
  }
  saveState();
  selectedMatch = null;
  renderGroups();
  renderMatchPanel();
  cupAdminStatus.textContent = "4개 조의 12개 대전 날짜와 대학을 저장했습니다.";
  cupAdminDialog.close();
});

cupAdminReset.addEventListener("click", () => {
  state = { fixtures: emptyFixtures(), matches: state.matches || {} };
  saveState();
  selectedMatch = null;
  renderGroupEditor();
  renderGroups();
  renderMatchPanel();
  cupAdminStatus.textContent = "등록된 날짜와 대학을 모두 초기화했습니다.";
});

renderGroups();
renderMatchPanel();
