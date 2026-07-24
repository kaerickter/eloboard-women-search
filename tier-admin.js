"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const SESSION_COOKIE = "tier_admin_session";
const SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPTS = 5;

function playerKey(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function normalizeUniversities(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source
    .map((value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 40))
    .filter((value) => value && value !== "FA" && value !== "연합팀"))]
    .slice(0, 8);
}

function normalizeTier(value) {
  const tier = String(value ?? "").trim().toUpperCase();
  return /^(?:[0-9]|FA)$/.test(tier) ? tier : "";
}

function normalizeRace(value) {
  const race = String(value ?? "").trim().toUpperCase();
  return /^(?:T|P|Z)$/.test(race) ? race : "";
}

function normalizeBroadcastId(value) {
  const broadcastId = String(value ?? "").trim();
  return /^[a-z0-9_-]{2,40}$/i.test(broadcastId) ? broadcastId : "";
}

function soopProfileImage(broadcastId) {
  if (!broadcastId) return "";
  return "https://profile.img.sooplive.co.kr/LOGO/" +
    encodeURIComponent(broadcastId.slice(0, 2).toLowerCase()) + "/" +
    encodeURIComponent(broadcastId) + "/" + encodeURIComponent(broadcastId) + ".jpg";
}

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

class TierAdmin {
  constructor(options = {}) {
    this.password = options.password ?? process.env.TIER_ADMIN_PASSWORD ?? "";
    this.filePath = options.filePath || process.env.TIER_OVERRIDE_FILE ||
      path.join(__dirname, "data", "tier-university-overrides.json");
    const databaseUrl = options.databaseUrl ??
      process.env.TIER_ADMIN_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "";
    this.production = options.production ?? process.env.NODE_ENV === "production";
    const durableSetting = String(process.env.TIER_ADMIN_REQUIRE_DATABASE || "").trim().toLowerCase();
    this.requireDurable = options.requireDurable ??
      (durableSetting ? !["0", "false", "no"].includes(durableSetting) : this.production);
    this.pool = options.pool || (databaseUrl
      ? new Pool({
          connectionString: databaseUrl,
          ssl: this.production ? { rejectUnauthorized: false } : undefined,
          max: 2
        })
      : null);
    this.overrides = new Map();
    this.sessions = new Map();
    this.loginAttempts = new Map();
    this.fileWrite = Promise.resolve();
  }

  get configured() {
    return Boolean(this.password);
  }

  get storageStatus() {
    return {
      mode: this.pool ? "postgresql" : "local-file",
      durable: Boolean(this.pool) || !this.production,
      message: this.pool
        ? "PostgreSQL에 영구 저장됩니다."
        : (this.production
          ? "영구 저장소가 연결되지 않았습니다. Render에 DATABASE_URL을 연결해 주세요."
          : "로컬 JSON 파일에 저장됩니다.")
    };
  }

  assertWritableStorage() {
    if (!this.requireDurable || this.pool) return;
    const error = new Error(
      "영구 저장소가 연결되지 않아 변경하지 않았습니다. Render Environment의 DATABASE_URL에 PostgreSQL을 연결해 주세요."
    );
    error.statusCode = 503;
    error.code = "DURABLE_STORAGE_REQUIRED";
    throw error;
  }

