// ── PARAMS ───────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const domain = params.get('domain') || '';
const dest = params.get('dest') || '';

// ── SITE INFO ────────────────────────────────────────────
const cleanName = domain.split('.')[0];
const formattedDomain = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
document.getElementById('site-text').textContent = `You're visiting ${formattedDomain}`;

if (domain) {
  const favicon = document.getElementById('site-favicon');
  favicon.addEventListener('error', () => { favicon.style.display = 'none'; });
  favicon.src = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
}

// ── QUICK-PICK CHIPS ─────────────────────────────────────
const CHIPS = [
  'Check messages', 'Reply to someone', 'Read an article',
  'Check post status', 'Quick update', 'Call someone',
  'Check notifications', 'Share something'
];

const chipsRow = document.getElementById('chips-row');
const input = document.getElementById('intention-input');

CHIPS.forEach(label => {
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.textContent = label;
  chip.addEventListener('click', () => {
    input.value = label;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    input.focus();
  });
  chipsRow.appendChild(chip);
});

// ── TODAY'S TASKS — with daily auto-reset ─────────────────
let todayTasks = [];

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function loadTasks() {
  chrome.storage.local.get(['todayTasks', 'todayTasksDate'], data => {
    const savedDate = data.todayTasksDate || '';
    const todayKey = getTodayKey();
    if (savedDate !== todayKey) {
      // New day — clear old tasks
      todayTasks = [];
      chrome.storage.local.set({ todayTasks: [], todayTasksDate: todayKey });
    } else {
      todayTasks = data.todayTasks || [];
    }
    renderTaskCorner();
  });
}

function saveTasks() {
  chrome.storage.local.set({ todayTasks, todayTasksDate: getTodayKey() });
}

function renderTaskCorner() {
  const corner = document.getElementById('task-corner');
  const list = document.getElementById('task-corner-list');
  list.innerHTML = '';

  if (todayTasks.length === 0) {
    corner.classList.remove('visible');
    return;
  }

  todayTasks.forEach((task, idx) => {
    const item = document.createElement('div');
    item.className = 'task-corner-item' + (task.done ? ' done' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = task.done;
    cb.id = `tcb-${idx}`;

    // Modern custom checkbox div
    const check = document.createElement('div');
    check.className = 'task-corner-check';
    check.addEventListener('click', () => {
      todayTasks[idx].done = !todayTasks[idx].done;
      saveTasks();
      renderTaskCorner();
    });

    const lbl = document.createElement('label');
    lbl.htmlFor = `tcb-${idx}`;
    lbl.textContent = task.text;
    lbl.addEventListener('click', () => {
      todayTasks[idx].done = !todayTasks[idx].done;
      saveTasks();
      renderTaskCorner();
    });

    item.appendChild(cb);
    item.appendChild(check);
    item.appendChild(lbl);
    list.appendChild(item);
  });

  corner.classList.add('visible');
}

function addTask(text) {
  if (!text.trim()) return;
  todayTasks.push({ text: text.trim(), done: false });
  saveTasks();
  renderTaskCorner();
}

loadTasks();

// ── FADE IN ───────────────────────────────────────────────
requestAnimationFrame(() => {
  setTimeout(() => document.body.classList.add('visible'), 50);
});
input.focus();

// ── SUBMIT INTENT ─────────────────────────────────────────
let submitted = false;

function submitIntent(textValue) {
  if (submitted) return;
  submitted = true;

  const finalVal = (textValue || '').trim() || 'Just browsing';

  chrome.runtime.sendMessage(
    { type: 'START_SESSION', intention: finalVal, domain, dest },
    (response) => {
      if (chrome.runtime.lastError) {
        if (dest) window.location.href = dest;
        return;
      }
      setTimeout(() => {
        if (dest && window.location.href.indexOf('intercept.html') !== -1) {
          window.location.href = dest;
        }
      }, 800);
    }
  );
}

input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (!input.value.trim()) {
    // Empty input — route to just browsing friction screen instead
    showFrictionScreen();
  } else {
    submitIntent(input.value);
  }
});

document.getElementById('btn-submit').addEventListener('click', () => {
  submitIntent(input.value);
});

// ── JUST BROWSING → FRICTION SCREEN ──────────────────────
document.getElementById('btn-browse').addEventListener('click', () => {
  showFrictionScreen();
});

function showFrictionScreen() {
  document.getElementById('screen-main').classList.add('hidden');
  const frictionScreen = document.getElementById('screen-friction');
  frictionScreen.classList.remove('hidden');
  setTimeout(() => {
    document.getElementById('friction-block').classList.add('visible');
    document.getElementById('task-input').focus();
  }, 50);
  startCountdown();
}

// ── COUNTDOWN CLOCK ───────────────────────────────────────
const COUNTDOWN_SECONDS = 15;
const CIRCUMFERENCE = 263; // 2π × 41.86

let remaining = COUNTDOWN_SECONDS;
let countdownTimer = null;

function startCountdown() {
  remaining = COUNTDOWN_SECONDS;
  const progress = document.getElementById('clock-progress');
  const numberEl = document.getElementById('clock-number');
  const enterBtn = document.getElementById('btn-enter-anyway');

  progress.style.strokeDashoffset = '0';
  numberEl.textContent = remaining;
  enterBtn.textContent = `Enter anyway (${remaining})`;

  const tick = () => {
    remaining--;
    numberEl.textContent = remaining;

    const offset = CIRCUMFERENCE * (1 - remaining / COUNTDOWN_SECONDS);
    progress.style.strokeDashoffset = offset;

    if (remaining <= 0) {
      enterBtn.disabled = false;
      enterBtn.style.opacity = '1';
      enterBtn.style.cursor = 'pointer';
      enterBtn.textContent = 'Enter anyway';
      return;
    }

    enterBtn.textContent = `Enter anyway (${remaining})`;
    countdownTimer = setTimeout(tick, 1000);
  };

  countdownTimer = setTimeout(tick, 1000);
}

// ── TASK INPUT ───────────────────────────────────────────
const taskInput = document.getElementById('task-input');
const taskAddBtn = document.getElementById('task-add-btn');
const taskAddedList = document.getElementById('task-added-list');

function addFrictionTask() {
  const val = taskInput.value.trim();
  if (!val) return;
  addTask(val);

  // Show inline in the friction screen
  const item = document.createElement('div');
  item.className = 'task-added-item';
  item.textContent = val;
  taskAddedList.appendChild(item);

  taskInput.value = '';
  // Keep focus so they can keep adding — timer stays paused
  taskInput.focus();
}

taskAddBtn.addEventListener('click', () => {
  addFrictionTask();
});

taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addFrictionTask();
  }
});

// ── FRICTION SCREEN ACTIONS ───────────────────────────────
document.getElementById('btn-enter-anyway').addEventListener('click', () => {
  submitIntent('Just browsing');
});

document.getElementById('btn-go-back').addEventListener('click', () => {
  // Cancel the running countdown
  if (countdownTimer) clearTimeout(countdownTimer);
  submitted = false;

  document.getElementById('screen-friction').classList.add('hidden');
  document.getElementById('friction-block').classList.remove('visible');
  document.getElementById('screen-main').classList.remove('hidden');
  setTimeout(() => input.focus(), 50);
});