const $ = (id) => document.getElementById(id);
const DEFAULT_NAME = "\uc774\uc544\uae7d";
const DEFAULT_WR_ID = "780";
const SEARCH_SESSION_KEY = "record-search-session-v2";
const state = {
  query: "",
  data: null,
  selectedYear: "",
  selectedMonth: "",
  requestId: 0,
  activeController: null,
  analysisProfile: null,
  analysis: null,
  analysisRequestId: 0,
  analysisAdminCsrf: ""
};

function saveSearchSession() {
  if (!state.data) return;
  try {
    sessionStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify({
      name: $("nameInput").value,
      data: state.data,
      selectedYear: state.selectedYear,
      selectedMonth: state.selectedMonth
    }));
  } catch {
    // 저장 공간이 부족한 경우 검색 기능은 그대로 사용합니다.
  }
}

function restoreSearchSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SEARCH_SESSION_KEY) || "null");
    if (!saved || typeof saved !== "object") return false;
    validateSearchResponse(saved.data);
    $("nameInput").value = String(saved.name || DEFAULT_NAME);
    state.query = $("nameInput").value.trim();
    state.data = saved.data;
    state.selectedYear = String(saved.selectedYear || "");
    state.selectedMonth = String(saved.selectedMonth || "");
    render(saved.data);
    setSearchState("success", "이전에 보던 검색 결과를 복원했습니다.");
    return true;
  } catch {
    return false;
  }
}

const TXT = {
  win: "\uc2b9",
  loss: "\ud328",
  noData: "\ud45c\uc2dc\ud560 \ub370\uc774\ud130\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.",
  noResult: "\uac80\uc0c9 \uacb0\uacfc\uac00 \uc5c6\uc2b5\ub2c8\ub2e4. \ud398\uc774\uc9c0 \uc218\ub97c \ub298\ub9ac\uac70\ub098 \uc774\ub984 \uc77c\ubd80\ub9cc \uc785\ub825\ud574\ubcf4\uc138\uc694.",
  detail: "\uc0c1\uc138",
  inputBy: "\uc785\ub825\uc790",
  loading: "\uac8c\uc2dc\ud310 \ub370\uc774\ud130\ub97c \ubd88\ub7ec\uc624\ub294 \uc911\uc785\ub2c8\ub2e4.",
  refreshing: "\uac8c\uc2dc\ud310\uc744 \uc0c8\ub85c \uac00\uc838\uc624\ub294 \uc911\uc785\ub2c8\ub2e4.",
  loadFail: "\ub370\uc774\ud130\ub97c \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.",
  basis: "\uae30\uc900",
  pagesFrom: "bj_board",
  pagesUnit: "\ud398\uc774\uc9c0\uc5d0\uc11c",
  readUnit: "\uac1c \uc804\uc801\uc744 \uc77d\uc5c8\uc2b5\ub2c8\ub2e4.",
  gamesUnit: "\uac74",
  gameWord: "\uacbd\uae30",
  profileOpen: "\uc6d0\ubcf8 \ud504\ub85c\ud544",
  noProfile: "\uc120\uc218 \ud504\ub85c\ud544\uc744 \ucc3e\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.",
  candidates: "\ud6c4\ubcf4",
  total: "\ucd1d\uc804\uc801",
  women: "\uc5ec\uc131",
  mixed: "\ud63c\uc131",
  recent30: "\ucd5c\uadfc 30\uc77c",
  most: "\ucd5c\ub2e4 \ub9e4\uce58",
  profileMatches: "\uc120\ud0dd \uae30\uac04 \uc804\uc801",
  noPeriod: "\uae30\uac04\ubcc4 \uc804\uc801\uc744 \uacc4\uc0b0\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.",
  yearSuffix: "\ub144",
  monthSuffix: "\uc6d4",
  periodBasis: "\ud504\ub85c\ud544 \uc804\uc801 \uae30\uc900",
  opponentReady: "\uc0c1\ub300 \uc774\ub984\uc744 \uc785\ub825\ud558\uba74 \ucd5c\uadfc 90\uc77c \uc804\uc801\uc774 \ud45c\uc2dc\ub429\ub2c8\ub2e4.",
  opponentNoData: "\ucd5c\uadfc 90\uc77c \ub0b4 \ud574\ub2f9 \uc0c1\ub300\uc640\uc758 \uc804\uc801\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
  recent90Basis: "\ucd5c\uadfc 90\uc77c \uae30\uc900"
};

