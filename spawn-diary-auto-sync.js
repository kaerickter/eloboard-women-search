"use strict";

const crypto = require("node:crypto");

const AUTO_PLAYER_NAME = "이아깽";
const AUTO_SOURCE_ID = "eloboard-auto";
const AUTO_SYNC_LOCK_ID = 7310928;

function koreaDateKey(daysFromToday = 0, now = Date.now()) {
  const koreaTime = new Date(now + (9 * 60 * 60 * 1000));
  koreaTime.setUTCDate(koreaTime.getUTCDate() + daysFromToday);
  return koreaTime.toISOString().slice(0, 10);
}

function recentAutoMatchWindow(now = Date.now()) {
  return {
    from: koreaDateKey(-1, now),
    to: koreaDateKey(0, now),
  };
}

function compactName(value) {
  return String(value || "").replace(/\s+/g, "").trim().toLocaleLowerCase("ko");
}

function looseName(value) {
  return compactName(value).replace(/[^0-9a-z가-힣]/gi, "");
}

function clean(value, limit = 500) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, limit);
}

function opponentIdentity(value) {
  const label = clean(value, 80);
  const raceMatch = label.match(/\s*\(([TPZ])\)\s*$/i);
  return {
    name: clean(label.replace(/\s*\([TPZ]\)\s*$/i, ""), 80),
    race: raceMatch ? raceMatch[1].toUpperCase() : "",
  };
}

function classifyGameFormat(match) {
  const source = `${clean(match?.format, 100)} ${clean(match?.memo, 300)}`;
  if (/(?:^|[^a-z])ck(?:[^a-z]|$)/i.test(source)) return "CK";
  if (source.includes("대전")) return "대학대전";
  return "스폰";
}

function resultFromElo(value) {
  const elo = Number(value);
  if (elo > 0) return "승";
  if (elo < 0) return "패";
  return "미정";
}

function sourceKeyForMatch(playerName, match) {
  const opponent = opponentIdentity(match?.opponent).name;
  const identity = [
    compactName(playerName),
    clean(match?.url, 1000),
    clean(match?.date, 10),
    compactName(opponent),
    clean(match?.map, 100),
    Number(match?.elo) || 0,
    clean(match?.format, 100),
    clean(match?.memo, 500),
  ].join("\u001f");
  return crypto.createHash("sha256").update(identity).digest("hex");
}

function findOpponentProfile(roster, opponentName) {
  const players = Array.isArray(roster) ? roster : [];
  const exact = compactName(opponentName);
  const loose = looseName(opponentName);
  return players.find((player) => compactName(player?.name) === exact)
    || players.find((player) => looseName(player?.name) === loose)
    || null;
}

function tierSnapshot(player) {
  const rawTier = clean(player?.tier, 40);
  if (!rawTier) return null;
  if (rawTier.toUpperCase() === "FA") return "FA";
  const withoutPromotion = rawTier.replace(/\s*승급\s*불\s*$/u, "").trim();
  const label = withoutPromotion.endsWith("티어")
    ? withoutPromotion
    : withoutPromotion + "티어";
  const promotionLight = Boolean(player?.promotionLight) || /승급\s*불/u.test(rawTier);
  return label + (promotionLight ? " 승급불" : "");
}

function candidateFromMatch(playerName, match, roster) {
  const opponentInfo = opponentIdentity(match?.opponent);
  const opponent = opponentInfo.name;
  const opponentProfile = findOpponentProfile(roster, opponent);
  const matchRace = clean(match?.opponentRace, 30).toUpperCase();
  return {
    sourceKey: sourceKeyForMatch(playerName, match),
    sourceUrl: clean(match?.url, 1000) || null,
    matchDate: clean(match?.date, 10) || null,
    gameFormat: classifyGameFormat(match),
    opponent,
    tier: tierSnapshot(opponentProfile),
    opponentRace: clean(opponentProfile?.race, 30) || matchRace || opponentInfo.race || null,
    mapName: clean(match?.map, 80) || null,
    result: resultFromElo(match?.elo),
  };
}

function duplicateSignature(entry) {
  const date = entry?.match_date instanceof Date
    ? entry.match_date.toISOString().slice(0, 10)
    : clean(entry?.match_date ?? entry?.matchDate, 10).slice(0, 10);
  const opponent = opponentIdentity(entry?.opponent).name;
  return [
    date,
    looseName(opponent),
    clean(entry?.map_name ?? entry?.mapName, 80).toLocaleLowerCase("ko"),
    clean(entry?.result, 10),
  ].join("|");
}

