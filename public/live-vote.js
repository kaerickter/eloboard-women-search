(() => {
  "use strict";

  const SOURCE_URL = "https://www.sooplive.com/station/ititit/post/202619457";
  const REFRESH_SECONDS = 5;
  const state = { rankings: [], countdown: REFRESH_SECONDS, loading: false };

  const rows = document.getElementById("voteRows");
  const status = document.getElementById("voteStatus");
  const search = document.getElementById("voteSearch");
  const refresh = document.getElementById("refreshVote");
  const countdown = document.getElementById("refreshCountdown");

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function number(value) {
    return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
  }

  function time(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date(value));
  }

  function rankLabel(rank) {
    return ["🥇", "🥈", "🥉"][rank - 1] || rank;
  }

  function render() {
    const keyword = search.value.trim().toLocaleLowerCase("ko-KR");
    const visible = keyword
      ? state.rankings.filter((item) =>
          item.nickname.toLocaleLowerCase("ko-KR").includes(keyword) ||
          item.comment.toLocaleLowerCase("ko-KR").includes(keyword))
      : state.rankings;

    if (!visible.length) {
      rows.innerHTML = '<div class="vote-empty">' +
        (state.rankings.length ? "검색 결과가 없습니다." : "순위 데이터를 불러오고 있습니다.") +
        "</div>";
      return;
    }

    rows.innerHTML = visible.map((item) => {
      const rank = state.rankings.findIndex((candidate) => candidate.commentId === item.commentId) + 1;
      const avatar = item.profileImage
        ? '<img src="' + escapeHtml(item.profileImage) + '" alt="" loading="lazy">'
        : escapeHtml(item.nickname.slice(0, 1));
      return [
        '<article class="vote-row vote-rank-' + rank + '">',
        '<div class="vote-rank">' + rankLabel(rank) + "</div>",
        '<div class="vote-avatar">' + avatar + "</div>",
        '<div class="vote-copy">',
        '<div class="vote-nickname"><strong>' + escapeHtml(item.nickname) + "</strong><small>@" +
          escapeHtml(item.userId) + "</small></div>",
        "<p>" + escapeHtml(item.comment) + "</p>",
        "</div>",
        '<div class="vote-likes"><strong>👍 ' + number(item.likes) + "</strong><small>좋아요</small></div>",
        '<a class="vote-source" href="' + SOURCE_URL + "#comment_noti" + item.commentId +
          '" target="_blank" rel="noreferrer" aria-label="' + escapeHtml(item.nickname) +
          ' 댓글 원문 보기">↗</a>',
        "</article>"
      ].join("");
    }).join("");
  }

  async function load(force = false) {
    if (state.loading) return;
    state.loading = true;
    refresh.disabled = true;
    status.textContent = "최신 좋아요 수를 확인하고 있습니다.";
    try {
      const response = await fetch("/api/soop-vote-rankings" + (force ? "?refresh=1" : ""), {
        cache: "no-store"
      });
      if (!response.ok) throw new Error("데이터 응답 오류");
      const data = await response.json();
      state.rankings = Array.isArray(data.rankings) ? data.rankings : [];
      state.countdown = REFRESH_SECONDS;
      document.getElementById("commentTotal").textContent = number(state.rankings.length);
      document.getElementById("likeTotal").textContent = number(
        state.rankings.reduce((sum, item) => sum + Number(item.likes || 0), 0)
      );
      document.getElementById("updatedAt").textContent = time(data.fetchedAt);
      status.textContent = "약 5초마다 자동 갱신됩니다.";
      render();
    } catch {
      status.textContent = "실시간 데이터를 잠시 불러오지 못했습니다. 곧 다시 시도합니다.";
    } finally {
      state.loading = false;
      refresh.disabled = false;
    }
  }

  search.addEventListener("input", render);
  refresh.addEventListener("click", () => load(true));
  window.setInterval(() => load(false), REFRESH_SECONDS * 1000);
  window.setInterval(() => {
    state.countdown = state.countdown <= 1 ? REFRESH_SECONDS : state.countdown - 1;
    countdown.textContent = state.countdown + "초 후 갱신";
  }, 1000);

  load(false);
})();