function cleanName(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function fmtPoint(value) {
  const sign = value > 0 ? "+" : "";
  return sign + Number(value || 0).toFixed(1);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function setSearchState(kind, message) {
  const status = $("status");
  status.dataset.state = kind;
  status.textContent = message;
  $("profile").setAttribute("aria-busy", kind === "loading" ? "true" : "false");
  $("searchButton").disabled = kind === "loading";
  $("refreshButton").disabled = kind === "loading";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Accept": "application/json",
      ...(options.headers || {})
    }
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("서버가 올바른 JSON 응답을 보내지 않았습니다.");
  }
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

function analysisValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(" · ") : "데이터 부족";
  if (value == null || value === "") return "데이터 부족";
  return String(value);
}

function resetAnalysisPanel() {
  state.analysisProfile = null;
  state.analysis = null;
  $("analysisPanel").hidden = true;
  $("analysisResult").hidden = true;
  $("analysisResult").innerHTML = "";
}

function prepareAnalysis(profile) {
  if (!profile?.wrId) return resetAnalysisPanel();
  const samePlayer = String(state.analysisProfile?.wrId || "") === String(profile.wrId);
  state.analysisProfile = { name: profile.name, wrId: String(profile.wrId) };
  $("analysisPanel").hidden = false;
  $("analysisButton").disabled = false;
  if (!samePlayer) {
    state.analysis = null;
    $("analysisResult").hidden = true;
    $("analysisResult").innerHTML = "";
    $("analysisUpdatedAt").textContent = "분석 버튼을 누르면 최신 전적으로 계산합니다.";
    $("analysisStatus").dataset.state = "empty";
    $("analysisStatus").textContent = profile.name + " 선수의 경기력 분석을 준비했습니다.";
    $("communitySummaryInput").value = "";
  }
}

function renderPlayerAnalysis(analysis) {
  const rows = [
    ["선수명", analysis.playerName],
    ["종합 등급", analysis.overallGrade, "analysis-grade"],
    ["플레이 스타일", analysis.playStyle],
    ["강점", analysis.strengths],
    ["약점", analysis.weaknesses],
    ["상대 경쟁력", analysis.opponentCompetitiveness],
    ["최근 흐름", analysis.recentTrend],
    ["커뮤니티 평가", analysis.communitySummary],
    ["성장 가능성", analysis.growthPotential == null ? "데이터 부족" : analysis.growthPotential + " / 5"],
    ["한 줄 평가", analysis.oneLineSummary]
  ];
  $("analysisResult").innerHTML = '<dl class="analysis-list">' + rows.map((row) =>
    '<div class="analysis-row ' + (row[2] || "") + '"><dt>' + escapeHtml(row[0]) + '</dt><dd>' +
      escapeHtml(analysisValue(row[1])) + '</dd></div>'
  ).join("") + "</dl>";
  $("analysisResult").hidden = false;
  $("analysisStatus").dataset.state = "success";
  $("analysisStatus").textContent = "전적 데이터와 저장된 커뮤니티 평가로 계산했습니다.";
  $("analysisUpdatedAt").textContent = "갱신 " + new Date(analysis.calculatedAt).toLocaleString("ko-KR");
  $("communitySummaryInput").value = analysis.communitySummary === "데이터 부족" ? "" : analysis.communitySummary;
}

