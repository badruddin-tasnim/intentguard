let timersInterval = null;

// ── TAB SWITCHING ──────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'settings') renderSettings();
  });
});

// ── HELPERS ───────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
}

function formatDomain(domain) {
  const name = domain.split('.')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// ── SESSIONS ─────────────────────────────────────────────
function renderSessions(activeSessions) {
  const container = document.getElementById('active-list');
  container.innerHTML = '';
  const ids = Object.keys(activeSessions);

  if (ids.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">👀</div>No active sessions</div>`;
    if (timersInterval) { clearInterval(timersInterval); timersInterval = null; }
    return;
  }

  ids.forEach(tabId => {
    const s = activeSessions[tabId];
    const el = document.createElement('div');
    el.className = 'session-item';
    el.innerHTML = `
      <img class="session-favicon" src="${faviconUrl(s.domain)}" alt="">
      <div class="session-info">
        <div class="session-domain">${escapeHtml(formatDomain(s.domain))}</div>
        <div class="session-intention">${escapeHtml(s.intention)}</div>
      </div>
      <div class="session-right">
        <span class="timer-badge" data-start="${s.startTime}">00:00</span>
        <button class="btn-done" data-tabid="${tabId}" title="Mark done">
          <svg viewBox="0 0 24 24"><path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/></svg>
        </button>
      </div>`;
    container.appendChild(el);
  });

  container.querySelectorAll('.btn-done').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = parseInt(btn.dataset.tabid, 10);
      chrome.runtime.sendMessage({ type: 'COMPLETE_SESSION', tabId }, () => renderPopup());
    });
  });

  if (timersInterval) clearInterval(timersInterval);
  tickTimers();
  timersInterval = setInterval(tickTimers, 1000);
}

function tickTimers() {
  document.querySelectorAll('.timer-badge').forEach(badge => {
    const diff = Math.floor((Date.now() - parseInt(badge.dataset.start, 10)) / 1000);
    const m = Math.floor(diff / 60), s = diff % 60;
    badge.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  });
}

