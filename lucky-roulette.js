const colors = ["#ff9aaa", "#ffe08a", "#9de6d5", "#9ec8ff", "#c8b6ff", "#ffc59f", "#b9efc5", "#ffb7d5"];

const canvas = document.querySelector("#wheel");
const ctx = canvas.getContext("2d");
const addItemInput = document.querySelector("#addItemInput");
const addItemButton = document.querySelector("#addItemButton");
const clearItemsButton = document.querySelector("#clearItemsButton");
const itemCards = document.querySelector("#itemCards");
const itemCount = document.querySelector("#itemCount");
const spinButton = document.querySelector("#spinButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const resultText = document.querySelector("#resultText");
const statusText = document.querySelector("#statusText");
const toast = document.querySelector("#toast");
const timerHours = document.querySelector("#timerHours");
const timerMinutes = document.querySelector("#timerMinutes");
const timerSeconds = document.querySelector("#timerSeconds");
const timerDisplay = document.querySelector("#timerDisplay");
const timerStartButton = document.querySelector("#timerStartButton");
const timerResetButton = document.querySelector("#timerResetButton");
const timeUpEffect = document.querySelector("#timeUpEffect");
const targetHour = document.querySelector("#targetHour");
const targetMinute = document.querySelector("#targetMinute");
const targetStartButton = document.querySelector("#targetStartButton");

let entries = [];
let items = [];
let rotation = 0;
let isSpinning = false;
let timerRemaining = 0;
let timerInterval = null;
let timerLastTick = 0;

function buildItems() {
  items = entries.flatMap((entry) => Array.from({ length: entry.count }, () => entry.name));
}

function percent(count) {
  if (!items.length) return "0%";
  return `${((count / items.length) * 100).toFixed(1)}%`;
}

function drawEmptyWheel(center, radius) {
  const gradient = ctx.createRadialGradient(center, center, radius * 0.2, center, center, radius);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(1, "#e9edf4");
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.lineWidth = 16;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#8a909b";
  ctx.font = "800 32px Pretendard, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("항목을 추가하세요", center, center);
}

function fitText(text, maxWidth, baseSize) {
  let size = baseSize;
  ctx.font = `800 ${size}px Pretendard, sans-serif`;
  while (ctx.measureText(text).width > maxWidth && size > 12) {
    size -= 1;
    ctx.font = `800 ${size}px Pretendard, sans-serif`;
  }
  return size;
}

function drawWheel() {
  const { width, height } = canvas;
  const center = width / 2;
  const radius = Math.min(width, height) / 2 - 22;

  ctx.clearRect(0, 0, width, height);

  if (!items.length) {
    drawEmptyWheel(center, radius);
    return;
  }

  const full = Math.PI * 2;
  let cursor = -Math.PI / 2;
  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(rotation);

  entries.forEach((entry, index) => {
    const slice = full * (entry.count / items.length);
    const start = cursor;
    const end = start + slice;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[index % colors.length];
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.save();
    ctx.rotate(start + slice / 2);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,0.2)";
    ctx.shadowBlur = 5;
    ctx.font = `800 ${fitText(entry.name, radius * 0.48, entries.length > 12 ? 18 : 28)}px Pretendard, sans-serif`;
    ctx.fillText(entry.name, radius - 28, 0);
    ctx.restore();
    cursor = end;
  });

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.lineWidth = 16;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.restore();
}

function makeIconButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderItemCards() {
  itemCount.textContent = `(${entries.length})`;

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = "아직 항목이 없습니다.";
    itemCards.replaceChildren(empty);
    return;
  }

  itemCards.replaceChildren(
    ...entries.map((entry) => {
      const card = document.createElement("div");
      const name = document.createElement("strong");
      const stepper = document.createElement("div");
      const count = document.createElement("span");
      const rate = document.createElement("small");

      card.className = "item-card";
      name.textContent = entry.name;
      stepper.className = "stepper";
      count.textContent = entry.count;
      rate.textContent = percent(entry.count);

      stepper.append(
        makeIconButton("−", "mini-button", () => changeCount(entry.name, -1)),
        count,
        makeIconButton("+", "mini-button", () => changeCount(entry.name, 1)),
      );

      card.append(
        name,
        stepper,
        makeIconButton("×", "delete-button", () => deleteEntry(entry.name)),
        rate,
      );
      return card;
    }),
  );
}