async function loadPlayerAnalysis(refresh = false) {
  const profile = state.analysisProfile;
  if (!profile?.wrId) return;
  const requestId = state.analysisRequestId + 1;
  state.analysisRequestId = requestId;
  $("analysisButton").disabled = true;
  $("analysisStatus").dataset.state = "loading";
  $("analysisStatus").textContent = "ELOBoard 전적을 분석하는 중입니다.";
  try {
    const params = new URLSearchParams({ wr_id: profile.wrId });
    if (refresh) params.set("refresh", "1");
    const analysis = await requestJson("/api/player-analysis?" + params.toString());
    if (requestId !== state.analysisRequestId) return;
    state.analysis = analysis;
    renderPlayerAnalysis(analysis);
  } catch (error) {
    if (requestId !== state.analysisRequestId) return;
    $("analysisStatus").dataset.state = "error";
    $("analysisStatus").textContent = error.message || "선수 경기력 분석에 실패했습니다.";
    $("analysisResult").hidden = true;
  } finally {
    if (requestId === state.analysisRequestId) $("analysisButton").disabled = false;
  }
}

async function refreshAnalysisAdminStatus() {
  try {
    const status = await requestJson("/api/admin/status");
    state.analysisAdminCsrf = status.csrf || "";
    $("analysisLoginRow").hidden = Boolean(status.authenticated);
    $("analysisEditor").hidden = !status.authenticated;
    $("analysisAdminStatus").dataset.state = status.authenticated ? "success" : "";
    $("analysisAdminStatus").textContent = status.authenticated
      ? status.storage?.message || "관리자 입력이 가능합니다."
      : (status.configured ? "관리자 로그인이 필요합니다." : "관리자 비밀번호가 설정되지 않았습니다.");
  } catch (error) {
    $("analysisAdminStatus").dataset.state = "error";
    $("analysisAdminStatus").textContent = error.message;
  }
}

async function loginAnalysisAdmin() {
  const password = $("analysisAdminPassword").value;
  $("analysisLoginButton").disabled = true;
  try {
    const result = await requestJson("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    state.analysisAdminCsrf = result.csrf || "";
    $("analysisAdminPassword").value = "";
    await refreshAnalysisAdminStatus();
  } catch (error) {
    $("analysisAdminStatus").dataset.state = "error";
    $("analysisAdminStatus").textContent = error.message;
  } finally {
    $("analysisLoginButton").disabled = false;
  }
}

async function saveCommunitySummary() {
  const profile = state.analysisProfile;
  if (!profile?.wrId) return;
  $("communitySaveButton").disabled = true;
  try {
    const result = await requestJson("/api/player-analysis/community", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": state.analysisAdminCsrf
      },
      body: JSON.stringify({
        wrId: profile.wrId,
        communitySummary: $("communitySummaryInput").value
      })
    });
    state.analysis = result.analysis;
    renderPlayerAnalysis(result.analysis);
    $("analysisAdminStatus").dataset.state = "success";
    $("analysisAdminStatus").textContent = "커뮤니티 평가를 저장했습니다.";
  } catch (error) {
    $("analysisAdminStatus").dataset.state = "error";
    $("analysisAdminStatus").textContent = error.message;
  } finally {
    $("communitySaveButton").disabled = false;
  }
}

function autoDiaryStatusSuffix(sync) {
  if (!sync) return "";
  if (sync.error) return " · 스폰일지 자동등록을 다시 확인해 주세요.";
  if (Number(sync.imported) > 0) return " · 새 경기 " + Number(sync.imported) + "건을 스폰일지에 자동등록했습니다.";
  if (sync.initialized) return " · 현재 기록을 기준으로 스폰일지 자동등록을 시작했습니다.";
  return "";
}

function validateSearchResponse(data) {
  if (!data || typeof data !== "object") throw new Error("검색 응답 형식이 올바르지 않습니다.");
  if (!Array.isArray(data.matches) || !Array.isArray(data.players)) {
    throw new Error("검색 결과에 필요한 항목이 없습니다.");
  }
  if (data.profile != null && (typeof data.profile !== "object" || !String(data.profile.name || "").trim())) {
    throw new Error("선수 프로필 응답이 올바르지 않습니다.");
  }
  if (!String(data.fetchedAt || "").trim()) throw new Error("검색 결과의 갱신 시각이 없습니다.");
  return data;
}

