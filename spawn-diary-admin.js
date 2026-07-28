"use strict";

const crypto = require("node:crypto");

const SESSION_COOKIE = "spawn_diary_admin_session";
const SESSION_MS = 24 * 60 * 60 * 1000;
const LOCK_MS = 2 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPTS = 6;

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req?.headers?.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function safePasswordEqual(actual, expected) {
  const actualHash = crypto.createHash("sha256").update(String(actual || "")).digest();
  const expectedHash = crypto.createHash("sha256").update(String(expected || "")).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

class SpawnDiaryAdmin {
  constructor(options = {}) {
    this.password = options.password ?? process.env.SPAWN_DIARY_ADMIN_PASSWORD ?? "";
    this.production = options.production ?? process.env.NODE_ENV === "production";
    this.loginAttempts = new Map();
    this.lock = null;
  }

  get configured() {
    return Boolean(this.password);
  }

  login(req, password) {
    if (!this.configured) {
      return { status: 503, error: "스폰일지 관리자 비밀번호가 설정되지 않았습니다." };
    }
    const key = String(req?.headers?.["x-forwarded-for"] || req?.socket?.remoteAddress || "unknown")
      .split(",")[0].trim();
    const now = Date.now();
    const attempt = this.loginAttempts.get(key);
    if (attempt && attempt.resetAt > now && attempt.count >= LOGIN_ATTEMPTS) {
      return { status: 429, error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요." };
    }
    if (!safePasswordEqual(password, this.password)) {
      const current = attempt && attempt.resetAt > now
        ? attempt
        : { count: 0, resetAt: now + LOGIN_WINDOW_MS };
      current.count += 1;
      this.loginAttempts.set(key, current);
      return { status: 401, error: "스폰일지 관리자 비밀번호가 올바르지 않습니다." };
    }
    this.loginAttempts.delete(key);
    const token = crypto.randomBytes(32).toString("base64url");
    const session = {
      token,
      csrf: crypto.randomBytes(24).toString("base64url"),
      expiresAt: now + SESSION_MS
    };
    return { status: 200, session, cookie: this.sessionCookie(this.signSession(session)) };
  }

  session(req) {
    const signedSession = parseCookies(req)[SESSION_COOKIE];
    if (!signedSession || !this.configured) return null;
    const [payload, signature] = signedSession.split(".");
    if (!payload || !signature) return null;
    const expected = crypto.createHmac("sha256", this.password).update(payload).digest("base64url");
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
    try {
      const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (!session.token || !session.csrf || Number(session.expiresAt) <= Date.now()) return null;
      return session;
    } catch {
      return null;
    }
  }

  authorize(req) {
    const session = this.session(req);
    const csrf = String(req?.headers?.["x-csrf-token"] || "");
    if (!session || !csrf || csrf !== session.csrf) return null;
    return session;
  }

  acquireLock(session) {
    const now = Date.now();
    if (this.lock && this.lock.expiresAt <= now) this.lock = null;
    if (this.lock && this.lock.token !== session.token) {
      return { ok: false, busy: true, retryAfterSeconds: Math.max(1, Math.ceil((this.lock.expiresAt - now) / 1000)) };
    }
    this.lock = { token: session.token, expiresAt: now + LOCK_MS };
    return { ok: true, busy: false, expiresAt: this.lock.expiresAt };
  }

  heartbeatLock(session) {
    if (!this.holdsLock(session)) return { ok: false, busy: true };
    this.lock.expiresAt = Date.now() + LOCK_MS;
    return { ok: true, busy: false, expiresAt: this.lock.expiresAt };
  }

  releaseLock(session) {
    if (this.lock?.token === session.token) this.lock = null;
    return { ok: true, busy: false };
  }

  holdsLock(session) {
    if (!session || !this.lock) return false;
    if (this.lock.expiresAt <= Date.now()) {
      this.lock = null;
      return false;
    }
    return this.lock.token === session.token;
  }

  signSession(session) {
    const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
    const signature = crypto.createHmac("sha256", this.password).update(payload).digest("base64url");
    return payload + "." + signature;
  }

  sessionCookie(signedSession) {
    const secure = this.production ? "; Secure" : "";
    return `${SESSION_COOKIE}=${encodeURIComponent(signedSession)}; Path=/; HttpOnly; SameSite=Strict${secure}`;
  }
}

module.exports = { SpawnDiaryAdmin };