// ── HISTORY ──────────────────────────────────────────────
function renderHistory(history) {
  const container = document.getElementById('history-list');
  container.innerHTML = '';

  if (history.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div>No history yet</div>`;
    return;
  }

  const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
  const sorted = [...history].sort((a, b) => b.startTime - a.startTime);
  const todayItems = sorted.filter(i => i.startTime >= startOfToday.getTime());
  const olderItems = sorted.filter(i => i.startTime < startOfToday.getTime());

  function buildItem(item) {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = `
      <img class="history-favicon" src="${faviconUrl(item.domain)}" alt="">
      <div class="history-info">
        <div class="history-domain">${escapeHtml(formatDomain(item.domain))}</div>
        <div class="history-intention">${escapeHtml(item.intention)}</div>
        <div class="history-date">${formatDate(item.startTime)}</div>
      </div>
      <div class="history-duration">${formatDuration(item.duration)}</div>`;
    return el;
  }

  function buildSection(label, items) {
    if (items.length === 0) return;
    const header = document.createElement('div');
    header.className = 'history-section-label';
    header.textContent = label;
    container.appendChild(header);
    const card = document.createElement('div');
    card.className = 'card';
    items.forEach(item => card.appendChild(buildItem(item)));
    container.appendChild(card);
  }

  buildSection('Today', todayItems);
  buildSection('Previous 7 Days', olderItems);
}

// ── SETTINGS ─────────────────────────────────────────────
function renderSettings() {
  chrome.runtime.sendMessage({ type: 'GET_DOMAINS' }, ({ domains }) => {
    const list = document.getElementById('domain-list');
    list.innerHTML = '';

    if (domains.length === 0) {
      list.innerHTML = `<div class="empty-state" style="padding:16px;font-size:12px;color:#444;">No sites added yet</div>`;
      return;
    }

    domains.forEach(domain => {
      const el = document.createElement('div');
      el.className = 'domain-item';
      el.innerHTML = `
        <img class="domain-favicon" src="${faviconUrl(domain)}" alt="">
        <span class="domain-name">${escapeHtml(domain)}</span>
        <button class="btn-remove" data-domain="${escapeHtml(domain)}" title="Remove">✕</button>`;
      list.appendChild(el);
    });

    list.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const toRemove = btn.dataset.domain;
        const updated = domains.filter(d => d !== toRemove);
        saveDomains(updated);
      });
    });
  });
}

function saveDomains(domains) {
  chrome.runtime.sendMessage({ type: 'SAVE_DOMAINS', domains }, () => {
    showSaveToast();
    renderSettings();
  });
}

function showSaveToast() {
  const toast = document.getElementById('save-toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

// Add domain
document.getElementById('add-btn').addEventListener('click', addDomain);
document.getElementById('add-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addDomain();
});

function addDomain() {
  let val = document.getElementById('add-input').value.trim().toLowerCase();
  if (!val) return;

  // Strip protocol and paths, keep only hostname
  try {
    if (!val.startsWith('http')) val = 'https://' + val;
    const url = new URL(val);
    val = url.hostname.replace(/^www\./, '');
  } catch (_) {
    val = val.replace(/^www\./, '').split('/')[0];
  }

  if (!val || !val.includes('.')) {
    document.getElementById('add-input').style.borderColor = '#c0392b';
    setTimeout(() => document.getElementById('add-input').style.borderColor = '', 1000);
    return;
  }

  chrome.runtime.sendMessage({ type: 'GET_DOMAINS' }, ({ domains }) => {
    if (domains.includes(val)) {
      showSaveToast();
      document.getElementById('add-input').value = '';
      return;
    }
    saveDomains([...domains, val]);
    document.getElementById('add-input').value = '';
  });
}

// Clear history
document.getElementById('clear-btn').addEventListener('click', () => {
  chrome.storage.local.set({ history: [] }, () => renderPopup());
});

// ── MAIN RENDER ───────────────────────────────────────────
function renderPopup() {
  chrome.storage.local.get(['activeSessions', 'history'], data => {
    renderSessions(data.activeSessions || {});
    renderHistory(data.history || []);
  });
}

// ── ALERT GLOW SETTINGS ──────────────────────────────────
function loadGlowSettings() {
  chrome.storage.local.get(['glowEnabled', 'glowMinutes'], data => {
    const enabled = data.glowEnabled !== false; // default true
    const mins = data.glowMinutes || 10;         // default 10

    const toggle = document.getElementById('glow-toggle');
    const timeRow = document.getElementById('glow-time-row');
    if (!toggle) return;

    toggle.checked = enabled;
    timeRow.classList.toggle('setting-disabled', !enabled);

    document.querySelectorAll('.pill').forEach(pill => {
      pill.classList.toggle('active', parseInt(pill.dataset.mins) === mins);
    });
  });
}

function saveGlowSettings() {
  const toggle = document.getElementById('glow-toggle');
  const activePill = document.querySelector('.pill.active');
  const enabled = toggle.checked;
  const mins = activePill ? parseInt(activePill.dataset.mins) : 10;
  chrome.storage.local.set({ glowEnabled: enabled, glowMinutes: mins });
  showSaveToast();
}

document.getElementById('glow-toggle').addEventListener('change', () => {
  const enabled = document.getElementById('glow-toggle').checked;
  document.getElementById('glow-time-row').classList.toggle('setting-disabled', !enabled);
  saveGlowSettings();
});

document.querySelectorAll('.pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    saveGlowSettings();
  });
});

// Load glow settings when settings tab opens
document.querySelectorAll('.tab-btn').forEach(btn => {
  if (btn.dataset.tab === 'settings') {
    btn.addEventListener('click', loadGlowSettings);
  }
});

renderPopup();