async function fetchSearchJson(url, signal, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const timeoutController = new AbortController();
    const abortFromCaller = () => timeoutController.abort();
    signal.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => timeoutController.abort(), 30000);
    try {
      const response = await fetch(url, {
        signal: timeoutController.signal,
        headers: { "Accept": "application/json" }
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("서버가 올바른 JSON 응답을 보내지 않았습니다.");
      }
      if (response.ok) return validateSearchResponse(data);
      const error = new Error(data.error || TXT.loadFail);
      if (![502, 503, 504].includes(response.status) || attempt === attempts - 1) throw error;
      lastError = error;
    } catch (error) {
      if (signal.aborted) throw new DOMException("요청이 취소되었습니다.", "AbortError");
      lastError = error;
      if (attempt === attempts - 1) {
        if (error?.name === "AbortError") {
          throw new Error("검색 요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
        }
        if (error instanceof TypeError) {
          throw new Error("검색 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
        }
        throw error;
      }
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortFromCaller);
    }
  }
  throw lastError || new Error(TXT.loadFail);
}

function avatarMarkup(name, image) {
  const initial = Array.from(String(name || "?").trim())[0] || "?";
  const imageUrl = safeExternalUrl(image);
  const img = imageUrl ? '<img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(name) + ' 프로필 사진">' : "";
  return '<span class="player-photo">' + img + '<b aria-hidden="true">' + escapeHtml(initial) + '</b></span>';
}

function bindImageFallbacks(root) {
  root.querySelectorAll(".player-photo img").forEach((image) => {
    const fallback = () => { image.hidden = true; };
    image.addEventListener("error", fallback);
    if (image.complete && !image.naturalWidth) fallback();
  });
}

function personal(match, query) {
  const key = cleanName(query);
  const won = cleanName(match.winner).includes(key);
  const lost = cleanName(match.loser).includes(key);
  if (won) return { result: TXT.win, delta: match.point, opponent: match.loser };
  if (lost) return { result: TXT.loss, delta: -match.point, opponent: match.winner };
  return { result: "", delta: match.point, opponent: "" };
}

function renderMiniObject(target, object, formatter) {
  const entries = Object.entries(object || {});
  if (!entries.length) {
    target.innerHTML = '<div class="empty">' + TXT.noData + '</div>';
    return;
  }
  target.innerHTML = entries
    .sort((a, b) => {
      const av = typeof a[1] === "number" ? a[1] : a[1].games;
      const bv = typeof b[1] === "number" ? b[1] : b[1].games;
      return bv - av;
    })
    .slice(0, 20)
    .map(([name, value]) => formatter(name, value))
    .join("");
}

function getProfileRows(data) {
  return data && data.profile && Array.isArray(data.profile.matches) ? data.profile.matches : [];
}

function currentKoreaPeriod(date = new Date()) {
  const korea = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: String(korea.getUTCFullYear()),
    month: String(korea.getUTCMonth() + 1).padStart(2, "0")
  };
}

function sortedYears(rows, date = new Date()) {
  const current = currentKoreaPeriod(date);
  return [...new Set([
    current.year,
    ...rows.map((row) => String(row.date || "").slice(0, 4)).filter(Boolean)
  ])]
    .sort((a, b) => b.localeCompare(a));
}

function sortedMonths(rows, year, date = new Date()) {
  const current = currentKoreaPeriod(date);
  const months = rows
    .filter((row) => String(row.date || "").startsWith(year + "-"))
    .map((row) => String(row.date || "").slice(5, 7))
    .filter(Boolean);
  if (year === current.year) months.push(current.month);
  return [...new Set(months)]
    .sort((a, b) => b.localeCompare(a));
}

function periodStats(rows) {
  let wins = 0;
  let losses = 0;
  for (const row of rows) {
    const elo = Number(row.elo || 0);
    if (elo > 0) wins += 1;
    else if (elo < 0) losses += 1;
  }
  const games = wins + losses;
  const rate = games ? Math.round((wins / games) * 1000) / 10 : 0;
  return { games, wins, losses, rate };
}

function formatKoreaDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function currentMatchWindow(now = new Date()) {
  const korea = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  const calendarDay = formatKoreaDate(korea);
  const koreaMinutes = (korea.getUTCHours() * 60) + korea.getUTCMinutes();
  const beforeReset = koreaMinutes <= 360;
  const start = new Date(korea);
  if (beforeReset) start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    startDate: formatKoreaDate(start),
    endDate: formatKoreaDate(end),
    calendarDay,
    beforeReset
  };
}

function currentMatchDay(now = new Date()) {
  return currentMatchWindow(now).startDate;
}

function isCurrentMatchDayRow(row, window = currentMatchWindow()) {
  const date = String(row?.date || "");
  return date === window.startDate
    || (window.beforeReset && date === window.calendarDay);
}

function setPeriodValues(prefix, stats) {
  $(prefix + "Games").textContent = stats.games;
  $(prefix + "Wins").textContent = stats.wins;
  $(prefix + "Losses").textContent = stats.losses;
  $(prefix + "Rate").textContent = stats.rate + "%";
}

function resetResultPanels(message, className = "") {
  state.data = null;
  state.selectedYear = "";
  state.selectedMonth = "";
  $("yearSelect").innerHTML = "";
  $("monthSelect").innerHTML = "";
  $("periodLabel").textContent = message;
  $("yearRowLabel").textContent = "해당년도";
  $("monthRowLabel").textContent = "당월";
  setPeriodValues("year", { games: 0, wins: 0, losses: 0, rate: 0 });
  setPeriodValues("month", { games: 0, wins: 0, losses: 0, rate: 0 });
  setPeriodValues("day", { games: 0, wins: 0, losses: 0, rate: 0 });
  renderRaceRates(null);
  $("profileLink").innerHTML = "";
  $("playerChoices").innerHTML = "";
  $("profile").innerHTML = '<div class="empty ' + escapeHtml(className) + '">' + escapeHtml(message) + '</div>';
  resetAnalysisPanel();
}

function setSelectOptions(select, values, suffix) {
  select.innerHTML = values.map((value) => '<option value="' + value + '">' + value + suffix + '</option>').join("");
}

function selectedMonthRows(rows) {
  if (!state.selectedYear || !state.selectedMonth) return rows;
  const prefix = state.selectedYear + "-" + state.selectedMonth;
  return rows.filter((row) => String(row.date || "").startsWith(prefix));
}

function selectedCurrentMonth(date = new Date()) {
  const current = currentKoreaPeriod(date);
  return state.selectedYear === current.year && state.selectedMonth === current.month;
}

function displayMonth(month) {
  return String(Number(month) || month);
}

function latestMatchDate(rows) {
  const dates = rows
    .map((row) => new Date(String(row.date || "") + "T00:00:00"))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b - a);
  return dates[0] || null;
}

function recentRows(rows, days) {
  const latest = latestMatchDate(rows);
  if (!latest) return [];
  const from = new Date(latest);
  from.setDate(from.getDate() - (days - 1));
  return rows.filter((row) => {
    const date = new Date(String(row.date || "") + "T00:00:00");
    return !Number.isNaN(date.getTime()) && date >= from && date <= latest;
  });
}

function renderRaceRates(data) {
  const rows = getProfileRows(data);
  const yearPrefix = state.selectedYear ? state.selectedYear + "-" : "";
  const monthPrefix = state.selectedYear && state.selectedMonth
    ? state.selectedYear + "-" + state.selectedMonth
    : "";
  $("raceYearHeading").textContent = state.selectedYear ? state.selectedYear + "년 승률" : "해당 연도 승률";
  $("raceMonthHeading").textContent = state.selectedMonth ? Number(state.selectedMonth) + "월 승률" : "당월 승률";

  for (const race of ["T", "Z", "P"]) {
    const raceRows = rows.filter((row) => String(row.opponentRace || "").toUpperCase() === race);
    const yearRows = yearPrefix ? raceRows.filter((row) => String(row.date || "").startsWith(yearPrefix)) : [];
    const monthRows = monthPrefix ? raceRows.filter((row) => String(row.date || "").startsWith(monthPrefix)) : [];
    const values = {
      Overall: periodStats(raceRows),
      Year: periodStats(yearRows),
      Month: periodStats(monthRows)
    };
    for (const [period, stats] of Object.entries(values)) {
      const element = $("race" + period + race);
      element.innerHTML = '<span class="race-stat-games">' + stats.games + '전</span>' +
        '<span class="race-stat-wins">' + stats.wins + '승</span>' +
        '<span class="race-stat-losses">' + stats.losses + '패</span>' +
        '<span class="race-stat-rate">' + stats.rate + '%</span>';
      element.title = stats.games + "전 " + stats.wins + "승 " + stats.losses + "패";
      element.dataset.empty = stats.games ? "false" : "true";
    }
  }
}

