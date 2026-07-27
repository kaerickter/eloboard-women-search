(() => {
  "use strict";

  const SOURCE_URL = "https://www.sooplive.com/station/ititit/post/202619457";
  const REFRESH_SECONDS = 5;
  const FALLBACK_RANKINGS = [
    { commentId: 118717285, nickname: "Calm_김윤환", userId: "brainzerg7", profileImage: "https://profile.img.sooplive.co.kr/LOGO/br/brainzerg7/brainzerg7.jpg", comment: "캄몬신청합니다", likes: 8711 },
    { commentId: 118716915, nickname: "기뉴다", userId: "arinbbidol", profileImage: "https://profile.img.sooplive.co.kr/LOGO/ar/arinbbidol/arinbbidol.jpg", comment: "뉴캣슬 신청합니다.", likes: 7545 },
    { commentId: 118716763, nickname: "s시조새s", userId: "superbsw123", profileImage: "https://profile.img.sooplive.co.kr/LOGO/su/superbsw123/superbsw123.jpg", comment: "JSA신청합니다.", likes: 4999 },
    { commentId: 118717105, nickname: "철구형2↑", userId: "y1026", profileImage: "https://profile.img.sooplive.co.kr/LOGO/y1/y1026/y1026.jpg", comment: "씨나인입니다! 한표씩 부탁드립니다!!", likes: 3648 },
    { commentId: 118717131, nickname: "[BJ]케이", userId: "zpdl1313", profileImage: "https://profile.img.sooplive.co.kr/LOGO/zp/zpdl1313/zpdl1313.jpg", comment: "케이대 참가신청합니다. 우승DNA 보여드리겠습니다!", likes: 2814 },
    { commentId: 118717495, nickname: "흑운장TV", userId: "firebathero", profileImage: "https://profile.img.sooplive.co.kr/LOGO/fi/firebathero/firebathero.jpg", comment: "흑카데미 신청합니다", likes: 2650 },
    { commentId: 118716771, nickname: ":설영욱", userId: "sulstyle00", profileImage: "https://profile.img.sooplive.co.kr/LOGO/su/sulstyle00/sulstyle00.jpg", comment: "신세계 참여합니다. 한표씩 부탁드립니다.", likes: 2470 },
    { commentId: 118716737, nickname: "혁민!", userId: "suhi370erw", profileImage: "https://profile.img.sooplive.co.kr/LOGO/su/suhi370erw/suhi370erw.jpg", comment: "HM 신청합니다!", likes: 2452 },
    { commentId: 118716687, nickname: "뽀현욱", userId: "jhw1729", profileImage: "https://profile.img.sooplive.co.kr/LOGO/jh/jhw1729/jhw1729.jpg", comment: "BGM 신청합니다.", likes: 2179 },
    { commentId: 118717391, nickname: "전태규", userId: "70jeontaekyu", profileImage: "https://profile.img.sooplive.co.kr/LOGO/70/70jeontaekyu/70jeontaekyu.jpg", comment: "DM 신청합니다. 와카전만큼은 피하고 싶습니다.", likes: 1792 },
    { commentId: 118717311, nickname: "虎마예준虎", userId: "tiger3006", profileImage: "https://profile.img.sooplive.co.kr/LOGO/ti/tiger3006/tiger3006.jpg", comment: "엠비대 신청합니다!", likes: 1739 },
    { commentId: 118717501, nickname: "BJ와이퍼♥", userId: "tkdduddb06", profileImage: "https://profile.img.sooplive.co.kr/LOGO/tk/tkdduddb06/tkdduddb06.jpg", comment: "와플대 신청합니다.", likes: 1078 }
  ];
  const state = { rankings: FALLBACK_RANKINGS, countdown: REFRESH_SECONDS, loading: false };

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

  function renderLeader() {
    const leader = state.rankings[0];
    const runnerUp = state.rankings[1];
    const avatar = document.getElementById("leaderAvatar");
    if (!leader) return;

    avatar.innerHTML = '<span class="vote-crown" aria-hidden="true">♛</span>' +
      (leader.profileImage
        ? '<img src="' + escapeHtml(leader.profileImage) + '" alt="">'
        : '<span class="vote-avatar-fallback">' + escapeHtml(leader.nickname.slice(0, 1)) + "</span>");
    document.getElementById("leaderNickname").textContent = leader.nickname;
    document.getElementById("leaderComment").textContent = leader.comment;
    document.getElementById("leaderLikes").textContent = "👍 " + number(leader.likes);
  document.getElementById("leaderGap").textContent = runnerUp
    ? "🔥 2위와 " + number(Number(leader.likes) - Number(runnerUp.likes)) + "표 차이"
    : "🏆 현재 단독 집계 중";
  }

  function updateSummary(fetchedAt) {
    document.getElementById("commentTotal").textContent = number(state.rankings.length);
    document.getElementById("likeTotal").textContent = number(
      state.rankings.reduce((sum, item) => sum + Number(item.likes || 0), 0)
    );
    document.getElementById("updatedAt").textContent = fetchedAt ? time(fetchedAt) : "연결 대기";
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
      updateSummary(data.fetchedAt);
      status.textContent = "약 5초마다 자동 갱신됩니다.";
      renderLeader();
      render();
    } catch {
      status.textContent = "저장된 최신 데이터를 표시 중입니다. 실시간 연결을 계속 재시도합니다.";
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

  updateSummary("");
  renderLeader();
  render();
  load(false);
})();
