"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DATA_SHORTAGE = "데이터 부족";

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function rate(wins, games) {
  return games ? Math.round((wins / games) * 1000) / 10 : 0;
}

function recordFromProfile(record, matches = []) {
  if (record && numberOrZero(record.games) > 0) {
    const games = numberOrZero(record.games);
    const wins = numberOrZero(record.wins);
    const losses = numberOrZero(record.losses);
    return { games, wins, losses, rate: numberOrZero(record.rate) || rate(wins, games) };
  }
  const wins = matches.filter((match) => numberOrZero(match.elo) > 0).length;
  const losses = matches.filter((match) => numberOrZero(match.elo) < 0).length;
  return { games: wins + losses, wins, losses, rate: rate(wins, wins + losses) };
}

function styleFromCommunity(summary) {
  const text = String(summary || "").replace(/\s+/g, " ");
  if (/밸런스|균형/.test(text)) return "밸런스형";
  if (/공격|러시|압박/.test(text)) return "공격형";
  if (/운영|후반/.test(text)) return "운영형";
  if (/수비|방어/.test(text)) return "수비형";
  return DATA_SHORTAGE;
}

function gradeFromScore(score, totalGames) {
  if (totalGames < 10) return DATA_SHORTAGE;
  if (score >= 60) return "S";
  if (score >= 55) return "A";
  if (score >= 50) return "B";
  return "C";
}

function trendFromRates(overall, recent) {
  if (overall.games < 10 || recent.games < 5) return DATA_SHORTAGE;
  const difference = recent.rate - overall.rate;
  if (difference >= 5) return "상승";
  if (difference <= -5) return "하락";
  return "유지";
}

function growthFromRates(overall, recent, trend) {
  if (trend === DATA_SHORTAGE) return null;
  const difference = recent.rate - overall.rate;
  if (recent.games >= 10 && recent.rate >= 65 && difference >= 10) return 5;
  if (trend === "상승") return 4;
  if (trend === "유지") return 3;
  if (recent.rate <= 35 && difference <= -10) return 1;
  return 2;
}

function opponentSummary(profile) {
  const rows = Array.isArray(profile?.mostMatches) ? profile.mostMatches : [];
  if (!rows.length) return DATA_SHORTAGE;
  const wins = rows.reduce((sum, item) => sum + numberOrZero(item.wins), 0);
  const losses = rows.reduce((sum, item) => sum + numberOrZero(item.losses), 0);
  const games = wins + losses;
  if (!games) return DATA_SHORTAGE;
  return `주요 다전 상대 ${rows.length}명 기준 ${wins}승 ${losses}패 (${rate(wins, games)}%) · 상대 등급 데이터 부족`;
}

function buildStrengths(overall, recent) {
  const strengths = [];
  if (overall.games >= 10 && overall.rate >= 55) strengths.push(`전체 승률 ${overall.rate}%`);
  if (recent.games >= 5 && recent.rate >= overall.rate + 5) {
    strengths.push(`최근 30일 승률 ${recent.rate}%로 상승`);
  }
  if (overall.games >= 100) strengths.push(`총 ${overall.games}경기의 풍부한 경기 경험`);
  if (recent.games >= 10 && recent.rate >= 55 && strengths.length < 3) {
    strengths.push(`최근 ${recent.games}경기에서 ${recent.wins}승`);
  }
  return strengths.slice(0, 3).length ? strengths.slice(0, 3) : [DATA_SHORTAGE];
}

function buildWeaknesses(overall, recent) {
  const weaknesses = [];
  if (overall.games >= 10 && overall.rate < 50) weaknesses.push(`전체 승률 ${overall.rate}%`);
  if (recent.games >= 5 && recent.rate <= overall.rate - 5) {
    weaknesses.push(`최근 30일 승률 ${recent.rate}%로 하락`);
  }
  return weaknesses.slice(0, 2).length ? weaknesses.slice(0, 2) : [DATA_SHORTAGE];
}

