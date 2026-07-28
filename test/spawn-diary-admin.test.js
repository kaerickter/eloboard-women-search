const assert = require("node:assert/strict");
const test = require("node:test");
const { SpawnDiaryAdmin } = require("../spawn-diary-admin");

function request(cookie = "", csrf = "") {
  return {
    headers: { cookie, "x-csrf-token": csrf },
    socket: { remoteAddress: "127.0.0.1" }
  };
}

test("스폰일지 전용 로그인은 브라우저 세션 쿠키를 사용한다", () => {
  const admin = new SpawnDiaryAdmin({ password: "1203", production: false });
  const login = admin.login(request(), "1203");
  assert.equal(login.status, 200);
  assert.match(login.cookie, /spawn_diary_admin_session=/);
  assert.doesNotMatch(login.cookie, /Max-Age|Expires/);
  const cookie = login.cookie.split(";")[0];
  assert.ok(admin.authorize(request(cookie, login.session.csrf)));
  const restartedAdmin = new SpawnDiaryAdmin({ password: "1203", production: false });
  assert.ok(restartedAdmin.authorize(request(cookie, login.session.csrf)));
});

test("작성 잠금은 동시에 한 세션만 얻을 수 있다", () => {
  const admin = new SpawnDiaryAdmin({ password: "1203", production: false });
  const loginA = admin.login(request(), "1203");
  const loginB = admin.login({ headers: { "x-forwarded-for": "127.0.0.2" }, socket: {} }, "1203");
  const sessionA = admin.session(request(loginA.cookie.split(";")[0]));
  const sessionB = admin.session(request(loginB.cookie.split(";")[0]));

  assert.equal(admin.acquireLock(sessionA).ok, true);
  assert.equal(admin.acquireLock(sessionB).busy, true);
  assert.equal(admin.releaseLock(sessionA).ok, true);
  assert.equal(admin.acquireLock(sessionB).ok, true);
});
