const STORAGE_KEY = "eloboard.matchScoreboard.v1";
const DEFAULT_STATE = {
  title: "매치 카멜레온",
  players: 7,
  games: 9,
  names: Array(7).fill(""),
  scores: Array.from({ length: 7 }, () => Array(9).fill("")),
  comments: Array.from({ length: 7 }, () => Array(9).fill("")),
  assignedNumbers: null,
};

const titleInput = document.querySelector("#boardTitle");
const playerCount = document.querySelector("#playerCount");
const gameCount = document.querySelector("#gameCount");
const sizeSummary = document.querySelector("#sizeSummary");
const scoreHead = document.querySelector("#scoreHead");
const scoreBody = document.querySelector("#scoreBody");
const randomButton = document.querySelector("#randomButton");
const sortButton = document.querySelector("#sortButton");
const resetButton = document.querySelector("#resetButton");
const teamResult = document.querySelector("#teamResult");
const oddTotal = document.querySelector("#oddTotal");
const evenTotal = document.querySelector("#evenTotal");
const winnerText = document.querySelector("#winnerText");

let state = loadState();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function normalize(raw = {}) {
  const players = clamp(Number(raw.players ?? DEFAULT_STATE.players), 1, 30);
  const games = clamp(Number(raw.games ?? DEFAULT_STATE.games), 1, 20);
  return {
    title: String(raw.title ?? DEFAULT_STATE.title),
    players,
    games,
    names: Array.from({ length: players }, (_, row) => raw.names?.[row] ?? ""),
    scores: Array.from({ length: players }, (_, row) => Array.from({ length: games }, (_, col) => raw.scores?.[row]?.[col] ?? "")),
    comments: Array.from({ length: players }, (_, row) => Array.from({ length: games }, (_, col) => raw.comments?.[row]?.[col] ?? "")),
    assignedNumbers: Array.isArray(raw.assignedNumbers) && raw.assignedNumbers.length === players ? raw.assignedNumbers : null,
  };
}

