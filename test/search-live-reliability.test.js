const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("전적검색은 이전 요청을 취소하고 최신 요청만 렌더링한다", () => {
  const source = read(path.join("public", "app.js"));

  assert.match(source, /state\.activeController\.abort\(\)/);
  assert.match(source, /requestId !== state\.requestId/);
  assert.match(source, /expectedRequestId !== state\.requestId/);
  assert.match(source, /fetchSearchJson/);
  assert.match(source, /validateSearchResponse/);
  assert.match(source, /setSearchState\("empty"/);
  assert.match(source, /setSearchState\("error"/);
  assert.match(source, /url\.protocol === "http:" \|\| url\.protocol === "https:"/);
  assert.match(source, /resetResultPanels\(errorMessage\)/);
  assert.match(source, /검색 서버에 연결할 수 없습니다/);
});

test("검색 API는 제한 병렬 조회, 요청 합치기, 캐시 대체 응답을 사용한다", () => {
  const source = read("server.js");

  assert.match(source, /dataPromises\.has\(promiseKey\)/);
  assert.match(source, /mapConcurrent\(remainingPages, 6, fetchBoardPage\)/);
  assert.match(source, /mapConcurrent\(remainingPages, 6, fetchBjListPage\)/);
  assert.match(source, /return \{ \.\.\.cached\.data, stale: true \}/);
  assert.match(source, /searchPlayerCandidates\(query\)/);
  assert.match(source, /resultState: query \? \(profile \? "found" : "empty"\)/);
});

test("LIVE 상태는 서버 캐시와 15초 폴링을 사용하고 변경 때만 다시 그린다", () => {
  const client = read(path.join("public", "tiers.js"));
  const server = read("server.js");

  assert.match(client, /LIVE_POLL_MS = 15000/);
  assert.match(client, /scheduleLivePoll\(\)/);
  assert.match(client, /if \(changed\) render\(\)/);
  assert.match(client, /if \(force\) params\.set\("refresh", "1"\)/);
  assert.match(client, /safeExternalUrl\(live\?\.broadcastUrl \|\| player\.profileUrl\)/);
  assert.doesNotMatch(client, /live-status\?refresh=1&names=/);
  assert.match(server, /LIVE_CACHE_MS = 1000 \* 15/);
  assert.match(server, /liveStatusPromises\.has\(key\)/);
  assert.match(server, /mapConcurrent\(prioritizedNames, 24/);
});

test("사용자가 검증한 LIVE 방송 ID를 고정 별칭과 채널 캐시에 동일하게 유지한다", () => {
  const aliases = JSON.parse(read(path.join("data", "soop-aliases.json")));
  const channels = JSON.parse(read(path.join("data", "soop-channels.json")));
  const verified = {
    "나무늘봉순": "yjk011599",
    "기나": "rlsk0705",
    "뚜미": "eeceec",
    "꼬니부깅": "kitty1029",
    "몽순": "totlllsz",
    "조은": "zalalz",
    "김설": "rnfma14",
    "밍가": "tato1104",
    "경콩": "rudzhd123",
    "단비송": "thdeksql",
    "김바다": "littlekim12",
    "온도이": "ode0411",
    "묘묘묫": "miiing0620",
    "사사삼": "bangsong12",
    "아라미": "aram1213",
    "우리밍": "kmj05317",
    "유녜": "ktulsun00",
    "으냉이": "rhakdncjs90",
  };

  for (const [name, broadcastId] of Object.entries(verified)) {
    assert.equal(channels[name], broadcastId, `${name} 채널 캐시`);
    assert.equal(aliases[name]?.broadcastId, broadcastId, `${name} 고정 별칭`);
  }
  assert.equal(new Set(Object.values(verified)).size, Object.keys(verified).length);
});
