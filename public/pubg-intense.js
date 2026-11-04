(() => {
  "use strict";
  const STORAGE_KEY = "eloboard.pubgIntense.v1";
  const MAX_TEAMS = 6;
  const MAX_MEMBERS = 8;
  const MAX_GAMES = 20;
  const byId = id => document.getElementById(id);
  const titleInput = byId("boardTitle");
  const teamSizeInput = byId("teamSize");
  const teamCountInput = byId("teamCount");
  const gameCountInput = byId("gameCount");
  const sizeSummary = byId("sizeSummary");
  const scoreHead = byId("scoreHead");
  const scoreBody = byId("scoreBody");
  const teamCards = byId("teamCards");
  const table = document.querySelector(".game-table");
  let room = null;

  function integer(value, min, max, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
  }
  function normalize(raw = {}) {
    return {
      title: String(raw.title ?? "배그 인텐스모드").slice(0, 40),
      teamSize: integer(raw.teamSize, 1, MAX_MEMBERS, 4),
      teamCount: integer(raw.teamCount, 2, MAX_TEAMS, 4),
      games: integer(raw.games, 1, MAX_GAMES, 10),
      teamNames: Array.from({ length: MAX_TEAMS }, (_, team) => String(raw.teamNames?.[team] ?? `${team + 1}팀`).slice(0, 24)),
      memberNames: Array.from({ length: MAX_TEAMS }, (_, team) =>
        Array.from({ length: MAX_MEMBERS }, (_, member) => String(raw.memberNames?.[team]?.[member] ?? "").slice(0, 24))),
      scores: Array.from({ length: MAX_TEAMS }, (_, team) =>
        Array.from({ length: MAX_GAMES }, (_, game) => String(raw.scores?.[team]?.[game] ?? "").slice(0, 12))),
      comments: Array.from({ length: MAX_TEAMS }, (_, team) =>
        Array.from({ length: MAX_GAMES }, (_, game) => String(raw.comments?.[team]?.[game] ?? "").slice(0, 80))),
      kills: Array.from({ length: MAX_TEAMS }, (_, team) =>
        Array.from({ length: MAX_MEMBERS }, (_, member) => integer(raw.kills?.[team]?.[member], -9999, 9999, 0))),
      fails: Array.from({ length: MAX_TEAMS }, (_, team) =>
        Array.from({ length: MAX_MEMBERS }, (_, member) => integer(raw.fails?.[team]?.[member], -9999, 0, 0)))
    };
  }
  function load() {
    try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}); }
    catch { return normalize(); }
  }
  let state = load();
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} }
  function scoreTotal(team) {
    return state.scores[team].slice(0, state.games).reduce((sum, score) => sum + (Number(score) || 0), 0);
  }
  function killTotal(team) {
    return state.kills[team].slice(0, state.teamSize).reduce((sum, kills, member) =>
      sum + kills + state.fails[team][member], 0);
  }
  function refreshTotals() {
    for (let team = 0; team < state.teamCount; team += 1) {
      const score = String(scoreTotal(team));
      const kills = String(killTotal(team));
      const tableTotal = scoreBody.querySelector(`[data-score-total="${team}"]`);
      const cardScore = teamCards.querySelector(`[data-card-score="${team}"]`);
      const cardKills = teamCards.querySelector(`[data-card-kills="${team}"]`);
      if (tableTotal) tableTotal.textContent = score;
      if (cardScore) cardScore.textContent = score;
      if (cardKills) cardKills.textContent = kills;
    }
  }
  function makeInput(className, value, label, path, onInput) {
    const input = document.createElement("input");
    input.className = className;
    input.value = value;
    input.setAttribute("aria-label", label);
    input.autocomplete = "off";
    input.spellcheck = false;
    input.dataset.collabPath = path;
    input.addEventListener("input", onInput);
    return input;
  }
  function renderTable() {
    table.style.minWidth = `${150 + state.games * 96 + 88}px`;
    scoreHead.replaceChildren();
    const header = document.createElement("tr");
    const nameHead = document.createElement("th");
    nameHead.className = "team-name-cell";
    nameHead.textContent = "참가팀";
    header.append(nameHead);
    for (let game = 0; game < state.games; game += 1) {
      const cell = document.createElement("th");
      cell.className = "game-cell";
      cell.textContent = `${game + 1}게임`;
      header.append(cell);
    }
    const totalHead = document.createElement("th");
    totalHead.className = "total-head";
    totalHead.textContent = "합계";
    header.append(totalHead);
    scoreHead.append(header);
    scoreBody.replaceChildren();
    for (let team = 0; team < state.teamCount; team += 1) {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.className = "team-name-cell";
      name.dataset.tableName = String(team);
      name.textContent = state.teamNames[team] || `${team + 1}팀`;
      row.append(name);
      for (let game = 0; game < state.games; game += 1) {
        const cell = document.createElement("td");
        cell.className = "game-cell";
        const entry = document.createElement("div");
        entry.className = "score-entry";
        const score = makeInput("score-input", state.scores[team][game],
          `${team + 1}팀 ${game + 1}게임 점수`, `scores.${team}.${game}`, event => {
            const value = event.target.value;
            if (value !== "" && !/^-?\d*$/.test(value)) {
              event.target.value = state.scores[team][game];
              return;
            }
            state.scores[team][game] = value;
            room?.sendSet(`scores.${team}.${game}`, value);
            refreshTotals();
            save();
          });
        score.placeholder = "0";
        score.inputMode = "numeric";
        const comment = makeInput("comment-input", state.comments[team][game],
          `${team + 1}팀 ${game + 1}게임 코멘트`, `comments.${team}.${game}`, event => {
            state.comments[team][game] = event.target.value;
            room?.sendSet(`comments.${team}.${game}`, event.target.value);
            save();
          });
        comment.placeholder = "코멘트";
        entry.append(score, comment);
        cell.append(entry);
        row.append(cell);
      }
      const total = document.createElement("td");
      total.className = "total-cell";
      total.dataset.scoreTotal = String(team);
      row.append(total);
      scoreBody.append(row);
    }
  }
  function changeKill(team, member, kind, delta) {
    const current = state[kind][team][member];
    state[kind][team][member] = integer(current + delta, kind === "fails" ? -9999 : -9999, kind === "fails" ? 0 : 9999, 0);
    room?.increment(`${kind}.${team}.${member}`, delta);
    save();
    const row = teamCards.querySelector(`[data-member-row="${team}-${member}"]`);
    if (row) {
      row.querySelector(".member-kills").textContent = String(state.kills[team][member] + state.fails[team][member]);
      row.querySelector(".cancel").disabled = state.fails[team][member] >= 0;
      row.querySelector(".fail").classList.toggle("has-fails", state.fails[team][member] < 0);
    }
    refreshTotals();
  }
  function action(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }
  function renderCards() {
    teamCards.replaceChildren();
    teamCards.classList.toggle("three-columns", state.teamCount >= 5);
    teamCards.classList.toggle("two-columns", state.teamCount === 2);
    for (let team = 0; team < state.teamCount; team += 1) {
      const card = document.createElement("article");
      card.className = "team-card";
      const head = document.createElement("div");
      head.className = "team-card-head";
      const teamName = makeInput("team-name-input", state.teamNames[team], `${team + 1}팀 팀명`,
        `teamNames.${team}`, event => {
          state.teamNames[team] = event.target.value;
          const tableName = scoreBody.querySelector(`[data-table-name="${team}"]`);
          if (tableName) tableName.textContent = event.target.value || `${team + 1}팀`;
          room?.sendSet(`teamNames.${team}`, event.target.value);
          save();
        });
      const index = document.createElement("span");
      index.className = "team-index";
      index.textContent = `${team + 1}팀`;
      head.append(teamName, index);
      const totals = document.createElement("div");
      totals.className = "team-totals";
      totals.innerHTML = `<div><span>합계점수</span><strong data-card-score="${team}">0</strong></div><div><span>팀 킬수</span><strong data-card-kills="${team}">0</strong></div>`;
      const list = document.createElement("div");
      list.className = "member-list";
      for (let member = 0; member < state.teamSize; member += 1) {
        const row = document.createElement("div");
        row.className = "member-row";
        row.dataset.memberRow = `${team}-${member}`;
        const memberName = makeInput("member-name-input", state.memberNames[team][member],
          `${team + 1}팀 ${member + 1}번째 팀원 이름`, `memberNames.${team}.${member}`, event => {
            state.memberNames[team][member] = event.target.value;
            room?.sendSet(`memberNames.${team}.${member}`, event.target.value);
            save();
          });
        memberName.placeholder = `${member + 1}번 팀원`;
        const count = document.createElement("output");
        count.className = "member-kills";
        count.textContent = String(state.kills[team][member] + state.fails[team][member]);
        const minus = action("−", "minus", () => changeKill(team, member, "kills", -1));
        const plus = action("+", "plus", () => changeKill(team, member, "kills", 1));
        const fail = action("실패", "fail", () => changeKill(team, member, "fails", -1));
        fail.classList.toggle("has-fails", state.fails[team][member] < 0);
        const cancel = action("취소", "cancel", () => {
          if (state.fails[team][member] < 0) changeKill(team, member, "fails", 1);
        });
        cancel.disabled = state.fails[team][member] >= 0;
        row.append(memberName, count, minus, plus, fail, cancel);
        list.append(row);
      }
      card.append(head, totals, list);
      teamCards.append(card);
    }
  }
  function render() {
    titleInput.value = state.title;
    teamSizeInput.value = String(state.teamSize);
    teamCountInput.value = String(state.teamCount);
    gameCountInput.value = String(state.games);
    sizeSummary.textContent = `${state.teamSize}명 × ${state.teamCount}팀 · ${state.games}게임`;
    renderTable();
    renderCards();
    refreshTotals();
    save();
  }
  function configure(key, input, min, max) {
    input.addEventListener("change", () => {
      const value = integer(input.value, min, max, state[key]);
      if (value === state[key]) { input.value = String(value); return; }
      state[key] = value;
      room?.sendSet(key, value, 0);
      render();
    });
  }
  titleInput.dataset.collabPath = "title";
  titleInput.addEventListener("input", event => {
    state.title = event.target.value;
    room?.sendSet("title", state.title);
    save();
  });
  configure("teamSize", teamSizeInput, 1, MAX_MEMBERS);
  configure("teamCount", teamCountInput, 2, MAX_TEAMS);
  configure("games", gameCountInput, 1, MAX_GAMES);
  render();
  room = new RealtimeRoom({
    feature: "pubg-intense",
    getState: () => state,
    applyState: next => {
      state = normalize(next);
      RealtimeRoom.preserveFocus(render);
    }
  });
})();
