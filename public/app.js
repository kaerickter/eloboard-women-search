const $ = (id) => document.getElementById(id);
const DEFAULT_NAME = "\uc774\uc544\uae7d";
const DEFAULT_WR_ID = "780";
const state = { query: "", data: null, selectedYear: "", selectedMonth: "", opponentQuery: "", requestId: 0 };

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

function sortedYears(rows) {
  return [...new Set(rows.map((row) => String(row.date || "").slice(0, 4)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
}

function sortedMonths(rows, year) {
  return [...new Set(rows
    .filter((row) => String(row.date || "").startsWith(year + "-"))
    .map((row) => String(row.date || "").slice(5, 7))
    .filter(Boolean))]
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

function setSelectOptions(select, values, suffix) {
  select.innerHTML = values.map((value) => '<option value="' + value + '">' + value + suffix + '</option>').join("");
}

function selectedMonthRows(rows) {
  if (!state.selectedYear || !state.selectedMonth) return rows;
  const prefix = state.selectedYear + "-" + state.selectedMonth;
  return rows.filter((row) => String(row.date || "").startsWith(prefix));
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

function setOpponentStats(stats, label) {
  $("opponentLabel").textContent = label;
  $("opponentGames").textContent = stats.games;
  $("opponentWins").textContent = stats.wins;
  $("opponentLosses").textContent = stats.losses;
  $("opponentRate").textContent = stats.rate + "%";
}

function renderOpponent(data) {
  const rows = getProfileRows(data);
  const query = cleanName(state.opponentQuery || $("opponentInput").value);
  if (!rows.length || !query) {
    setOpponentStats({ games: 0, wins: 0, losses: 0, rate: 0 }, query ? TXT.noData : TXT.opponentReady);
    return;
  }

  const matches = recentRows(rows, 90).filter((row) => cleanName(row.opponent).includes(query));
  const stats = periodStats(matches);
  const label = stats.games
    ? state.opponentQuery + " \u00b7 " + TXT.recent90Basis
    : TXT.opponentNoData;
  setOpponentStats(stats, label);
}

function renderPeriod(data) {
  const rows = getProfileRows(data);
  const years = sortedYears(rows);
  const yearSelect = $("yearSelect");
  const monthSelect = $("monthSelect");

  if (!years.length) {
    state.selectedYear = "";
    state.selectedMonth = "";
    yearSelect.innerHTML = "";
    monthSelect.innerHTML = "";
    $("periodLabel").textContent = TXT.noPeriod;
    $("yearRowLabel").textContent = "\ud574\ub2f9\ub144\ub3c4";
    $("monthRowLabel").textContent = "\ub2f9\uc6d4";
    $("yearGames").textContent = "0";
    $("yearWins").textContent = "0";
    $("yearLosses").textContent = "0";
    $("yearRate").textContent = "0%";
    $("monthGames").textContent = "0";
    $("monthWins").textContent = "0";
    $("monthLosses").textContent = "0";
    $("monthRate").textContent = "0%";
    return;
  }

  if (!years.includes(state.selectedYear)) state.selectedYear = years[0];
  const months = sortedMonths(rows, state.selectedYear);
  if (!months.includes(state.selectedMonth)) state.selectedMonth = months[0] || "";

  setSelectOptions(yearSelect, years, TXT.yearSuffix);
  setSelectOptions(monthSelect, months, TXT.monthSuffix);
  yearSelect.value = state.selectedYear;
  monthSelect.value = state.selectedMonth;
  $("yearRowLabel").textContent = state.selectedYear + TXT.yearSuffix;
  $("monthRowLabel").textContent = displayMonth(state.selectedMonth) + TXT.monthSuffix;

  const yearRows = rows.filter((row) => String(row.date || "").startsWith(state.selectedYear + "-"));
  const monthRows = rows.filter((row) => String(row.date || "").startsWith(state.selectedYear + "-" + state.selectedMonth));
  const year = periodStats(yearRows);
  const month = periodStats(monthRows);

  $("periodLabel").textContent = (data.profile.name || state.query) + " \u00b7 " + TXT.periodBasis;
  $("yearGames").textContent = year.games;
  $("yearWins").textContent = year.wins;
  $("yearLosses").textContent = year.losses;
  $("yearRate").textContent = year.rate + "%";
  $("monthGames").textContent = month.games;
  $("monthWins").textContent = month.wins;
  $("monthLosses").textContent = month.losses;
  $("monthRate").textContent = month.rate + "%";
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
    return;
  }

  $("profileLink").innerHTML = '<a class="detail-link" href="' + profile.url + '" target="_blank" rel="noreferrer">' + TXT.profileOpen + '</a>';
  const cards = [
    profile.total ? [TXT.total, profile.total.games + TXT.gameWord, profile.total.wins + TXT.win + " " + profile.total.losses + TXT.loss + " \u00b7 " + profile.total.rate + "%"] : null,
    profile.women ? [TXT.women, profile.women.games + TXT.gameWord, profile.women.wins + TXT.win + " " + profile.women.losses + TXT.loss + " \u00b7 " + profile.women.rate + "%"] : null,
    profile.mixed ? [TXT.mixed, profile.mixed.games + TXT.gameWord, profile.mixed.wins + TXT.win + " " + profile.mixed.losses + TXT.loss + " \u00b7 " + profile.mixed.rate + "%"] : null,
    profile.recent30 ? [TXT.recent30, profile.recent30.games + TXT.gameWord, profile.recent30.wins + TXT.win + " " + profile.recent30.losses + TXT.loss] : null
  ].filter(Boolean);

  const most = (profile.mostMatches || []).length
    ? '<div class="profile-section"><h3>' + TXT.most + '</h3><div class="pill-row">' + profile.mostMatches.map((item) => '<a class="pill" href="' + item.url + '" target="_blank" rel="noreferrer">' + escapeHtml(item.name) + ' ' + item.wins + TXT.win + ' ' + item.losses + TXT.loss + '</a>').join("") + '</div></div>'
    : "";

  const periodRows = selectedMonthRows(profile.matches || []);
  const periodTitle = state.selectedYear && state.selectedMonth
    ? state.selectedYear + TXT.yearSuffix + " " + state.selectedMonth + TXT.monthSuffix + " " + TXT.profileMatches
    : TXT.profileMatches;
  const rows = periodRows.length
    ? periodRows.map((match) => {
      const resultClass = match.elo >= 0 ? "result-win" : "result-loss";
      const deltaClass = match.elo >= 0 ? "delta-plus" : "delta-minus";
      return '<div class="profile-match ' + resultClass + '"><span>' + match.date + '</span><strong>' + escapeHtml(match.opponent) + '</strong><span>' + escapeHtml(match.map) + '</span><span class="' + deltaClass + '">' + escapeHtml(match.eloText) + '</span><span>' + escapeHtml(match.format) + '</span></div>';
    }).join("")
    : '<div class="empty">' + TXT.noData + '</div>';

  $("profile").innerHTML = '<div class="profile-title"><strong>' + escapeHtml(profile.name) + '</strong><span>wr_id=' + profile.wrId + '</span></div>' +
    '<div class="profile-cards">' + cards.map((card) => '<div class="profile-card"><span>' + card[0] + '</span><strong>' + card[1] + '</strong><small>' + card[2] + '</small></div>').join("") + '</div>' +
    most +
    '<div class="profile-section"><h3>' + periodTitle + '</h3><div class="profile-table">' + rows + '</div></div>';
}

function render(data) {
  renderPeriod(data);
  renderOpponent(data);
  renderProfile(data);
}

async function load(name = "", refresh = false) {
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  const pages = Math.min(Math.max(Number($("pageInput").value) || 10, 1), 40);
  $("pageInput").value = pages;
  $("status").textContent = refresh ? TXT.refreshing : TXT.loading;
  const params = new URLSearchParams({ pages: String(pages) });
  if (name) params.set("name", name);
  if (refresh) params.set("refresh", "1");
  if (cleanName(name) === cleanName(DEFAULT_NAME) && !refresh) {
    params.set("profileOnly", "1");
    params.set("wr_id", DEFAULT_WR_ID);
  }

  const response = await fetch("/api/data?" + params.toString());
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || TXT.loadFail);
  if (requestId !== state.requestId) return;

  state.query = name;
  state.data = data;
  render(data);
  const when = new Date(data.fetchedAt).toLocaleString("ko-KR");
  $("status").textContent = data.profileOnly
    ? when + " " + TXT.basis + " \u00b7 " + (data.profile?.name || name) + " \ud504\ub85c\ud544 \uc804\uc801\uc744 \uc77d\uc5c8\uc2b5\ub2c8\ub2e4."
    : when + " " + TXT.basis + " \u00b7 " + TXT.pagesFrom + " " + data.pagesLoaded + TXT.pagesUnit + " " + data.matches.length + TXT.readUnit;
}

async function search(refresh = false) {
  try {
    await load($("nameInput").value.trim(), refresh);
  } catch (error) {
    $("status").textContent = error.message;
  }
}

$("searchButton").addEventListener("click", () => search(false));
$("refreshButton").addEventListener("click", () => search(true));
$("nameInput").addEventListener("keydown", (event) => { if (event.key === "Enter") search(false); });
$("pageInput").addEventListener("keydown", (event) => { if (event.key === "Enter") search(false); });
$("opponentInput").addEventListener("input", (event) => {
  state.opponentQuery = event.target.value.trim();
  renderOpponent(state.data);
});
$("yearSelect").addEventListener("change", (event) => {
  state.selectedYear = event.target.value;
  state.selectedMonth = "";
  render(state.data);
});
$("monthSelect").addEventListener("change", (event) => {
  state.selectedMonth = event.target.value;
  render(state.data);
});
if (!$("nameInput").value.trim()) $("nameInput").value = DEFAULT_NAME;
load($("nameInput").value.trim() || DEFAULT_NAME).catch((error) => {
  $("status").textContent = error.message;
});