function renderPeriod(data) {
  const rows = getProfileRows(data);
  const current = currentKoreaPeriod();
  const years = sortedYears(rows);
  const yearSelect = $("yearSelect");
  const monthSelect = $("monthSelect");

  if (!years.includes(state.selectedYear)) state.selectedYear = current.year;
  const months = sortedMonths(rows, state.selectedYear);
  if (!months.includes(state.selectedMonth)) {
    state.selectedMonth = state.selectedYear === current.year
      ? current.month
      : (months[0] || "");
  }

  setSelectOptions(yearSelect, years, TXT.yearSuffix);
  setSelectOptions(monthSelect, months, TXT.monthSuffix);
  yearSelect.value = state.selectedYear;
  monthSelect.value = state.selectedMonth;
  $("yearRowLabel").textContent = state.selectedYear + TXT.yearSuffix;
  $("monthRowLabel").textContent = displayMonth(state.selectedMonth) + TXT.monthSuffix;

  const yearRows = rows.filter((row) => String(row.date || "").startsWith(state.selectedYear + "-"));
  const monthRows = rows.filter((row) => String(row.date || "").startsWith(state.selectedYear + "-" + state.selectedMonth));
  const matchWindow = currentMatchWindow();
  const dayRows = selectedCurrentMonth()
    ? monthRows.filter((row) => isCurrentMatchDayRow(row, matchWindow))
    : [];
  const year = periodStats(yearRows);
  const month = periodStats(monthRows);
  const day = periodStats(dayRows);

  $("periodLabel").textContent = (data.profile?.name || state.query || "선수") + " \u00b7 " + TXT.periodBasis;
  $("dayRowLabel").innerHTML = "<span>당일</span><small>"
    + matchWindow.startDate + " 06:01 ~ " + matchWindow.endDate + " 06:00</small>";
  $("dayRowLabel").title = matchWindow.startDate + " 오전 06:01부터 "
    + matchWindow.endDate + " 오전 06:00까지";
  setPeriodValues("year", year);
  setPeriodValues("month", month);
  setPeriodValues("day", day);
}

