const $ = (id) => document.getElementById(id);
const DEFAULT_NAME = "\uc774\uc544\uae7d";
// 새 ELOBoard 선수 ID: 이아깽(기존 wr_id 780 → 현재 선수 ID 627)
const DEFAULT_WR_ID = "627";
const SEARCH_SESSION_KEY = "record-search-session-v2";
const state = {
  query: "",
  data: null,
  selectedYear: "",
  selectedMonth: "",
  requestId: 0,
  activeController: null
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
    const savedName = String(saved.name || DEFAULT_NAME).trim();
    setSearchState("success", "이전 검색 결과를 표시한 뒤 최신 전적을 확인합니다.");
    // 검색했던 선수가 누구든 오래된 브라우저 저장본에 머물지 않도록 최신 API 결과로 교체합니다.
    if (savedName) setTimeout(() => { load(savedName, true, true).catch(() => {}); }, 0);
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
    const result = matchOutcome(row);
    if (result === "승") wins += 1;
    else if (result === "패") losses += 1;
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
}

// 새 ELOBoard는 승패 결과를 별도 값으로 제공합니다. 색상과 기간 통계는
// 점수 증감이 아니라 이 결과값을 우선 사용해야 무승부·이관 경기에도 정확합니다.
function matchOutcome(match) {
  const result = String(match?.result || "").trim();
  if (result === "승" || result === "패" || result === "무") return result;
  const elo = Number(match?.elo || 0);
  return elo > 0 ? "승" : elo < 0 ? "패" : "무";
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
    const parsedOverall = data && data.profile && data.profile.raceTotals
      ? data.profile.raceTotals.combined && data.profile.raceTotals.combined[race]
      : null;
    const officialOverall = parsedOverall && Number(parsedOverall.games) > 0 ? parsedOverall : null;
    const values = {
      Overall: officialOverall || periodStats(raceRows),
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
    if (cleanName(state.query) === cleanName(DEFAULT_NAME)) {
      $("profile").innerHTML = '<div class="empty">선수 전적을 찾지 못했습니다.</div>';
    } else {
      $("profile").innerHTML = '<div class="empty">' + TXT.noProfile + '</div>';
    }
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
    const result = matchOutcome(match);
    const resultClass = result === "승" ? "result-win" : result === "패" ? "result-loss" : "";
    const deltaClass = result === "승" ? "delta-plus" : result === "패" ? "delta-minus" : "";
    const memo = escapeHtml(match.memo || "-");
    return '<div class="profile-match ' + resultClass + '"><span data-label="날짜">' + match.date + '</span><strong data-label="상대">' + escapeHtml(match.opponent) + '</strong><span data-label="맵">' + escapeHtml(match.map) + '</span><span data-label="결과" class="' + deltaClass + '">' + escapeHtml(result) + '</span><span data-label="경기방식">' + escapeHtml(match.format) + '</span><span data-label="메모" class="profile-match-memo" title="' + memo + '">' + memo + '</span></div>';
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

  const matchHeader = '<div class="profile-match profile-match-head"><span>날짜</span><span>상대</span><span>맵</span><span>결과</span><span>경기방식</span><span>메모</span></div>';

  $("profile").innerHTML = '<div class="profile-title"><div class="profile-identity">' + avatarMarkup(profile.name, profile.image) + '<div><strong>' + escapeHtml(profile.name) + '</strong><span>선수 ID=' + profile.wrId + '</span></div></div></div>' +
    '<div class="profile-cards">' + cards.map((card) => '<div class="profile-card"><span>' + card[0] + '</span><strong>' + card[1] + '</strong><small>' + card[2] + '</small></div>').join("") + '</div>' +
    most +
    '<div class="profile-section profile-period-section"><h3>' + periodTitle + '</h3><div class="profile-table">' + matchHeader + rows + '</div></div>';
  bindImageFallbacks($("profile"));
  renderIakkangMatchupPanel(profile);
}

function renderIakkangMatchupPanel(profile) {
  const panel = $("iakkangMatchupPanel");
  const input = $("iakkangOpponentInput");
  const result = $("iakkangMatchupResult");
  const title = $("iakkangMatchupTitle");
  if (!panel || !input || !result) return;
  panel.hidden = !profile?.wrId;
  if (!profile?.wrId) return;
  if (title) title.textContent = profile.name + " 상대전적";
  let requestId = 0;
  const render = async () => {
    const query = cleanName(input.value);
    if (!query) {
      result.innerHTML = '상대 이름을 입력하면 전체전적과 최근 90일 전적을 표시합니다.';
      return;
    }
    const currentRequest = ++requestId;
    result.innerHTML = '상대전적을 불러오는 중입니다.';
    try {
      const payload = await requestJson('/api/player-rival?player_id=' + encodeURIComponent(profile.wrId) + '&opponent=' + encodeURIComponent(input.value.trim()));
      if (currentRequest !== requestId) return;
      const overall = payload.overall;
      const recent = payload.recent90 || { games: 0, wins: 0, losses: 0, rate: 0 };
      if (!overall && !recent.games) {
        result.innerHTML = '<div class="empty">해당 상대와의 전적을 찾지 못했습니다.</div>';
        return;
      }
      const race = payload.opponentRace ? ' (' + escapeHtml(payload.opponentRace) + ')' : '';
      const recordText = (record) => record ? record.games + '전 ' + record.wins + '승 ' + record.losses + '패 · ' + record.rate + '%' : '데이터 부족';
      result.innerHTML = '<div class="iakkang-matchup-summary"><strong>' + escapeHtml(payload.opponentName) + race + '</strong></div>' +
        '<div class="matchup-record-pairs"><div><span>전체전적</span><b>' + recordText(overall) + '</b></div><div><span>최근 90일</span><b>' + recordText(recent) + '</b></div></div>' +
        (payload.recentMatches?.length ? '<div class="iakkang-matchup-list">' + payload.recentMatches.map((match) => { const matchResult = match.result || (Number(match.elo) > 0 ? '승' : Number(match.elo) < 0 ? '패' : '무'); const resultClass = matchResult === '승' ? 'delta-plus' : matchResult === '패' ? 'delta-minus' : ''; return '<div><span>' + escapeHtml(match.date) + '</span><span class="' + resultClass + '">' + escapeHtml(matchResult) + '</span><strong>' + escapeHtml(match.map || '-') + '</strong><small>' + escapeHtml(match.format || '-') + '</small></div>'; }).join("") + '</div>' : '');
    } catch (error) {
      if (currentRequest === requestId) result.innerHTML = '<div class="empty">' + escapeHtml(error.message || '상대전적을 불러오지 못했습니다.') + '</div>';
    }
  };
  input.value = "";
  input.oninput = render;
  render();
}

function render(data) {
  renderPeriod(data);
  renderRaceRates(data);
  renderProfile(data);
}

async function load(name = "", refresh = false, silent = false) {
  if (state.activeController) state.activeController.abort();
  const controller = new AbortController();
  state.activeController = controller;
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  const pages = 10;
  if (!silent) {
    setSearchState("loading", refresh ? TXT.refreshing : TXT.loading);
    resetResultPanels("검색 결과를 확인하고 있습니다.", "search-loading");
  }
  const params = new URLSearchParams({ pages: String(pages) });
  if (name) params.set("name", name);
  if (refresh) params.set("refresh", "1");
  if (cleanName(name) === cleanName(DEFAULT_NAME)) {
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
    if (data.cacheNotice) {
      setSearchState("success", data.cacheNotice);
      return;
    }
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
