const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("스폰일지 탭과 Neon 조회 API가 연결되어 있다", () => {
  const html = fs.readFileSync(path.join(root, "public", "spawn-diary.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "public", "spawn-diary.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

  assert.match(html, /href="\.\/tiers\.html">티어표<\/a>\s*<a class="site-tab active" href="\.\/spawn-diary\.html"/);
  assert.match(script, /fetch\("\/api\/spawn-diary"\)/);
  assert.match(script, /\/api\/admin\/spawn-diary/);
  assert.match(script, /fetch\("\/api\/spawn-diary-admin\/login"/);
  assert.match(script, /fetch\("\/api\/spawn-diary-admin\/lock"/);
  assert.match(script, /showPicker/);
  assert.match(script, /playerTierSnapshot/);
  assert.match(script, /method: editingId \? "PUT" : "POST"/);
  assert.match(script, /method: "DELETE"/);
  assert.match(script, /class="date-edit-button"/);
  assert.match(script, /class="race-pill/);
  assert.match(script, /coloredPill\("tier"/);
  assert.match(script, /coloredPill\("map"/);
  assert.match(script, /const PAGE_SIZE = 50/);
  assert.match(server, /FROM spawn_diary_entries/);
  assert.match(server, /ORDER BY match_date DESC NULLS LAST/);
  assert.match(server, /spawnDiaryAdmin\.authorize\(req\)/);
  assert.match(server, /INSERT INTO spawn_diary_entries/);
  assert.match(server, /UPDATE spawn_diary_entries/);
  assert.match(server, /DELETE FROM spawn_diary_entries/);
  assert.match(html, /id="recordOpenButton"/);
  assert.match(html, /<option value="스폰">스폰<\/option>/);
  assert.match(html, /<option value="CK">CK<\/option>/);
  assert.match(html, /<option value="대학대전">대학대전<\/option>/);
  assert.match(html, /id="recordOpponentSuggestions"/);
});

test("기존 주요 페이지에서 스폰일지가 티어표 바로 다음에 보인다", () => {
  const pages = [
    "tiers.html", "index.html", "matchup.html", "university-matchup.html",
    "bingo-board.html", "kill-bet.html", "scoreboard.html", "lucky-roulette.html",
    "live-vote.html", "men-records.html", "jungman-cup.html"
  ];

  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, "public", page), "utf8");
    const tierIndex = html.indexOf('href="./tiers.html"');
    const diaryIndex = html.indexOf('href="./spawn-diary.html"');
    const searchIndex = html.indexOf('href="./index.html"');
    assert.ok(tierIndex >= 0 && tierIndex < diaryIndex && diaryIndex < searchIndex, page);
  }
});