async function initializeSpawnDiaryAutoSyncSchema(pool) {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS spawn_diary_entries (
    id BIGSERIAL PRIMARY KEY,
    match_date DATE,
    game_format TEXT,
    opponent TEXT NOT NULL DEFAULT '',
    tier TEXT,
    opponent_race TEXT,
    map_name TEXT,
    result TEXT,
    opponent_build TEXT,
    my_build TEXT,
    feedback TEXT,
    reflection TEXT,
    keywords TEXT,
    replay_number TEXT,
    source_sheet_id TEXT,
    source_row BIGINT,
    source_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`ALTER TABLE spawn_diary_entries
    ADD COLUMN IF NOT EXISTS match_date DATE,
    ADD COLUMN IF NOT EXISTS game_format TEXT,
    ADD COLUMN IF NOT EXISTS opponent TEXT,
    ADD COLUMN IF NOT EXISTS tier TEXT,
    ADD COLUMN IF NOT EXISTS opponent_race TEXT,
    ADD COLUMN IF NOT EXISTS map_name TEXT,
    ADD COLUMN IF NOT EXISTS result TEXT,
    ADD COLUMN IF NOT EXISTS opponent_build TEXT,
    ADD COLUMN IF NOT EXISTS my_build TEXT,
    ADD COLUMN IF NOT EXISTS feedback TEXT,
    ADD COLUMN IF NOT EXISTS reflection TEXT,
    ADD COLUMN IF NOT EXISTS keywords TEXT,
    ADD COLUMN IF NOT EXISTS replay_number TEXT,
    ADD COLUMN IF NOT EXISTS source_sheet_id TEXT,
    ADD COLUMN IF NOT EXISTS source_row BIGINT,
    ADD COLUMN IF NOT EXISTS source_url TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS spawn_diary_entries_date_idx ON spawn_diary_entries (match_date DESC, source_row DESC)"
  );
  await pool.query(`CREATE TABLE IF NOT EXISTS spawn_diary_auto_seen (
    source_key TEXT PRIMARY KEY,
    player_key TEXT NOT NULL,
    match_date DATE,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    imported_entry_id BIGINT
  )`);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS spawn_diary_auto_seen_player_idx ON spawn_diary_auto_seen (player_key, first_seen_at DESC)"
  );
}

async function syncSpawnDiaryFromProfile({ pool, profile, roster, playerName = AUTO_PLAYER_NAME }) {
  if (!pool) return { enabled: false, error: "스폰일지 저장소가 연결되지 않았습니다." };
  const matches = Array.isArray(profile?.matches) ? profile.matches : [];
  const playerKey = compactName(playerName);
  const uniqueCandidates = [];
  const sourceKeys = new Set();
  const autoMatchWindow = recentAutoMatchWindow();
  for (const match of matches) {
    const candidate = candidateFromMatch(playerName, match, roster);
    if (!candidate.matchDate || !candidate.opponent || sourceKeys.has(candidate.sourceKey)) continue;
    if (candidate.matchDate < autoMatchWindow.from || candidate.matchDate > autoMatchWindow.to) continue;
    sourceKeys.add(candidate.sourceKey);
    uniqueCandidates.push(candidate);
  }

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [AUTO_SYNC_LOCK_ID]);
    await client.query(`
      DELETE FROM spawn_diary_auto_seen AS seen
      WHERE seen.player_key = $1
        AND seen.imported_entry_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM spawn_diary_entries AS entry
          WHERE entry.id = seen.imported_entry_id
        )
    `, [playerKey]);
    const seenCountResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM spawn_diary_auto_seen WHERE player_key = $1",
      [playerKey]
    );
    const seenCount = Number(seenCountResult.rows[0]?.count || 0);
    const seenKeysResult = uniqueCandidates.length
      ? await client.query(
        "SELECT source_key FROM spawn_diary_auto_seen WHERE player_key = $1 AND source_key = ANY($2::text[])",
        [playerKey, uniqueCandidates.map((candidate) => candidate.sourceKey)]
      )
      : { rows: [] };
    const seenKeys = new Set(seenKeysResult.rows.map((row) => row.source_key));
    const pendingCandidates = uniqueCandidates.filter((candidate) => !seenKeys.has(candidate.sourceKey));

    if (!pendingCandidates.length) {
      await client.query("COMMIT");
      return {
        enabled: true,
        initialized: seenCount === 0,
        baselineCount: seenCount === 0 ? uniqueCandidates.length : undefined,
        checked: uniqueCandidates.length,
        imported: 0,
        duplicates: 0,
        baselineSkipped: 0,
      };
    }

    const existingResult = await client.query(`
      SELECT id, match_date, opponent, tier, opponent_race, map_name, result, source_sheet_id
      FROM spawn_diary_entries
    `);
    const existingSignatures = new Set(existingResult.rows.map(duplicateSignature));
    const existingBySignature = new Map(
      existingResult.rows.map((entry) => [duplicateSignature(entry), entry])
    );
    const existingDates = existingResult.rows
      .map((entry) => duplicateSignature(entry).split("|")[0])
      .filter(Boolean)
      .sort();
    const latestExistingDate = existingDates.at(-1) || "";
    const initializing = seenCount === 0;
    const orderedCandidates = [...pendingCandidates].sort((a, b) =>
      String(a.matchDate).localeCompare(String(b.matchDate))
    );
    const sourceRowResult = await client.query(
      "SELECT COALESCE(MAX(source_row), 0) AS last_row FROM spawn_diary_entries WHERE source_sheet_id = $1",
      [AUTO_SOURCE_ID]
    );
    let nextSourceRow = Number(sourceRowResult.rows[0]?.last_row || 0) + 1;
    let imported = 0;
    let duplicates = 0;
    let baselineSkipped = 0;

    for (const candidate of orderedCandidates) {
      const signature = duplicateSignature(candidate);
      const existing = existingBySignature.get(signature);
      if (existing?.source_sheet_id === AUTO_SOURCE_ID) {
        await client.query(`
          UPDATE spawn_diary_entries
          SET opponent = $2,
              tier = COALESCE($3, tier),
              opponent_race = COALESCE($4, opponent_race)
          WHERE id = $1
        `, [existing.id, candidate.opponent, candidate.tier, candidate.opponentRace]);
      }
      const seenInsert = await client.query(`
        INSERT INTO spawn_diary_auto_seen (source_key, player_key, match_date)
        VALUES ($1, $2, $3)
        ON CONFLICT (source_key) DO NOTHING
        RETURNING source_key
      `, [candidate.sourceKey, playerKey, candidate.matchDate]);
      if (!seenInsert.rowCount) continue;

      if (existingSignatures.has(signature)) {
        duplicates += 1;
        continue;
      }
      if (initializing && (!latestExistingDate || candidate.matchDate < latestExistingDate)) {
        baselineSkipped += 1;
        continue;
      }

      const diaryInsert = await client.query(`
        INSERT INTO spawn_diary_entries (
          match_date, game_format, opponent, tier, opponent_race, map_name,
          result, opponent_build, my_build, feedback, reflection, keywords,
          replay_number, source_sheet_id, source_row, source_url
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, NULL, NULL, NULL, NULL, $8,
          NULL, $9, $10, $11
        )
        RETURNING id
      `, [
        candidate.matchDate,
        candidate.gameFormat,
        candidate.opponent,
        candidate.tier,
        candidate.opponentRace,
        candidate.mapName,
        candidate.result,
        "전적검색 자동등록",
        AUTO_SOURCE_ID,
        nextSourceRow,
        candidate.sourceUrl,
      ]);
      nextSourceRow += 1;
      imported += 1;
      await client.query(
        "UPDATE spawn_diary_auto_seen SET imported_entry_id = $1 WHERE source_key = $2",
        [diaryInsert.rows[0].id, candidate.sourceKey]
      );
    }

    await client.query("COMMIT");
    return {
      enabled: true,
      initialized: initializing,
      baselineCount: initializing ? uniqueCandidates.length : undefined,
      checked: uniqueCandidates.length,
      imported,
      duplicates,
      baselineSkipped,
    };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release();
  }
}

module.exports = {
  AUTO_PLAYER_NAME,
  candidateFromMatch,
  classifyGameFormat,
  compactName,
  duplicateSignature,
  initializeSpawnDiaryAutoSyncSchema,
  koreaDateKey,
  recentAutoMatchWindow,
  opponentIdentity,
  resultFromElo,
  sourceKeyForMatch,
  syncSpawnDiaryFromProfile,
  tierSnapshot,
};
