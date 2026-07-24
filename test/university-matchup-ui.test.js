const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("대학대결 선수 조합이 사진 없는 이름 강조 대결 카드로 렌더링됨", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "university-matchup.js"), "utf8");
  const definitions = source.slice(0, source.indexOf('["A", "B"]'));
  const context = vm.createContext({ document: { getElementById() { return {}; } } });
  vm.runInContext(definitions + `
    globalThis.card = renderPair({
      tier: "1",
      playerA: { name: "선수 에이" },
      playerB: { name: "선수 비" },
      total: [8, 5],
      recent: [3, 2],
      lastPlayed: "2026.07.20"
    }, "대학 A", "대학 B");
  `, context);

  assert.match(context.card, /university-duel-card/);
  assert.match(context.card, /university-player-name/);
  assert.match(context.card, /선수 에이/);
  assert.match(context.card, /선수 비/);
  assert.match(context.card, /최근 90일/);
  assert.doesNotMatch(context.card, /<img/);
});