function renderProfile(data) {
  const choices = data.players || [];
  $("playerChoices").innerHTML = choices.length > 1
    ? '<span class="small">' + TXT.candidates + '</span>' + choices.slice(0, 8).map((player) => '<button class="choice" type="button" data-name="' + escapeHtml(player.name) + '">' + escapeHtml(player.name) + '</button>').join("")
    : "";

  document.querySelectorAll(".choice").forEach((button) => {
    button.addEventListener("click", () => {
      $("nameInput").value = button.dataset.name;
      search(false);
    });
  });

  const profile = data.profile;
  if (!state.query.trim() || !profile) {
    $("profileLink").innerHTML = "";
    $("profile").innerHTML = '<div class="empty">' + TXT.noProfile + '</div>';
    resetAnalysisPanel();
    return;
  }

  const profileUrl = safeExternalUrl(profile.url);
  $("profileLink").innerHTML = profileUrl
    ? '<a class="detail-link" href="' + escapeHtml(profileUrl) + '" target="_blank" rel="noreferrer">' + TXT.profileOpen + '</a>'
    : "";
  const cards = [
    profile.total ? [TXT.total, profile.total.games + TXT.gameWord, profile.total.wins + TXT.win + " " + profile.total.losses + TXT.loss + " \u00b7 " + profile.total.rate + "%"] : null,
    profile.women ? [TXT.women, profile.women.games + TXT.gameWord, profile.women.wins + TXT.win + " " + profile.women.losses + TXT.loss + " \u00b7 " + profile.women.rate + "%"] : null,
    profile.mixed ? [TXT.mixed, profile.mixed.games + TXT.gameWord, profile.mixed.wins + TXT.win + " " + profile.mixed.losses + TXT.loss + " \u00b7 " + profile.mixed.rate + "%"] : null,
    profile.recent30 ? [TXT.recent30, profile.recent30.games + TXT.gameWord, profile.recent30.wins + TXT.win + " " + profile.recent30.losses + TXT.loss] : null
  ].filter(Boolean);

  const most = (profile.mostMatches || []).length
    ? '<div class="profile-section"><h3>' + TXT.most + '</h3><div class="pill-row">' + profile.mostMatches.map((item) => {
      const itemUrl = safeExternalUrl(item.url);
      const label = escapeHtml(item.name) + ' ' + item.wins + TXT.win + ' ' + item.losses + TXT.loss;
      return itemUrl
        ? '<a class="pill" href="' + escapeHtml(itemUrl) + '" target="_blank" rel="noreferrer">' + label + '</a>'
        : '<span class="pill">' + label + '</span>';
    }).join("") + '</div></div>'
    : "";

  const profileRows = profile.matches || [];
  const periodRows = selectedMonthRows(profileRows);
  const periodTitle = state.selectedYear && state.selectedMonth
    ? state.selectedYear + TXT.yearSuffix + " " + state.selectedMonth + TXT.monthSuffix + " " + TXT.profileMatches
    : TXT.profileMatches;
  const renderMatchRow = (match) => {
    const resultClass = match.elo >= 0 ? "result-win" : "result-loss";
    const deltaClass = match.elo >= 0 ? "delta-plus" : "delta-minus";
    const memo = escapeHtml(match.memo || "-");
    return '<div class="profile-match ' + resultClass + '"><span data-label="날짜">' + match.date + '</span><strong data-label="상대">' + escapeHtml(match.opponent) + '</strong><span data-label="맵">' + escapeHtml(match.map) + '</span><span data-label="ELO" class="' + deltaClass + '">' + escapeHtml(match.eloText) + '</span><span data-label="경기방식">' + escapeHtml(match.format) + '</span><span data-label="메모" class="profile-match-memo" title="' + memo + '">' + memo + '</span></div>';
  };
  const matchWindow = currentMatchWindow();
  const dayRows = selectedCurrentMonth()
    ? periodRows.filter((match) => isCurrentMatchDayRow(match, matchWindow))
    : [];
  const otherRows = periodRows.filter((match) => !isCurrentMatchDayRow(match, matchWindow));
  const dayGroup = dayRows.length
    ? '<section class="profile-day-group" aria-label="당일 전적"><div class="profile-day-group-title"><strong>당일 전적</strong><small>'
      + matchWindow.startDate + ' 06:01 ~ ' + matchWindow.endDate + ' 06:00</small></div>'
      + dayRows.map(renderMatchRow).join("") + '</section>'
    : "";
  const rows = dayRows.length || periodRows.length
    ? dayGroup + otherRows.map(renderMatchRow).join("")
    : '<div class="empty">' + TXT.noData + '</div>';

  const matchHeader = '<div class="profile-match profile-match-head"><span>날짜</span><span>상대</span><span>맵</span><span>ELO</span><span>경기방식</span><span>메모</span></div>';

  $("profile").innerHTML = '<div class="profile-title"><div class="profile-identity">' + avatarMarkup(profile.name, profile.image) + '<div><strong>' + escapeHtml(profile.name) + '</strong><span>wr_id=' + profile.wrId + '</span></div></div></div>' +
    '<div class="profile-cards">' + cards.map((card) => '<div class="profile-card"><span>' + card[0] + '</span><strong>' + card[1] + '</strong><small>' + card[2] + '</small></div>').join("") + '</div>' +
    most +
    '<div class="profile-section profile-period-section"><h3>' + periodTitle + '</h3><div class="profile-table">' + matchHeader + rows + '</div></div>';
  bindImageFallbacks($("profile"));
  prepareAnalysis(profile);
}