function updateState() {
  buildItems();
  spinButton.disabled = items.length < 2 || isSpinning;

  if (!items.length) {
    resultText.textContent = "항목을 추가하세요";
    statusText.textContent = "항목 이름을 입력하고 추가 버튼을 눌러주세요.";
  } else if (items.length < 2) {
    resultText.textContent = "한 칸 더 추가하세요";
    statusText.textContent = "룰렛을 돌리려면 최소 2칸이 필요합니다.";
  } else if (["항목을 추가하세요", "한 칸 더 추가하세요"].includes(resultText.textContent)) {
    resultText.textContent = "아직 돌리지 않았어요";
    statusText.textContent = `총 ${items.length}칸이 준비됐습니다.`;
  } else {
    statusText.textContent = `총 ${items.length}칸이 준비됐습니다.`;
  }

  renderItemCards();
  drawWheel();
}

function addEntry(name) {
  const existing = entries.find((entry) => entry.name === name);
  if (existing) {
    existing.count += 1;
  } else {
    entries.push({ name, count: 1 });
  }
  updateState();
}

function changeCount(name, delta) {
  const entry = entries.find((item) => item.name === name);
  if (!entry) return;
  entry.count += delta;
  if (entry.count <= 0) {
    entries = entries.filter((item) => item.name !== name);
  }
  updateState();
}

function deleteEntry(name) {
  entries = entries.filter((entry) => entry.name !== name);
  updateState();
}

function selectedEntry() {
  const full = Math.PI * 2;
  const pointerAngle = (full - (rotation % full)) % full;
  let cursor = 0;

  for (const entry of entries) {
    cursor += full * (entry.count / items.length);
    if (pointerAngle <= cursor) return entry;
  }

  return entries[entries.length - 1];
}

