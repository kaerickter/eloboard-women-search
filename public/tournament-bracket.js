(() => {
  const API = '/api/tournament-bracket-state';
  const rounds = { r16: 8, qf: 4, sf: 2, final: 1 };
  const centers = { r16: [120, 302, 484, 666], qf: [211, 575], sf: [393], final: [393] };
  const columns = [
    { id: 'left-r16', label: '16강', round: 'r16', matches: [0, 1, 2, 3] },
    { id: 'left-qf', label: '8강', round: 'qf', matches: [0, 1] },
    { id: 'left-sf', label: '4강', round: 'sf', matches: [0] },
    { id: 'final', label: '결승', round: 'final', matches: [0] },
    { id: 'right-sf', label: '4강', round: 'sf', matches: [1] },
    { id: 'right-qf', label: '8강', round: 'qf', matches: [2, 3] },
    { id: 'right-r16', label: '16강', round: 'r16', matches: [4, 5, 6, 7] }
  ];
  const grid = document.getElementById('bracketGrid');
  const editor = document.getElementById('bracketEditor');
  const status = document.getElementById('bracketStatus');
  const editStatus = document.getElementById('editStatus');
  const manageButton = document.getElementById('editBracket');
  const saveButton = document.getElementById('saveBracket');
  const titleInput = document.getElementById('titleInput');
  const subtitleInput = document.getElementById('subtitleInput');
  let draft = blankState();
  let version = 0;
  let dirty = false;
  let saving = false;
  let pollInFlight = false;

  function blankState() {
    return { title: '', subtitle: '', players: Array(16).fill(''), winners: {
      r16: Array(8).fill(null), qf: Array(4).fill(null), sf: Array(2).fill(null), final: [null]
    } };
  }

  function normalize(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const text = (value, length) => String(value ?? '').trim().slice(0, length);
    return {
      title: text(source.title, 48),
      subtitle: text(source.subtitle, 80),
      players: Array.from({ length: 16 }, (_, index) => text(source.players?.[index], 32)),
      winners: Object.fromEntries(Object.entries(rounds).map(([round, count]) => [round,
        Array.from({ length: count }, (_, index) => [0, 1].includes(source.winners?.[round]?.[index])
          ? source.winners[round][index] : null)]))
    };
  }

  function playerAt(round, match, side) {
    if (round === 'r16') return draft.players[match * 2 + side] || '';
    const previous = { qf: 'r16', sf: 'qf', final: 'sf' }[round];
    return winnerAt(previous, match * 2 + side);
  }

  function winnerAt(round, match) {
    const choice = draft.winners[round][match];
    return choice === 0 || choice === 1 ? playerAt(round, match, choice) : '';
  }

  function clearFollowing(round, match) {
    if (round === 'r16') { draft.winners.qf[Math.floor(match / 2)] = null; round = 'qf'; match = Math.floor(match / 2); }
    if (round === 'qf') { draft.winners.sf[Math.floor(match / 2)] = null; round = 'sf'; match = Math.floor(match / 2); }
    if (round === 'sf') draft.winners.final[0] = null;
  }

  function renderBracket() {
    grid.replaceChildren();
    for (const column of columns) {
      const columnEl = document.createElement('div');
      columnEl.className = 'round-column' + (column.round === 'final' ? ' final-column' : '');
      columnEl.dataset.column = column.id;
      const heading = document.createElement('h2');
      heading.textContent = column.label;
      columnEl.append(heading);
      column.matches.forEach((match, visualIndex) => {
        const card = document.createElement('div');
        card.className = 'match' + (column.round === 'final' ? ' is-final' : '');
        card.dataset.match = `${column.round}-${match}`;
        card.style.top = `${centers[column.round][visualIndex]}px`;
        for (let side = 0; side < 2; side += 1) {
          const name = playerAt(column.round, match, side);
          const slot = document.createElement('button');
          slot.type = 'button';
          slot.className = 'match-slot' + (!name ? ' is-empty' : '') +
            (name && draft.winners[column.round][match] === side ? ' is-winner' : '');
          slot.disabled = editor.hidden || !name;
          slot.setAttribute('aria-label', `${column.label} ${match + 1}경기 ${name || '선수 미정'}${name ? ' 승리 선택' : ''}`);
          const playerName = document.createElement('span');
          playerName.textContent = name || '선수 미정';
          slot.append(playerName);
          if (name && draft.winners[column.round][match] === side) {
            const crown = document.createElement('b');
            crown.textContent = '✦';
            crown.setAttribute('aria-hidden', 'true');
            slot.append(crown);
          }
          slot.addEventListener('click', () => {
            if (editor.hidden || !name) return;
            draft.winners[column.round][match] = draft.winners[column.round][match] === side ? null : side;
            clearFollowing(column.round, match);
            markDirty();
            renderView();
          });
          card.append(slot);
        }
        columnEl.append(card);
      });
      grid.append(columnEl);
    }
    const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    lines.classList.add('bracket-connectors');
    lines.setAttribute('aria-hidden', 'true');
    grid.prepend(lines);
    requestAnimationFrame(drawConnectors);
  }

  function drawConnectors() {
    const svg = grid.querySelector('.bracket-connectors');
    if (!svg) return;
    svg.replaceChildren();
    const frame = grid.getBoundingClientRect();
    if (!frame.width) return;
    svg.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
    const pair = (fromColumn, fromMatch, toColumn, toMatch, leftToRight) => {
      const from = grid.querySelector(`[data-column="${fromColumn}"] [data-match="${fromMatch}"]`)?.getBoundingClientRect();
      const to = grid.querySelector(`[data-column="${toColumn}"] [data-match="${toMatch}"]`)?.getBoundingClientRect();
      if (!from || !to) return;
      const x1 = (leftToRight ? from.right : from.left) - frame.left;
      const x2 = (leftToRight ? to.left : to.right) - frame.left;
      const y1 = from.top + from.height / 2 - frame.top;
      const y2 = to.top + to.height / 2 - frame.top;
      const middle = (x1 + x2) / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} H ${middle} V ${y2} H ${x2}`);
      svg.append(path);
    };
    for (let i = 0; i < 4; i += 1) pair('left-r16', `r16-${i}`, 'left-qf', `qf-${Math.floor(i / 2)}`, true);
    for (let i = 0; i < 2; i += 1) pair('left-qf', `qf-${i}`, 'left-sf', 'sf-0', true);
    pair('left-sf', 'sf-0', 'final', 'final-0', true);
    for (let i = 4; i < 8; i += 1) pair('right-r16', `r16-${i}`, 'right-qf', `qf-${Math.floor(i / 2)}`, false);
    for (let i = 2; i < 4; i += 1) pair('right-qf', `qf-${i}`, 'right-sf', 'sf-1', false);
    pair('right-sf', 'sf-1', 'final', 'final-0', false);
  }

  function renderView() {
    const title = draft.title || '대진표';
    document.getElementById('tournamentTitle').textContent = title;
    document.getElementById('tournamentSubtitle').textContent = draft.subtitle || '16명이 결승까지 올라가는 토너먼트';
    document.title = `${title} · 대진표`;
    document.getElementById('championName').textContent = winnerAt('final', 0) || '우승자 미정';
    renderBracket();
  }

  function createPlayerInputs() {
    for (let index = 0; index < 16; index += 1) {
      const label = document.createElement('label');
      const number = document.createElement('span');
      number.textContent = `${index % 8 + 1}번`;
      const input = document.createElement('input');
      input.maxLength = 32;
      input.placeholder = '선수 이름';
      input.autocomplete = 'off';
      input.dataset.player = String(index);
      input.addEventListener('input', () => {
        draft.players[index] = input.value;
        draft.winners.r16[Math.floor(index / 2)] = null;
        clearFollowing('r16', Math.floor(index / 2));
        markDirty();
        renderView();
      });
      label.append(number, input);
      document.getElementById(index < 8 ? 'leftPlayers' : 'rightPlayers').append(label);
    }
  }

  function fillEditor() {
    titleInput.value = draft.title;
    subtitleInput.value = draft.subtitle;
    document.querySelectorAll('[data-player]').forEach((input) => {
      input.value = draft.players[Number(input.dataset.player)];
    });
  }

  function markDirty() {
    dirty = true;
    editStatus.textContent = '변경 내용이 아직 저장되지 않았습니다.';
    status.textContent = '저장 전 변경 사항';
  }

  async function fetchState() {
    const response = await fetch(API, { cache: 'no-store' });
    if (!response.ok) throw new Error('공용 대진표를 불러오지 못했습니다.');
    return response.json();
  }

  async function loadState(initial = false) {
    if (pollInFlight || saving || dirty || !editor.hidden) return;
    pollInFlight = true;
    try {
      const result = await fetchState();
      if (saving || dirty || !editor.hidden) return;
      const nextVersion = Number(result.version) || 0;
      if (!initial && nextVersion <= version) return;
      draft = normalize(result.state);
      version = nextVersion;
      renderView();
      status.textContent = result.state ? '다른 화면과 동기화됨' : '새 대진표 · 대회명을 입력해 주세요';
    } catch (error) {
      if (initial) status.textContent = error.message;
    } finally {
      pollInFlight = false;
    }
  }

  async function saveState() {
    if (saving) return;
    saving = true;
    saveButton.disabled = true;
    editStatus.textContent = '공용 대진표에 저장하는 중…';
    try {
      const response = await fetch(API, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: normalize(draft), expectedVersion: version })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '대진표를 저장하지 못했습니다.');
      version = Number(result.version) || version + 1;
      draft = normalize(draft);
      dirty = false;
      editStatus.textContent = '공용 대진표에 저장했습니다.';
      status.textContent = '저장 완료 · 다른 화면에도 반영됩니다';
      fillEditor();
      renderView();
    } catch (error) {
      editStatus.textContent = `${error.message} 현재 입력 내용은 이 화면에 남아 있습니다.`;
      status.textContent = '저장 실패';
    } finally {
      saving = false;
      saveButton.disabled = false;
    }
  }

  manageButton.addEventListener('click', () => {
    if (!editor.hidden && dirty) { editStatus.textContent = '변경 내용을 저장한 뒤 관리창을 닫을 수 있습니다.'; return; }
    editor.hidden = !editor.hidden;
    manageButton.setAttribute('aria-expanded', String(!editor.hidden));
    manageButton.textContent = editor.hidden ? '대진표 관리' : '관리창 닫기';
    if (!editor.hidden) fillEditor();
    renderView();
  });
  titleInput.addEventListener('input', () => { draft.title = titleInput.value; markDirty(); renderView(); });
  subtitleInput.addEventListener('input', () => { draft.subtitle = subtitleInput.value; markDirty(); renderView(); });
  saveButton.addEventListener('click', saveState);
  window.addEventListener('resize', drawConnectors);
  createPlayerInputs();
  renderView();
  void loadState(true);
  window.setInterval(() => { void loadState(); }, 3000);
})();
