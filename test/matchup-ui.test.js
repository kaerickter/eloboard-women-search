const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function renderMode(mode, rows) {
  const elements = new Map();
  const makeElement = () => ({
    hidden: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    style: {},
    className: "",
    classList: { toggle() {} },
    addEventListener() {},
    querySelectorAll() { return []; }
  });
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    querySelectorAll() { return []; }
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "matchup.js"), "utf8");
  const definitions = source.slice(0, source.indexOf('byId("resetPairs")'));
  const context = vm.createContext({ document, fetch: async () => { throw new Error("unexpected fetch"); } });
  vm.runInContext(definitions + `
    state.mode = ${JSON.stringify(mode)};
    state.mains = ["이아깽"];
    state.opponents = ["오리꿍", "비재희"];
    state.lastPairs = ${mode === "group" ? '[{ main: "이아깽", opponent: "오리꿍" }]' : "[]"};
    state.rows = ${JSON.stringify(rows)};
    renderResults();
  `, context);
  return elements.get("recordRows").innerHTML;
}

const row = (main, opponent, wins, losses) => ({
  main,
  opponent,
  total: [wins, losses],
  recent: [Math.min(wins, 2), Math.min(losses, 1)],
  lastPlayed: "2026-07-20",
  maps: [{ result: "승", date: "2026-07-20", map: "투혼" }]
});

test("1:1, 1:다수, 다수:다수 결과가 남성전적형 대결 카드로 렌더링됨", () => {
  const one = renderMode("one", [row("이아깽", "오리꿍", 7, 3)]);
  const many = renderMode("many", [row("이아깽", "오리꿍", 7, 3), row("이아깽", "비재희", 4, 6)]);
  const group = renderMode("group", [row("이아깽", "오리꿍", 7, 3)]);

  for (const html of [one, many, group]) {
    assert.match(html, /men-duel-card matchup-duel-card/);
    assert.match(html, /duel-stage/);
    assert.match(html, /duel-score-one/);
    assert.match(html, /duel-score-two/);
    assert.match(html, /duel-center/);
    assert.match(html, /duel-recent/);
    assert.match(html, /최근 90일/);
    assert.match(html, /duel-record-meta/);
    assert.match(html, /상세 보기/);
  }
  assert.equal((many.match(/matchup-duel-card/g) || []).length, 2);
  assert.match(group, /이아깽/);
  assert.match(group, /오리꿍/);
});