function loadState() {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)) || DEFAULT_STATE); }
  catch { return normalize(DEFAULT_STATE); }
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function rowTotal(row) {
  return state.scores[row].reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function updateTotals() {
  const totals = Array.from({ length: state.players }, (_, row) => rowTotal(row));
  totals.forEach((total, row) => {
    const output = scoreBody.querySelector(`[data-total-row="${row}"]`);
    if (output) output.textContent = String(total);
  });

  if (!state.assignedNumbers) {
    teamResult.hidden = true;
    sortButton.hidden = true;
    return;
  }

  const odd = state.assignedNumbers.reduce((sum, number, row) => sum + (number % 2 ? totals[row] : 0), 0);
  const even = state.assignedNumbers.reduce((sum, number, row) => sum + (number % 2 ? 0 : totals[row]), 0);
  oddTotal.textContent = String(odd);
  evenTotal.textContent = String(even);
  winnerText.textContent = odd === even ? "무승부" : odd > even ? "홀수팀 승리" : "짝수팀 승리";
  teamResult.hidden = false;
  sortButton.hidden = false;
}

function render() {
  titleInput.value = state.title;
  playerCount.value = String(state.players);
  gameCount.value = String(state.games);
  sizeSummary.textContent = `${state.players} × ${state.games}`;
  randomButton.textContent = state.assignedNumbers ? "번호 다시 뽑기" : "랜덤 번호 지정";

  scoreHead.innerHTML = `<tr><th class="number-col">번호</th><th class="name-col">참여자</th>${Array.from({ length: state.games }, (_, game) => `<th>${game + 1}게임</th>`).join("")}<th class="total-col">합계</th></tr>`;
  scoreBody.innerHTML = "";

  for (let row = 0; row < state.players; row += 1) {
    const tr = document.createElement("tr");
    if (state.assignedNumbers) tr.className = state.assignedNumbers[row] % 2 ? "team-odd" : "team-even";

    const numberCell = document.createElement("td");
    numberCell.className = "number-col";
    numberCell.innerHTML = state.assignedNumbers ? `<span class="number-badge">${state.assignedNumbers[row]}</span>` : `<span class="waiting-number">대기</span>`;
    tr.append(numberCell);

    const nameCell = document.createElement("td");
    nameCell.className = "name-col";
    const name = document.createElement("input");
    name.lang = "ko";
    name.inputMode = "text";
    name.autocomplete = "off";
    name.autocapitalize = "none";
    name.spellcheck = false;
    name.value = state.names[row];
    name.placeholder = "이름";
    name.setAttribute("aria-label", `${row + 1}번째 참가자 이름`);
    name.addEventListener("input", event => { state.names[row] = event.target.value; saveState(); });
    nameCell.append(name);
    tr.append(nameCell);

    for (let col = 0; col < state.games; col += 1) {
      const cell = document.createElement("td");
      cell.className = "game-col";
      const entry = document.createElement("div");
      entry.className = "game-entry";
      const score = document.createElement("input");
      score.className = "score-input";
      score.inputMode = "numeric";
      score.placeholder = "점수";
      score.value = state.scores[row][col];
      score.setAttribute("aria-label", `${row + 1}번째 참가자 ${col + 1}게임 점수`);
      score.addEventListener("input", event => {
        if (event.target.value !== "" && !/^-?\d*$/.test(event.target.value)) {
          event.target.value = state.scores[row][col];
          return;
        }
        state.scores[row][col] = event.target.value;
        updateTotals();
        saveState();
      });
      const comment = document.createElement("input");
      comment.className = "comment-input";
      comment.placeholder = "코멘트";
      comment.value = state.comments[row][col];
      comment.setAttribute("aria-label", `${row + 1}번째 참가자 ${col + 1}게임 코멘트`);
      comment.addEventListener("input", event => { state.comments[row][col] = event.target.value; saveState(); });
      entry.append(score, comment);
      cell.append(entry);
      tr.append(cell);
    }

    const total = document.createElement("td");
    total.className = "total-col";
    total.dataset.totalRow = String(row);
    tr.append(total);
    scoreBody.append(tr);
  }

  updateTotals();
  saveState();
}

function resize(key, rawValue) {
  const value = clamp(Number(rawValue), 1, key === "players" ? 30 : 20);
  const players = key === "players" ? value : state.players;
  const games = key === "games" ? value : state.games;
  state = {
    ...state,
    [key]: value,
    names: Array.from({ length: players }, (_, row) => state.names[row] ?? ""),
    scores: Array.from({ length: players }, (_, row) => Array.from({ length: games }, (_, col) => state.scores[row]?.[col] ?? "")),
    comments: Array.from({ length: players }, (_, row) => Array.from({ length: games }, (_, col) => state.comments[row]?.[col] ?? "")),
    assignedNumbers: key === "players" ? null : state.assignedNumbers,
  };
  render();
}

function assignRandomNumbers() {
  const numbers = Array.from({ length: state.players }, (_, index) => index + 1);
  for (let index = numbers.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [numbers[index], numbers[target]] = [numbers[target], numbers[index]];
  }
  state.assignedNumbers = numbers;
  render();
}

function sortByNumber() {
  if (!state.assignedNumbers) return;
  const order = state.assignedNumbers.map((number, index) => ({ number, index })).sort((a, b) => a.number - b.number);
  state = {
    ...state,
    assignedNumbers: order.map(item => item.number),
    names: order.map(item => state.names[item.index]),
    scores: order.map(item => state.scores[item.index]),
    comments: order.map(item => state.comments[item.index]),
  };
  render();
}

titleInput.addEventListener("input", event => { state.title = event.target.value; saveState(); });
playerCount.addEventListener("change", event => resize("players", event.target.value));
gameCount.addEventListener("change", event => resize("games", event.target.value));
randomButton.addEventListener("click", assignRandomNumbers);
sortButton.addEventListener("click", sortByNumber);
resetButton.addEventListener("click", () => {
  if (!window.confirm("입력한 이름, 점수, 코멘트를 모두 지울까요?")) return;
  state = {
    ...state,
    names: Array(state.players).fill(""),
    scores: Array.from({ length: state.players }, () => Array(state.games).fill("")),
    comments: Array.from({ length: state.players }, () => Array(state.games).fill("")),
    assignedNumbers: null,
  };
  render();
});

render();