function analyzePlayer(profile, communitySummary = "") {
  const matches = Array.isArray(profile?.matches) ? profile.matches : [];
  const overall = recordFromProfile(profile?.total, matches);
  const recent = recordFromProfile(profile?.recent30, []);
  const hasRecentWeight = recent.games >= 5;
  const analysisScore = hasRecentWeight
    ? overall.rate * 0.7 + recent.rate * 0.3
    : overall.rate;
  const recentTrend = trendFromRates(overall, recent);
  const overallGrade = gradeFromScore(analysisScore, overall.games);
  const calculatedAt = new Date().toISOString();
  const cleanCommunity = String(communitySummary || "").replace(/\s+/g, " ").trim().slice(0, 1000);
  const playerName = String(profile?.name || "").trim() || DATA_SHORTAGE;
  const race = String(profile?.race || "").trim() || DATA_SHORTAGE;
  const summary = overall.games >= 10
    ? `${playerName}은(는) 총 ${overall.games}경기 승률 ${overall.rate}%이며 최근 흐름은 ${recentTrend}입니다.`
    : `${playerName}은(는) 객관적인 등급을 계산할 경기 데이터가 부족합니다.`;

  return {
    playerName,
    race,
    overallGrade,
    playStyle: styleFromCommunity(cleanCommunity),
    strengths: buildStrengths(overall, recent),
    weaknesses: buildWeaknesses(overall, recent),
    opponentCompetitiveness: opponentSummary(profile),
    recentTrend,
    communitySummary: cleanCommunity || DATA_SHORTAGE,
    growthPotential: growthFromRates(overall, recent, recentTrend),
    oneLineSummary: summary,
    evidence: {
      totalGames: overall.games,
      wins: overall.wins,
      losses: overall.losses,
      winRate: overall.rate,
      recentGames: recent.games,
      recentWinRate: recent.rate
    },
    calculatedAt
  };
}

class PlayerAnalysisStore {
  constructor(options = {}) {
    this.pool = options.pool || null;
    this.filePath = options.filePath || path.join(__dirname, "data", "player-analysis.json");
    this.records = new Map();
    this.fileWrite = Promise.resolve();
  }

  async init() {
    if (this.pool) {
      await this.pool.query(`CREATE TABLE IF NOT EXISTS player_analysis_records (
        wr_id TEXT PRIMARY KEY,
        player_name TEXT NOT NULL,
        community_summary TEXT NOT NULL DEFAULT '',
        analysis JSONB,
        calculated_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      const result = await this.pool.query(
        "SELECT wr_id, player_name, community_summary, analysis, calculated_at, updated_at FROM player_analysis_records"
      );
      this.records.clear();
      for (const row of result.rows) {
        this.records.set(String(row.wr_id), {
          wrId: String(row.wr_id),
          playerName: row.player_name,
          communitySummary: row.community_summary || "",
          analysis: row.analysis || null,
          calculatedAt: row.calculated_at || null,
          updatedAt: row.updated_at || null
        });
      }
      return;
    }

    try {
      const saved = JSON.parse(await fs.promises.readFile(this.filePath, "utf8"));
      this.records = new Map(Object.entries(saved || {}));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  get(wrId) {
    return this.records.get(String(wrId)) || null;
  }

  async saveCommunity(wrId, playerName, communitySummary) {
    const key = String(wrId);
    const current = this.get(key) || {};
    const record = {
      ...current,
      wrId: key,
      playerName: String(playerName || current.playerName || "").trim().slice(0, 80),
      communitySummary: String(communitySummary || "").replace(/\s+/g, " ").trim().slice(0, 1000),
      updatedAt: new Date().toISOString()
    };
    await this.saveRecord(record);
    return record;
  }

  async saveAnalysis(wrId, playerName, analysis) {
    const key = String(wrId);
    const current = this.get(key) || {};
    const record = {
      ...current,
      wrId: key,
      playerName: String(playerName || current.playerName || "").trim().slice(0, 80),
      communitySummary: String(current.communitySummary || ""),
      analysis,
      calculatedAt: analysis?.calculatedAt || new Date().toISOString(),
      updatedAt: current.updatedAt || new Date().toISOString()
    };
    await this.saveRecord(record);
    return record;
  }

  async saveRecord(record) {
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO player_analysis_records(
          wr_id, player_name, community_summary, analysis, calculated_at, updated_at
        ) VALUES($1,$2,$3,$4::jsonb,$5,$6)
        ON CONFLICT(wr_id) DO UPDATE SET
          player_name=EXCLUDED.player_name,
          community_summary=EXCLUDED.community_summary,
          analysis=EXCLUDED.analysis,
          calculated_at=EXCLUDED.calculated_at,
          updated_at=EXCLUDED.updated_at`,
        [
          record.wrId,
          record.playerName,
          record.communitySummary || "",
          record.analysis ? JSON.stringify(record.analysis) : null,
          record.calculatedAt || null,
          record.updatedAt || new Date().toISOString()
        ]
      );
      this.records.set(record.wrId, record);
      return;
    }

    this.records.set(record.wrId, record);
    const serialized = Object.fromEntries(this.records);
    this.fileWrite = this.fileWrite.then(async () => {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = this.filePath + ".tmp";
      await fs.promises.writeFile(temporary, JSON.stringify(serialized, null, 2), "utf8");
      await fs.promises.rename(temporary, this.filePath);
    });
    await this.fileWrite;
  }
}

module.exports = {
  DATA_SHORTAGE,
  PlayerAnalysisStore,
  analyzePlayer,
  gradeFromScore,
  trendFromRates
};