  async init() {
    if (this.pool) {
      await this.pool.query(`CREATE TABLE IF NOT EXISTS tier_university_overrides (
        player_key TEXT PRIMARY KEY,
        player_name TEXT NOT NULL,
        universities JSONB NOT NULL,
        tier TEXT,
        promotion_light BOOLEAN NOT NULL DEFAULT FALSE,
        is_custom BOOLEAN NOT NULL DEFAULT FALSE,
        race TEXT,
        broadcast_id TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await this.pool.query("ALTER TABLE tier_university_overrides ADD COLUMN IF NOT EXISTS tier TEXT");
      await this.pool.query(
        "ALTER TABLE tier_university_overrides ADD COLUMN IF NOT EXISTS promotion_light BOOLEAN NOT NULL DEFAULT FALSE"
      );
      await this.pool.query(
        "ALTER TABLE tier_university_overrides ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE"
      );
      await this.pool.query("ALTER TABLE tier_university_overrides ADD COLUMN IF NOT EXISTS race TEXT");
      await this.pool.query("ALTER TABLE tier_university_overrides ADD COLUMN IF NOT EXISTS broadcast_id TEXT");
      const result = await this.pool.query(
        `SELECT player_key, player_name, universities, tier, promotion_light,
          is_custom, race, broadcast_id, updated_at
         FROM tier_university_overrides`
      );
      for (const row of result.rows) {
        this.overrides.set(row.player_key, {
          playerName: row.player_name,
          universities: normalizeUniversities(row.universities),
          tier: normalizeTier(row.tier) || null,
          promotionLight: Boolean(row.promotion_light),
          isCustom: Boolean(row.is_custom),
          race: normalizeRace(row.race) || null,
          broadcastId: normalizeBroadcastId(row.broadcast_id) || null,
          updatedAt: row.updated_at
        });
      }
      console.log("Tier university overrides: PostgreSQL persistence enabled");
      return;
    }

    try {
      const saved = JSON.parse(await fs.promises.readFile(this.filePath, "utf8"));
      for (const [key, value] of Object.entries(saved || {})) {
        this.overrides.set(key, {
          playerName: String(value.playerName || ""),
          universities: normalizeUniversities(value.universities),
          tier: normalizeTier(value.tier) || null,
          promotionLight: Boolean(value.promotionLight),
          isCustom: Boolean(value.isCustom),
          race: normalizeRace(value.race) || null,
          broadcastId: normalizeBroadcastId(value.broadcastId) || null,
          updatedAt: value.updatedAt || null
        });
      }
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("Could not read tier overrides:", error.message);
    }
    console.log("Tier university overrides: local JSON persistence at " + this.filePath);
  }

  applyOverrides(players) {
    const seen = new Set();
    const result = (Array.isArray(players) ? players : []).map((player) => {
      seen.add(playerKey(player.name));
      const override = this.overrides.get(playerKey(player.name));
      if (!override) return player;
      const universities = [...override.universities];
      return {
        ...player,
        university: universities[0] || "연합팀",
        universities,
        tier: override.tier || player.tier,
        promotionLight: Boolean(override.promotionLight),
        race: override.race || player.race,
        broadcastId: override.broadcastId || player.broadcastId,
        customPlayer: Boolean(override.isCustom),
        universityOverride: true,
        tierOverride: Boolean(override.tier)
      };
    });
    for (const [key, override] of this.overrides) {
      if (!override.isCustom || seen.has(key)) continue;
      const universities = [...override.universities];
      result.push({
        name: override.playerName,
        tier: override.tier || "FA",
        division: "women",
        race: override.race || "T",
        university: universities[0] || "연합팀",
        universities,
        broadcastId: override.broadcastId || "",
        image: soopProfileImage(override.broadcastId),
        profileUrl: override.broadcastId
          ? "https://play.sooplive.co.kr/" + encodeURIComponent(override.broadcastId)
          : "",
        promotionLight: Boolean(override.promotionLight),
        universityOverride: true,
        tierOverride: true,
        customPlayer: true
      });
    }
    const tierRank = (tier) => tier === "FA" ? Number.MAX_SAFE_INTEGER : Number(tier);
    return result.sort((playerA, playerB) =>
      tierRank(playerA.tier) - tierRank(playerB.tier) || playerA.name.localeCompare(playerB.name, "ko"));
  }

  listOverrides() {
    return [...this.overrides.values()]
      .map((item) => ({ ...item, universities: [...item.universities] }))
      .sort((itemA, itemB) => itemA.playerName.localeCompare(itemB.playerName, "ko"));
  }

  getOverride(playerName) {
    const item = this.overrides.get(playerKey(playerName));
    return item ? { ...item, universities: [...item.universities] } : null;
  }

  async setOverride(playerName, values) {
    this.assertWritableStorage();
    const normalizedName = String(playerName || "").trim().slice(0, 40);
    const key = playerKey(normalizedName);
    if (!key) throw new Error("선수 이름이 필요합니다.");
    const payload = Array.isArray(values) ? { universities: values } : (values || {});
    const tier = payload.tier == null || payload.tier === "" ? null : normalizeTier(payload.tier);
    if (payload.tier != null && payload.tier !== "" && !tier) {
      throw new Error("티어는 0~9 또는 FA 중에서 선택해 주세요.");
    }
    const current = this.overrides.get(key);
    const isCustom = payload.isCustom == null ? Boolean(current?.isCustom) : Boolean(payload.isCustom);
    const race = normalizeRace(payload.race ?? current?.race);
    const broadcastId = normalizeBroadcastId(payload.broadcastId ?? current?.broadcastId);
    if (isCustom && !tier) throw new Error("새 선수의 티어를 선택해 주세요.");
    if (isCustom && !race) throw new Error("새 선수의 종족을 선택해 주세요.");
    if (payload.broadcastId && !broadcastId) {
      throw new Error("SOOP 아이디는 영문, 숫자, 밑줄 또는 하이픈만 입력해 주세요.");
    }
    const item = {
      playerName: normalizedName,
      universities: normalizeUniversities(payload.universities),
      tier,
      promotionLight: tier === "FA" ? false : Boolean(payload.promotionLight),
      isCustom,
      race: race || null,
      broadcastId: broadcastId || null,
      updatedAt: new Date().toISOString()
    };
    if (this.pool) {
      const result = await this.pool.query(
        `INSERT INTO tier_university_overrides(
           player_key, player_name, universities, tier, promotion_light,
           is_custom, race, broadcast_id, updated_at
         )
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(player_key) DO UPDATE SET
           player_name=EXCLUDED.player_name,
           universities=EXCLUDED.universities,
           tier=EXCLUDED.tier,
           promotion_light=EXCLUDED.promotion_light,
           is_custom=EXCLUDED.is_custom,
           race=EXCLUDED.race,
           broadcast_id=EXCLUDED.broadcast_id,
           updated_at=EXCLUDED.updated_at
         RETURNING player_key`,
        [
          key,
          item.playerName,
          JSON.stringify(item.universities),
          item.tier,
          item.promotionLight,
          item.isCustom,
          item.race,
          item.broadcastId,
          item.updatedAt
        ]
      );
      if (result.rowCount !== 1 || result.rows[0]?.player_key !== key) {
        throw new Error("PostgreSQL에서 저장 완료를 확인하지 못했습니다.");
      }
      this.overrides.set(key, item);
    } else {
      const previous = this.overrides.get(key);
      this.overrides.set(key, item);
      try {
        await this.persistFile();
      } catch (error) {
        if (previous) this.overrides.set(key, previous);
        else this.overrides.delete(key);
        throw error;
      }
    }
    return { ...item, universities: [...item.universities] };
  }

  async deleteOverride(playerName) {
    this.assertWritableStorage();
    const key = playerKey(playerName);
    if (!key) throw new Error("선수 이름이 필요합니다.");
    if (this.pool) {
      await this.pool.query("DELETE FROM tier_university_overrides WHERE player_key=$1", [key]);
      this.overrides.delete(key);
    } else {
      const previous = this.overrides.get(key);
      this.overrides.delete(key);
      try {
        await this.persistFile();
      } catch (error) {
        if (previous) this.overrides.set(key, previous);
        throw error;
      }
    }
  }

  async persistFile() {
    const serialized = Object.fromEntries(this.overrides);
    this.fileWrite = this.fileWrite.then(async () => {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = this.filePath + ".tmp";
      await fs.promises.writeFile(temporary, JSON.stringify(serialized, null, 2), "utf8");
      await fs.promises.rename(temporary, this.filePath);
    });
    await this.fileWrite;
  }

  clientAddress(req) {
    return String(req?.headers?.["x-forwarded-for"] || req?.socket?.remoteAddress || "unknown")
      .split(",")[0].trim();
  }

  canAttemptLogin(req) {
    const now = Date.now();
    const address = this.clientAddress(req);
    const recent = (this.loginAttempts.get(address) || []).filter((time) => now - time < LOGIN_WINDOW_MS);
    this.loginAttempts.set(address, recent);
    return recent.length < LOGIN_ATTEMPTS;
  }

  recordFailedLogin(req) {
    const address = this.clientAddress(req);
    const attempts = this.loginAttempts.get(address) || [];
    attempts.push(Date.now());
    this.loginAttempts.set(address, attempts);
  }

  login(req, password) {
    if (!this.configured) return { status: 503, error: "관리자 비밀번호가 서버에 설정되지 않았습니다." };
    if (!this.canAttemptLogin(req)) {
      return { status: 429, error: "로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요." };
    }
    if (!safePasswordEqual(password, this.password)) {
      this.recordFailedLogin(req);
      return { status: 401, error: "비밀번호가 올바르지 않습니다." };
    }

    this.loginAttempts.delete(this.clientAddress(req));
    const token = crypto.randomBytes(32).toString("base64url");
    const session = {
      csrf: crypto.randomBytes(24).toString("base64url"),
      expiresAt: Date.now() + SESSION_MS
    };
    this.sessions.set(token, session);
    return {
      status: 200,
      session,
      cookie: this.sessionCookie(token)
    };
  }

  session(req) {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return { token, ...session };
  }

  authorize(req) {
    const session = this.session(req);
    const csrf = String(req?.headers?.["x-csrf-token"] || "");
    if (!session || !csrf || csrf !== session.csrf) return null;
    return session;
  }

  logout(req) {
    const session = this.session(req);
    if (session) this.sessions.delete(session.token);
    return this.clearSessionCookie();
  }

  sessionCookie(token) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure}`;
  }

  clearSessionCookie() {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
  }
}

module.exports = {
  TierAdmin,
  normalizeBroadcastId,
  normalizeRace,
  normalizeTier,
  normalizeUniversities,
  playerKey
};
