const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { io } = require("socket.io-client");

const PORT = 5189;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

function emit(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} 응답 시간 초과`)), 3000);
    socket.emit(event, payload, response => { clearTimeout(timer); resolve(response); });
  });
}
function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, { transports: ["websocket"], forceNew: true });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}
function nextEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} 이벤트 시간 초과`)), 3000);
    socket.once(event, payload => { clearTimeout(timer); resolve(payload); });
  });
}

test.before(async () => {
  server = spawn(process.execPath, ["server.js"], {
    cwd: require("node:path").join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), ROOM_DATA_FILE: require("node:path").join(__dirname, "..", "work", "test-rooms.json") },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("테스트 서버 시작 시간 초과")), 5000);
    server.stdout.on("data", chunk => {
      if (String(chunk).includes("http://localhost:" + PORT)) { clearTimeout(timer); resolve(); }
    });
    server.once("exit", code => reject(new Error("테스트 서버 종료: " + code)));
  });
});

test.after(() => { server?.kill(); });

test("점수판 방 생성, 필드 동기화, 최신 상태 참여, 초기화", async () => {
  const first = await connect();
  const second = await connect();
  const third = await connect();
  try {
    const created = await emit(first, "room:create", { feature: "scoreboard", state: { title: "테스트", players: 2, games: 1, names: ["", ""], scores: [[""], [""]], comments: [[""], [""]], assignedNumbers: null } });
    assert.equal(created.ok, true);
    assert.match(created.code, /^[A-HJ-NP-Z2-9]{6}$/);
    const joined = await emit(second, "room:join", { feature: "scoreboard", code: created.code });
    assert.equal(joined.state.title, "테스트");

    const remotePatch = nextEvent(second, "room:patch");
    const patchResult = await emit(first, "room:patch", { feature: "scoreboard", code: created.code, clientId: "first", opId: "one", path: "names.0", kind: "set", value: "공동편집" });
    assert.equal(patchResult.ok, true);
    assert.equal((await remotePatch).state.names[0], "공동편집");

    const latest = await emit(third, "room:join", { feature: "scoreboard", code: created.code });
    assert.equal(latest.state.names[0], "공동편집");

    const resetEvent = nextEvent(second, "room:snapshot");
    assert.equal((await emit(first, "room:reset", { feature: "scoreboard", code: created.code })).ok, true);
    const reset = await resetEvent;
    assert.equal(reset.reset, true);
    assert.equal(reset.state.names[0], "");
  } finally { first.close(); second.close(); third.close(); }
});

test("킬 증감은 동시에 실행되어도 합산되고 기능별 방은 분리됨", async () => {
  const first = await connect();
  const second = await connect();
  try {
    const created = await emit(first, "room:create", { feature: "kill-bet", state: { chickenKillValue: 1, panels: { "4명-0": { team: "A", chicken: 0, rows: [{ name: "", score: 0, fail: 0 }, {}, {}, {}] } } } });
    await emit(second, "room:join", { feature: "kill-bet", code: created.code });
    await Promise.all([
      emit(first, "room:patch", { feature: "kill-bet", code: created.code, clientId: "first", opId: "inc1", path: "panels.4명-0.rows.0.score", kind: "increment", delta: 1 }),
      emit(second, "room:patch", { feature: "kill-bet", code: created.code, clientId: "second", opId: "inc2", path: "panels.4명-0.rows.0.score", kind: "increment", delta: 1 })
    ]);
    const latest = await emit(first, "room:join", { feature: "kill-bet", code: created.code });
    assert.equal(latest.state.panels["4명-0"].rows[0].score, 2);
    const wrongFeature = await emit(second, "room:join", { feature: "bingo", code: created.code });
    assert.equal(wrongFeature.ok, false);
  } finally { first.close(); second.close(); }
});