function render(data) {
  renderPeriod(data);
  renderRaceRates(data);
  renderProfile(data);
}

async function load(name = "", refresh = false) {
  if (state.activeController) state.activeController.abort();
  const controller = new AbortController();
  state.activeController = controller;
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  const pages = 10;
  setSearchState("loading", refresh ? TXT.refreshing : TXT.loading);
  resetResultPanels("검색 결과를 확인하고 있습니다.", "search-loading");
  const params = new URLSearchParams({ pages: String(pages) });
  if (name) params.set("name", name);
  if (refresh) params.set("refresh", "1");
  if (cleanName(name) === cleanName(DEFAULT_NAME) && !refresh) {
    params.set("profileOnly", "1");
    params.set("wr_id", DEFAULT_WR_ID);
  }

  const data = await fetchSearchJson("/api/data?" + params.toString(), controller.signal);
  if (requestId !== state.requestId) return;

  state.query = name;
  state.data = data;
  render(data);
  saveSearchSession();
  const when = new Date(data.fetchedAt).toLocaleString("ko-KR");
  if (name && (!data.profile || data.resultState === "empty")) {
    setSearchState("empty", TXT.noResult);
  } else {
    const successMessage = data.profileOnly
      ? when + " " + TXT.basis + " \u00b7 " + (data.profile?.name || name) + " \ud504\ub85c\ud544 \uc804\uc801\uc744 \uc77d\uc5c8\uc2b5\ub2c8\ub2e4."
      : when + " " + TXT.basis + " \u00b7 " + TXT.pagesFrom + " " + data.pagesLoaded + TXT.pagesUnit + " " + data.matches.length + TXT.readUnit;
    setSearchState("success", successMessage + autoDiaryStatusSuffix(data.autoDiarySync));
  }
}

async function search(refresh = false) {
  const expectedRequestId = state.requestId + 1;
  try {
    await load($("nameInput").value.trim(), refresh);
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (expectedRequestId !== state.requestId) return;
    const errorMessage = error.message || TXT.loadFail;
    setSearchState("error", errorMessage);
    resetResultPanels(errorMessage);
    $("profile").innerHTML = '<div class="empty search-error">' +
      escapeHtml(errorMessage) +
      '<button id="retrySearch" class="ghost" type="button">다시 시도</button></div>';
    $("retrySearch").addEventListener("click", () => search(true), { once: true });
  } finally {
    if (expectedRequestId === state.requestId) {
      $("searchButton").disabled = false;
      $("refreshButton").disabled = false;
    }
  }
}

$("searchButton").addEventListener("click", () => search(false));
$("refreshButton").addEventListener("click", () => search(true));
$("analysisButton").addEventListener("click", () => loadPlayerAnalysis(true));
$("analysisLoginButton").addEventListener("click", loginAnalysisAdmin);
$("communitySaveButton").addEventListener("click", saveCommunitySummary);
document.querySelector(".analysis-admin").addEventListener("toggle", (event) => {
  if (event.target.open) refreshAnalysisAdminStatus();
});
$("analysisAdminPassword").addEventListener("keydown", (event) => {
  if (event.key === "Enter") loginAnalysisAdmin();
});
$("nameInput").addEventListener("keydown", (event) => { if (event.key === "Enter") search(false); });
$("yearSelect").addEventListener("change", (event) => {
  state.selectedYear = event.target.value;
  state.selectedMonth = "";
  render(state.data);
  saveSearchSession();
});
$("monthSelect").addEventListener("change", (event) => {
  state.selectedMonth = event.target.value;
  render(state.data);
  saveSearchSession();
});
if (!restoreSearchSession()) {
  if (!$("nameInput").value.trim()) $("nameInput").value = DEFAULT_NAME;
  search(false);
}