function spin() {
  if (isSpinning || items.length < 2) return;
  isSpinning = true;
  spinButton.disabled = true;
  resultText.textContent = "돌아가는 중...";

  const start = rotation;
  const extraTurns = 5 + Math.random() * 4;
  const target = start + Math.PI * 2 * extraTurns + Math.random() * Math.PI * 2;
  const duration = 4200;
  const startedAt = performance.now();

  function frame(now) {
    const elapsed = now - startedAt;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    rotation = start + (target - start) * eased;
    drawWheel();

    if (progress < 1) {
      requestAnimationFrame(frame);
      return;
    }

    const entry = selectedEntry();
    isSpinning = false;
    spinButton.disabled = false;
    resultText.textContent = entry ? `${entry.name} · ${percent(entry.count)}` : "결과 없음";
  }

  requestAnimationFrame(frame);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function clampNumber(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function configuredSeconds() {
  const hours = clampNumber(timerHours.value, 0, 23);
  const minutes = clampNumber(timerMinutes.value, 0, 59);
  const seconds = clampNumber(timerSeconds.value, 0, 59);
  timerHours.value = hours;
  timerMinutes.value = minutes;
  timerSeconds.value = seconds;
  return hours * 3600 + minutes * 60 + seconds;
}

function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function kstClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
}

function secondsUntilKstTarget(hour, minute) {
  const now = kstClockParts();
  const nowSeconds = now.hour * 3600 + now.minute * 60 + now.second;
  const targetSeconds = hour * 3600 + minute * 60;
  const daySeconds = 24 * 3600;
  return (targetSeconds - nowSeconds + daySeconds) % daySeconds || daySeconds;
}

function renderTimer() {
  timerDisplay.textContent = formatTime(timerRemaining || configuredSeconds());
}

function stopTimer() {
  window.clearInterval(timerInterval);
  timerInterval = null;
  timerStartButton.textContent = "시작";
}

function showTimeUpEffect() {
  timeUpEffect.classList.add("show");
  window.setTimeout(() => timeUpEffect.classList.remove("show"), 2600);
}

function finishTimer() {
  stopTimer();
  timerRemaining = 0;
  timerDisplay.textContent = "00:00:00";
  showToast("시간이 종료됐습니다.");
  showTimeUpEffect();
}

function tickTimer() {
  const now = Date.now();
  const elapsed = (now - timerLastTick) / 1000;
  timerLastTick = now;
  timerRemaining = Math.max(0, timerRemaining - elapsed);
  timerDisplay.textContent = formatTime(timerRemaining);
  if (timerRemaining <= 0) finishTimer();
}

function toggleTimer() {
  if (timerInterval) {
    stopTimer();
    return;
  }

  if (timerRemaining <= 0) timerRemaining = configuredSeconds();
  if (timerRemaining <= 0) {
    showToast("시간을 먼저 설정하세요.");
    return;
  }

  timerLastTick = Date.now();
  timerStartButton.textContent = "일시정지";
  timerInterval = window.setInterval(tickTimer, 200);
  timerDisplay.textContent = formatTime(timerRemaining);
}

function resetTimer() {
  stopTimer();
  timerRemaining = 0;
  timerHours.value = 0;
  timerMinutes.value = 0;
  timerSeconds.value = 0;
  targetHour.value = 0;
  targetMinute.value = 0;
  renderTimer();
}

function startTargetTimeTimer() {
  const hour = clampNumber(targetHour.value, 0, 23);
  const minute = clampNumber(targetMinute.value, 0, 59);
  targetHour.value = hour;
  targetMinute.value = minute;
  stopTimer();
  timerRemaining = secondsUntilKstTarget(hour, minute);
  timerHours.value = 0;
  timerMinutes.value = 0;
  timerSeconds.value = 0;
  timerLastTick = Date.now();
  timerStartButton.textContent = "일시정지";
  timerInterval = window.setInterval(tickTimer, 200);
  timerDisplay.textContent = formatTime(timerRemaining);
  showToast(`한국 시간 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}에 종료됩니다.`);
}

function encodeItems() {
  return encodeURIComponent(entries.flatMap((entry) => Array.from({ length: entry.count }, () => entry.name)).join("|"));
}

function loadFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const saved = params.get("items");
  if (!saved) return;
  decodeURIComponent(saved)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach(addEntry);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      fullscreenButton.querySelector("span").textContent = "전체화면";
      return;
    }
    await document.documentElement.requestFullscreen();
    fullscreenButton.querySelector("span").textContent = "나가기";
  } catch {
    showToast("브라우저에서 전체화면을 허용하지 않았습니다.");
  }
}

addItemButton.addEventListener("click", () => {
  const name = addItemInput.value.trim();
  if (!name) {
    showToast("항목 이름을 입력하세요.");
    addItemInput.focus();
    return;
  }
  addEntry(name);
  addItemInput.value = "";
  addItemInput.focus();
});

addItemInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addItemButton.click();
});

[timerHours, timerMinutes, timerSeconds].forEach((input) => {
  input.addEventListener("input", () => {
    if (!timerInterval) {
      timerRemaining = configuredSeconds();
      renderTimer();
    }
  });
});

timerStartButton.addEventListener("click", toggleTimer);
timerResetButton.addEventListener("click", resetTimer);
targetStartButton.addEventListener("click", startTargetTimeTimer);

clearItemsButton.addEventListener("click", () => {
  entries = [];
  rotation = 0;
  updateState();
});

spinButton.addEventListener("click", spin);
fullscreenButton.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  fullscreenButton.querySelector("span").textContent = document.fullscreenElement ? "나가기" : "전체화면";
});

document.querySelector("#shuffleButton").addEventListener("click", () => {
  if (entries.length < 2) {
    showToast("섞을 항목이 부족합니다.");
    return;
  }
  entries = [...entries].sort(() => Math.random() - 0.5);
  updateState();
});

document.querySelector("#shareButton").addEventListener("click", async () => {
  const url = `${window.location.origin}${window.location.pathname}?items=${encodeItems()}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast("현재 룰렛 링크를 복사했습니다.");
  } catch {
    showToast(url);
  }
});

loadFromUrl();
updateState();
renderTimer();
