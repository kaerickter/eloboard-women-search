(() => {
  function setupTournamentMenu() {
    const link = document.querySelector('.site-nav a.cup-tab[href$="jungman-cup.html"]');
    if (!link) return;
    const nav = link.closest('.site-nav');
    const wrapper = document.createElement('div');
    wrapper.className = 'tournament-menu';
    link.before(wrapper);
    wrapper.append(link);

    const isCupPage = location.pathname.endsWith('/jungman-cup.html');
    const isBracketPage = location.pathname.endsWith('/tournament-bracket.html');
    link.textContent = '대회';
    link.href = './tournament-bracket.html';
    link.setAttribute('aria-haspopup', 'true');
    link.setAttribute('aria-expanded', 'false');
    if (isCupPage) link.removeAttribute('aria-current');
    if (isBracketPage) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }

    const submenu = document.createElement('div');
    submenu.className = 'tournament-submenu';
    submenu.setAttribute('aria-label', '대회 하위 메뉴');
    submenu.innerHTML = '<a href="./jungman-cup.html">K-중만컵</a><a href="./tournament-bracket.html">대진표</a>';
    submenu.querySelector(isCupPage ? 'a:first-child' : isBracketPage ? 'a:last-child' : 'a:first-child')
      ?.classList.toggle('is-current', isCupPage || isBracketPage);
    if (isCupPage) submenu.querySelector('a:first-child').setAttribute('aria-current', 'page');
    if (isBracketPage) submenu.querySelector('a:last-child').setAttribute('aria-current', 'page');
    wrapper.append(submenu);

    const open = () => { nav.classList.add('tournament-nav-open'); link.setAttribute('aria-expanded', 'true'); };
    const close = () => { nav.classList.remove('tournament-nav-open'); link.setAttribute('aria-expanded', 'false'); };
    wrapper.addEventListener('mouseenter', open);
    wrapper.addEventListener('mouseleave', close);
    wrapper.addEventListener('focusin', open);
    wrapper.addEventListener('focusout', () => window.setTimeout(() => {
      if (!wrapper.contains(document.activeElement)) close();
    }, 0));
    wrapper.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { close(); link.focus(); }
    });
  }

  function setupCalculatorMenu() {
    const link = document.querySelector('.site-nav a.site-tab[href$="match-scoreboard.html"]');
    if (!link || link.closest('.calculator-menu')) return;
    const nav = link.closest('.site-nav');
    const wrapper = document.createElement('div');
    wrapper.className = 'tournament-menu calculator-menu';
    link.before(wrapper);
    wrapper.append(link);

    const isFundingPage = location.pathname.endsWith('/funding-distributor.html');
    const isIntensePage = location.pathname.endsWith('/pubg-intense.html');
    if (isFundingPage || isIntensePage) {
      link.classList.add('active');
      link.removeAttribute('aria-current');
    }
    link.setAttribute('aria-haspopup', 'true');
    link.setAttribute('aria-expanded', 'false');

    const submenu = document.createElement('div');
    submenu.className = 'tournament-submenu calculator-submenu';
    submenu.setAttribute('aria-label', '점수계산기 하위 메뉴');
    submenu.innerHTML = '<a href="./match-scoreboard.html">점수계산기</a><a href="./pubg-intense.html">배그 인텐스모드</a>';
    const current = submenu.querySelector(isIntensePage ? 'a:last-child' : 'a:first-child');
    if (link.classList.contains('active') && !isFundingPage) {
      current.classList.add('is-current');
      current.setAttribute('aria-current', 'page');
    }
    wrapper.append(submenu);
    const open = () => { nav.classList.add('tournament-nav-open'); link.setAttribute('aria-expanded', 'true'); };
    const close = () => { nav.classList.remove('tournament-nav-open'); link.setAttribute('aria-expanded', 'false'); };
    wrapper.addEventListener('mouseenter', open);
    wrapper.addEventListener('mouseleave', close);
    wrapper.addEventListener('focusin', open);
    wrapper.addEventListener('focusout', () => window.setTimeout(() => {
      if (!wrapper.contains(document.activeElement)) close();
    }, 0));
    wrapper.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { close(); link.focus(); }
    });
  }

  function setupBroadcastMenu() {
    const nav = document.querySelector('.site-nav');
    if (!nav || nav.querySelector('a[href="/solo/"]')) return;
    const link = document.createElement('a');
    link.className = 'site-tab';
    link.href = '/solo/';
    link.textContent = '이아깽 방송기록 🔒';
    nav.append(link);
  }

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = './tournament-nav.css?v=20261105-shared-dropdown';
  document.head.append(css);
  function setupMenus() { setupTournamentMenu(); setupCalculatorMenu(); setupBroadcastMenu(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupMenus);
  else setupMenus();
})();
