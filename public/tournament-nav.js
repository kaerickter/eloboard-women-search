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

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = './tournament-nav.css?v=20261009';
  document.head.append(css);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupTournamentMenu);
  else setupTournamentMenu();
})();
