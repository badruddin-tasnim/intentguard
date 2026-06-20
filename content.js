// ── GLOBALS ───────────────────────────────────────────────
let shadowRoot = null;
let host = null;
let activeWidgetSession = null;
let lastUrl = window.location.href;
let toastVisible = false;
let storageChangeTimeout = null;

// ── HELPERS ───────────────────────────────────────────────
function liftFlashPrevention() {} // no-op — kept for call-site compatibility

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function safeSendMessage(message, callback) {
  try {
    if (!chrome.runtime || !chrome.runtime.id) return;
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return;
      if (callback) callback(response);
    });
  } catch(e) { /* extension context invalidated — ignore */ }
}

function getMountTarget() {
  return document.body || document.documentElement;
}

function lockScrolling() {
  document.documentElement.style.setProperty('overflow', 'hidden', 'important');
  if (document.body) document.body.style.setProperty('overflow', 'hidden', 'important');
}

function restoreScrolling() {
  document.documentElement.style.removeProperty('overflow');
  if (document.body) document.body.style.removeProperty('overflow');
}

// ── SHADOW DOM CONTAINER ──────────────────────────────────
function createShadowContainer() {
  const target = getMountTarget();

  if (host && target.contains(host)) return shadowRoot;

  if (host && host.parentNode && host.parentNode !== target) host.remove();

  host = document.createElement('div');
  host.id = 'intentguard-host';
  host.style.cssText = `
    position: fixed !important;
    top: 0 !important; left: 0 !important;
    width: 100vw !important; height: 100vh !important;
    z-index: 2147483647 !important;
    pointer-events: none;
  `;

  shadowRoot = host.attachShadow({ mode: 'open' });
  target.appendChild(host);

  // Re-attach if SPA navigation removes the host from the DOM
  const observer = new MutationObserver(() => {
    const t = getMountTarget();
    if (host && !t.contains(host)) {
      observer.disconnect();
      t.appendChild(host);
      observer.observe(document.documentElement, { childList: true });
      if (document.body) observer.observe(document.body, { childList: true });
    }
  });
  observer.observe(document.documentElement, { childList: true });
  if (document.body) observer.observe(document.body, { childList: true });

  return shadowRoot;
}

// ── STYLES ────────────────────────────────────────────────
function injectStyles(root) {
  if (root.querySelector('style')) return;
  const style = document.createElement('style');
  root.appendChild(style); // append FIRST, then set content
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

    :host { all: initial; font-size: 16px !important; line-height: 1.5 !important; }

    * { box-sizing: border-box; font-family: 'DM Sans', sans-serif; font-size: inherit; line-height: inherit; }

    /* ── OVERLAY ── */
    .overlay-backdrop {
      position: fixed !important;
      top: 0 !important; left: 0 !important;
      width: 100vw !important; height: 100vh !important;
      background: rgba(0,0,0,0.97) !important;
      display: flex; align-items: center; justify-content: center;
      z-index: 2147483647 !important;
      pointer-events: all !important;
      opacity: 0;
      transition: opacity 250ms ease;
      overflow: hidden !important;
      margin: 0 !important; padding: 0 !important;
    }

    .overlay-backdrop.visible { opacity: 1; }

    .content-block {
      display: flex; flex-direction: column; align-items: center; text-align: center;
      opacity: 0; transform: translateY(16px);
      transition: transform 350ms ease, opacity 350ms ease;
      transition-delay: 100ms;
    }

    .overlay-backdrop.visible .content-block { opacity: 1; transform: translateY(0); }

    .label-top {
      font-size: 11px; letter-spacing: 0.25em; color: #555;
      text-transform: uppercase; font-weight: 600;
    }

    .site-line {
      display: flex; align-items: center; gap: 8px; margin-top: 32px;
    }

    .site-favicon { width: 20px; height: 20px; border-radius: 50%; background: #222; }

    .site-text { font-size: 28px; font-weight: 300; color: #fff; }

    .main-heading {
      font-size: 48px; font-weight: 700; color: #fff;
      line-height: 1.1; margin: 12px 0 0 0;
    }

    .subtext { font-size: 15px; color: #666; margin: 8px 0 0 0; }

    .intention-input {
      width: 480px; max-width: 90vw; margin-top: 40px;
      background: transparent; border: none;
      border-bottom: 1.5px solid #333;
      color: #fff; font-size: 20px; font-weight: 400;
      padding: 12px 0; outline: none; text-align: center;
      transition: border-bottom-color 0.2s ease;
    }

    .intention-input::placeholder { color: #444; }
    .intention-input:focus { border-bottom-color: #fff; }

    .btn-row { display: flex; gap: 12px; margin-top: 40px; }

    .btn-primary {
      background: #fff; color: #000; font-size: 14px; font-weight: 600;
      letter-spacing: 0.05em; padding: 14px 36px;
      border-radius: 6px; border: none; cursor: pointer;
      transition: background 0.2s ease;
    }
    .btn-primary:hover { background: #e0e0e0; }

    .btn-secondary {
      background: transparent; color: #555; font-size: 14px; font-weight: 500;
      padding: 14px 24px; border: 1px solid #2a2a2a;
      border-radius: 6px; cursor: pointer;
      transition: border-color 0.2s ease, color 0.2s ease;
    }
    .btn-secondary:hover { border-color: #555; color: #888; }

    .footer-hint { font-size: 12px; color: #3a3a3a; margin-top: 20px; }

    /* ── WIDGET ── */
    .widget-container {
      position: fixed;
      bottom: 28px; right: 28px;
      z-index: 2147483647;
      pointer-events: auto;
      user-select: none;
      opacity: 0;
      transform: translateX(120%);
      transition: transform 400ms ease, opacity 400ms ease;
    }

    .widget-container.visible { opacity: 1; transform: translateX(0); }
    .widget-container.dragging { transition: none !important; }

    /* ── WIDGET CARD — two visual states, one DOM ── */
    .widget-card {
      background: rgba(15,15,15,0.92);
      backdrop-filter: blur(16px) saturate(180%);
      -webkit-backdrop-filter: blur(16px) saturate(180%);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      cursor: grab;
      overflow: hidden;
      /* The card itself never changes padding — only inner layers swap */
    }

    .widget-card:active { cursor: grabbing; }

    /* Full view — always in DOM, fades out when minimized */
    .widget-full {
      padding: 14px 18px;
      display: flex; flex-direction: column; gap: 0;
      transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.4,0,0.2,1);
      transform-origin: top center;
    }

    /* Mini view — always in DOM, fades in when minimized */
    .widget-mini {
      padding: 12px 14px;
      display: flex; align-items: center; gap: 10px;
      position: absolute; top: 0; left: 0; right: 0;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
      white-space: nowrap;
    }

    /* EXPANDED state (default) */
    .widget-card .widget-full   { opacity: 1; transform: translateY(0); pointer-events: auto; }
    .widget-card .widget-mini   { opacity: 0; pointer-events: none; }

    /* MINIMIZED state */
    .widget-card.minimized .widget-full  { opacity: 0; transform: translateY(-4px); pointer-events: none; }
    .widget-card.minimized .widget-mini  { opacity: 1; pointer-events: auto; }

    /* Height transition — card wraps both layers; JS sets explicit height */
    .widget-card {
      position: relative;
      transition: height 0.3s cubic-bezier(0.4,0,0.2,1),
                  border-color 0.3s ease;
    }

    .widget-row1 { display: flex; align-items: center; gap: 6px; }

    .widget-dot {
      width: 6px; height: 6px;
      background: #10b981; border-radius: 50%; flex-shrink: 0;
    }

    .widget-label {
      font-size: 10px; color: #555; text-transform: uppercase;
      font-weight: 700; letter-spacing: 0.05em;
    }

    .widget-row2-intention {
      font-size: 14px; color: #fff; font-weight: 500;
      margin-top: 8px; line-height: 1.4;
      overflow: hidden; text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      white-space: normal;
    }

    .widget-row3-timer {
      font-size: 12px; font-family: monospace;
      color: #888; margin-top: 6px;
    }

    .widget-row4-btn {
      width: 100%; background: #fff; color: #000;
      border-radius: 8px; font-size: 12px; font-weight: 600;
      padding: 8px; margin-top: 12px; border: none;
      cursor: pointer; text-align: center;
      transition: background 0.2s ease;
    }
    .widget-row4-btn:hover { background: #e0e0e0; }

    /* Mini view internals — matches pill screenshot */
    .widget-mini-timer {
      font-size: 12px; font-family: monospace; font-weight: 700;
      color: #fff;
      background: rgba(255,255,255,0.1);
      padding: 5px 10px; border-radius: 8px;
      flex-shrink: 0; letter-spacing: 0.02em;
    }

    .widget-mini-intention {
      font-size: 12px; font-weight: 500; color: #999;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      max-width: 150px;
    }

    /* ── ALERT GLOW ── */
    @keyframes alertGlow {
      0%   { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0px 0px rgba(200,60,60,0);     border-color: rgba(255,255,255,0.07); }
      30%  { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 16px 4px rgba(200,60,60,0.45); border-color: rgba(200,80,80,0.6); }
      50%  { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 26px 7px rgba(200,60,60,0.65); border-color: rgba(200,80,80,0.85); }
      70%  { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 16px 4px rgba(200,60,60,0.45); border-color: rgba(200,80,80,0.6); }
      100% { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0px 0px rgba(200,60,60,0);     border-color: rgba(255,255,255,0.07); }
    }

    .widget-card.glow-alert {
      animation: alertGlow 2s cubic-bezier(0.4,0,0.2,1) forwards;
    }

    /* ── FULL-SCREEN EDGE GLOW ── */
    .screen-glow-overlay {
      position: fixed !important;
      top: 0 !important; left: 0 !important;
      width: 100vw !important; height: 100vh !important;
      z-index: 2147483646 !important;
      pointer-events: none !important;
      opacity: 0;
    }

    @keyframes screenEdgeGlow {
      0%   { box-shadow: inset 0 0 0px 0px rgba(220,38,38,0); opacity: 0; }
      25%  { box-shadow: inset 0 0 80px 16px rgba(220,38,38,0.55); opacity: 1; }
      50%  { box-shadow: inset 0 0 140px 28px rgba(220,38,38,0.75); opacity: 1; }
      75%  { box-shadow: inset 0 0 80px 16px rgba(220,38,38,0.55); opacity: 1; }
      100% { box-shadow: inset 0 0 0px 0px rgba(220,38,38,0); opacity: 0; }
    }

    .screen-glow-overlay.screen-glow-active {
      animation: screenEdgeGlow 1.8s cubic-bezier(0.4,0,0.2,1) forwards;
    }

    /* ── TOAST ── */
    .toast-notification {
      position: fixed;
      bottom: 32px; left: 50%;
      transform: translate(-50%, 100px);
      background: #0f172a; color: #fff;
      padding: 14px 28px; border-radius: 16px;
      font-size: 14px !important; font-weight: 600;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3);
      z-index: 2147483647; pointer-events: none;
      transition: transform 0.4s cubic-bezier(0.175,0.885,0.32,1.275), opacity 0.3s;
      opacity: 0;
    }

    .toast-notification.visible { transform: translate(-50%,0); opacity: 1; }
  `;
}

// ── SESSION STATE ─────────────────────────────────────────
function checkSessionState() {
  safeSendMessage({ type: 'CHECK_SESSION' }, (response) => {
    if (!response) return;
    const container = createShadowContainer();

    if (response.active) {
      // Remove overlay if present
      const overlay = container.querySelector('.overlay-backdrop');
      if (overlay) { overlay.remove(); restoreScrolling(); }

      // Only show widget if not already showing for this session
      const currentWidget = container.querySelector('.widget-container');
      if (currentWidget) return; // widget already present — do not spawn a second one
      activeWidgetSession = response.session;
      showWidget(response.session);

    } else {
      // Remove stale widget
      const currentWidget = container.querySelector('.widget-container');
      if (currentWidget) { currentWidget.remove(); activeWidgetSession = null; }

      // Show overlay if domain is monitored and no overlay already showing
      const overlay = container.querySelector('.overlay-backdrop');
      if (!overlay && response.domain) {
        showOverlay(response.domain);
      }
    }
  });
}

// ── OVERLAY ───────────────────────────────────────────────
function showOverlay(domain) {
  const root = createShadowContainer();
  injectStyles(root);

  lockScrolling();
  const scrollLockInterval = setInterval(lockScrolling, 250);

  const backdrop = document.createElement('div');
  backdrop.className = 'overlay-backdrop';

  const cleanName = domain.split('.')[0];
  const formattedDomain = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
  const faviconUrl = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;

  backdrop.innerHTML = `
    <div class="content-block">
      <div class="label-top">INTENTGUARD</div>
      <div class="site-line">
        <img class="site-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">
        <span class="site-text">You're visiting ${formattedDomain}</span>
      </div>
      <h1 class="main-heading">What's your intention?</h1>
      <p class="subtext">State your purpose. Stay focused.</p>
      <input type="text" class="intention-input" placeholder="e.g., Check messages from mom">
      <div class="btn-row">
        <button class="btn-primary" id="btn-submit">Let me in</button>
        <button class="btn-secondary" id="btn-browse">Just browsing</button>
      </div>
      <div class="footer-hint">Press Enter to continue</div>
    </div>
  `;

  root.appendChild(backdrop);
  host.style.pointerEvents = 'all'; // block site clicks while overlay active

  // Force host page not to clip our fixed overlay (Facebook etc.)
  document.documentElement.style.setProperty('overflow', 'hidden', 'important');
  if (document.body) document.body.style.setProperty('overflow', 'hidden', 'important');

  setTimeout(() => {
    backdrop.classList.add('visible');
    const input = backdrop.querySelector('.intention-input');
    if (input) input.focus();
  }, 50);

  // Stop ALL keyboard events bubbling to the host page
  // (YouTube, Twitter etc. intercept keys globally and swallow them)
  const intentionInput = backdrop.querySelector('.intention-input');
  ['keydown', 'keyup', 'keypress'].forEach(evtType => {
    intentionInput.addEventListener(evtType, (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.key === 'Enter') submitIntent(intentionInput.value);
    });
  });
  intentionInput.addEventListener('click', e => e.stopPropagation());
  intentionInput.addEventListener('focus', e => e.stopPropagation());

  // Stop overlay click events reaching the page beneath
  backdrop.addEventListener('click', e => e.stopPropagation());
  backdrop.addEventListener('mousedown', e => e.stopPropagation());

  // Guard against double-submit (button click + Enter both firing)
  let submitted = false;
  const submitIntent = (textValue) => {
    if (submitted) return;
    submitted = true;
    const finalVal = textValue.trim() || 'Just browsing';
    safeSendMessage({ type: 'START_SESSION', intention: finalVal }, (response) => {
      if (response && response.success) {
        clearInterval(scrollLockInterval);
        host.style.pointerEvents = 'none'; // restore site clicks for widget
        document.documentElement.style.removeProperty('overflow');
        if (document.body) document.body.style.removeProperty('overflow');

        backdrop.classList.remove('visible');
        setTimeout(() => {
          backdrop.remove();
          showWidget(response.session);
        }, 350);
      }
    });
  };

  backdrop.querySelector('#btn-submit').addEventListener('click', () => {
    submitIntent(intentionInput.value);
  });
  backdrop.querySelector('#btn-browse').addEventListener('click', () => {
    submitIntent('Just browsing');
  });
}

// ── WIDGET ────────────────────────────────────────────────
function showWidget(session) {
  const root = createShadowContainer();
  injectStyles(root);

  // Prevent duplicate widgets
  const existing = root.querySelector('.widget-container');
  if (existing) return;

  const widgetContainer = document.createElement('div');
  widgetContainer.className = 'widget-container';
  widgetContainer.style.bottom = '28px';
  widgetContainer.style.right = '28px';

  widgetContainer.innerHTML = `
    <div class="widget-card">
      <!-- FULL VIEW -->
      <div class="widget-full">
        <div class="widget-row1">
          <div class="widget-dot"></div>
          <span class="widget-label">Active Intention</span>
        </div>
        <div class="widget-row2-intention" title="${escapeHtml(session.intention)}">${escapeHtml(session.intention)}</div>
        <div class="widget-row3-timer">00:00 elapsed</div>
        <button class="widget-row4-btn" id="btn-complete">Mark done ✓</button>
      </div>
      <!-- MINI VIEW -->
      <div class="widget-mini">
        <span class="widget-mini-timer">00:00</span>
        <span class="widget-mini-intention">${escapeHtml(session.intention)}</span>
      </div>
    </div>
  `;

  root.appendChild(widgetContainer);
  setTimeout(() => widgetContainer.classList.add('visible'), 50);

  const widgetCard = widgetContainer.querySelector('.widget-card');
  const btnComplete = widgetContainer.querySelector('#btn-complete');
  const timerEl = widgetContainer.querySelector('.widget-row3-timer');
  const miniTimerEl = widgetContainer.querySelector('.widget-mini-timer');
  const fullView = widgetContainer.querySelector('.widget-full');
  const miniView = widgetContainer.querySelector('.widget-mini');

  // Heights are measured after the DOM is painted to avoid jitter.
  // We use double-rAF: first frame lets the browser layout, second frame reads.
  let fullHeight = 0;
  let miniHeight = 0;

  function measureHeights(cb) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fullHeight = fullView.scrollHeight;
        miniHeight = miniView.scrollHeight;
        if (cb) cb();
      });
    });
  }

  // Set initial height after layout is stable
  measureHeights(() => {
    widgetCard.style.height = fullHeight + 'px';
  });

  function minimizeWidget() {
    // Re-measure in case content changed (e.g. long intention text)
    fullHeight = fullView.scrollHeight;
    miniHeight = miniView.scrollHeight;
    // Lock current height synchronously, then on next frame animate to mini
    widgetCard.style.height = fullHeight + 'px';
    requestAnimationFrame(() => {
      widgetCard.classList.add('minimized');
      widgetCard.style.height = miniHeight + 'px';
    });
  }

  function expandWidget() {
    fullHeight = fullView.scrollHeight;
    miniHeight = miniView.scrollHeight;
    widgetCard.style.height = miniHeight + 'px';
    requestAnimationFrame(() => {
      widgetCard.classList.remove('minimized');
      widgetCard.style.height = fullHeight + 'px';
    });
  }

  // Timer always runs — counts total real time since session started
  const getElapsedMs = () => Date.now() - session.startTime;

  const pad = n => String(n).padStart(2, '0');
  const updateTimerValue = () => {
    const elapsed = Math.floor(getElapsedMs() / 1000);
    const mm = pad(Math.floor(elapsed / 60));
    const ss = pad(elapsed % 60);
    timerEl.textContent = `${mm}:${ss} elapsed`;
    miniTimerEl.textContent = `${mm}:${ss}`;
  };

  updateTimerValue();
  let timerInterval = setInterval(updateTimerValue, 1000);

  // ── MINIMIZE / EXPAND ──
  let minimizeTimeout = setTimeout(() => minimizeWidget(), 3500);
  let reMinimizeTimeout = null;

  widgetCard.addEventListener('mouseenter', () => {
    clearTimeout(reMinimizeTimeout);
    expandWidget();
    widgetCard.style.cursor = 'grab';
  });
  widgetCard.addEventListener('mouseleave', () => {
    clearTimeout(reMinimizeTimeout);
    // Instant re-minimize on mouse leave — CSS transition handles the visual smoothness
    reMinimizeTimeout = setTimeout(() => minimizeWidget(), 0);
  });

  // ── VISIBILITY / SLEEP HANDLING ──
  // Restart interval when tab becomes visible again — Chrome throttles
  // setInterval while hidden so the display snaps to correct time on return
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      clearInterval(timerInterval);
      updateTimerValue();
      timerInterval = setInterval(updateTimerValue, 1000);
      // Reaffirm pointer events — SPAs can reset styles while tab is hidden
      if (host) host.style.pointerEvents = 'none';
      widgetContainer.style.pointerEvents = 'auto';
      widgetCard.style.pointerEvents = 'auto';
      btnComplete.style.pointerEvents = 'auto';
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // ── ALERT GLOW ──
  let glowInterval = null;

  function triggerGlow() {
    const card = widgetContainer.querySelector('.widget-card');
    if (card) {
      card.classList.remove('glow-alert');
      void card.offsetWidth; // reflow to restart animation
      card.classList.add('glow-alert');
      setTimeout(() => card.classList.remove('glow-alert'), 2200);
    }
    triggerScreenGlow();
    playAlertBeep(); // fires once per glow trigger
  }

  // Reuse a single AudioContext across all beeps in this widget's lifetime.
  // CRITICAL: Chrome blocks AudioContext from producing sound until there has
  // been a real user gesture (click/keypress). Creating it lazily inside a
  // setInterval callback (no gesture) means it gets stuck "suspended" forever.
  // Fix: create + unlock it NOW, since showWidget() always runs right after
  // the user clicked "Let me in" / "Just browsing" / "Mark done" — a real gesture.
  let sharedAudioCtx = null;

  function getAudioContext() {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return sharedAudioCtx;
  }

  function unlockAudioContext() {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        // Play a near-silent buffer to fully unlock the context under the
        // user-gesture umbrella we currently have (widget was just created
        // as a direct result of a button click)
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        ctx.resume().catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }
  unlockAudioContext();

  // Plays a short, subtle beep using Web Audio API — no external file needed
  function playAlertBeep() {
    chrome.storage.local.get(['soundEnabled', 'glowEnabled'], prefs => {
      if (prefs.soundEnabled === false) return; // default: enabled
      if (prefs.glowEnabled === false) return;  // sound never plays if glow itself is off
      try {
        const ctx = getAudioContext();

        const fireBeep = () => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.value = 880; // soft, gentle pitch (A5)

          const now = ctx.currentTime;
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(0.06, now + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now);
          osc.stop(now + 0.4);
        };

        // Should already be running thanks to unlockAudioContext() at widget
        // creation — but resume defensively in case it got suspended again
        if (ctx.state === 'suspended') {
          ctx.resume().then(fireBeep).catch(() => fireBeep());
        } else {
          fireBeep();
        }
      } catch (e) { /* audio not available — fail silently */ }
    });
  }

  // Full-screen red edge glow — much harder to miss than the small widget pulse
  function triggerScreenGlow() {
    const root = createShadowContainer();
    let screenGlow = root.querySelector('.screen-glow-overlay');
    if (!screenGlow) {
      screenGlow = document.createElement('div');
      screenGlow.className = 'screen-glow-overlay';
      root.appendChild(screenGlow);
    }
    screenGlow.classList.remove('screen-glow-active');
    void screenGlow.offsetWidth; // reflow to restart animation
    screenGlow.classList.add('screen-glow-active');
    setTimeout(() => screenGlow.classList.remove('screen-glow-active'), 1900);
  }

  // Glow tracks its own last-fire timestamp so it is immune to
  // pause/resume drift and always fires exactly every N active minutes
  let lastGlowFiredAtMs = 0; // active-elapsed ms when glow last fired

  function startGlowInterval() {
    if (glowInterval) clearInterval(glowInterval);
    glowInterval = setInterval(() => {
      chrome.storage.local.get(['glowEnabled', 'glowMinutes'], prefs => {
        if (prefs.glowEnabled === false) return;
        const intervalMs = (prefs.glowMinutes || 10) * 60 * 1000;
        const elapsed = getElapsedMs();
        if (elapsed < intervalMs) return; // haven't hit first interval yet

        // How many complete intervals have passed since session start?
        const intervalsPassed = Math.floor(elapsed / intervalMs);
        const nextFireAt = intervalsPassed * intervalMs;

        // Fire only if we haven't fired for this interval yet
        // and we're within a 12s window of the boundary
        const sinceLastBoundary = elapsed - nextFireAt;
        if (sinceLastBoundary <= 12000 && nextFireAt > lastGlowFiredAtMs) {
          lastGlowFiredAtMs = nextFireAt;
          triggerGlow();
        }
      });
    }, 10000);
  }

  chrome.storage.local.get(['glowEnabled', 'glowMinutes'], prefs => {
    if (prefs.glowEnabled !== false) startGlowInterval();
  });

  // ── DRAG ──
  let isDragging = false;
  let startX, startY, origX, origY;

  widgetCard.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    isDragging = true;
    widgetContainer.classList.add('dragging');
    const rect = widgetContainer.getBoundingClientRect();
    widgetContainer.style.right = 'auto';
    widgetContainer.style.bottom = 'auto';
    widgetContainer.style.left = `${rect.left}px`;
    widgetContainer.style.top = `${rect.top}px`;
    startX = e.clientX; startY = e.clientY;
    origX = rect.left; origY = rect.top;
    document.addEventListener('mousemove', dragHandler);
    document.addEventListener('mouseup', releaseHandler);
    e.preventDefault();
  });

  function dragHandler(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const maxX = window.innerWidth - widgetContainer.offsetWidth - 8;
    const maxY = window.innerHeight - widgetContainer.offsetHeight - 8;
    widgetContainer.style.left = `${Math.max(8, Math.min(origX + dx, maxX))}px`;
    widgetContainer.style.top = `${Math.max(8, Math.min(origY + dy, maxY))}px`;
  }

  function releaseHandler() {
    isDragging = false;
    widgetContainer.classList.remove('dragging');
    document.removeEventListener('mousemove', dragHandler);
    document.removeEventListener('mouseup', releaseHandler);
  }

  // ── COMPLETE ──
  function teardownWidget() {
    clearInterval(timerInterval);
    clearInterval(glowInterval);
    clearTimeout(minimizeTimeout);
    clearTimeout(reMinimizeTimeout);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (sharedAudioCtx && sharedAudioCtx.state !== 'closed') {
      sharedAudioCtx.close().catch(() => {});
    }
    activeWidgetSession = null;
  }

  btnComplete.addEventListener('click', () => {
    const actualElapsedSecs = Math.floor(getElapsedMs() / 1000);
    safeSendMessage({ type: 'COMPLETE_SESSION', actualDuration: actualElapsedSecs }, (response) => {
      teardownWidget();
      widgetContainer.classList.remove('visible');
      setTimeout(() => {
        widgetContainer.remove();
        const duration = actualElapsedSecs || (response && response.duration) || 0;
        showCompletionToast(duration);
      }, 300);
    });
  });
}

// ── TOAST ─────────────────────────────────────────────────
function showCompletionToast(durationInSeconds) {
  const root = createShadowContainer();
  injectStyles(root);

  const toast = document.createElement('div');
  toast.className = 'toast-notification';

  const mins = Math.floor(durationInSeconds / 60);
  const secs = durationInSeconds % 60;
  const timeString = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  toast.innerHTML = `✓ Session complete &nbsp;·&nbsp; <strong>${timeString}</strong>`;
  root.appendChild(toast);

  toastVisible = true;
  setTimeout(() => toast.classList.add('visible'), 50);

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => {
      toast.remove();
      toastVisible = false;
      // Only tear down host if nothing else is in the shadow root
      if (root.children.length <= 1 && host) {
        host.remove(); host = null; shadowRoot = null;
      }
      checkSessionState(); // now safe to show next overlay
    }, 400);
  }, 1200);
}

// ── EXTERNAL COMPLETION (from popup) ─────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'SESSION_COMPLETED_EXTERNALLY') return;
  if (shadowRoot) {
    const widget = shadowRoot.querySelector('.widget-container');
    if (widget) {
      widget.classList.remove('visible');
      setTimeout(() => {
        widget.remove();
        showCompletionToast(message.duration || 0);
      }, 300);
      return;
    }
  }
  showCompletionToast(message.duration || 0);
});

// ── STORAGE CHANGE LISTENER ───────────────────────────────
// Debounced so START_SESSION storage write doesn't spawn a second widget
chrome.storage.onChanged.addListener((changes, area) => {
  try {
    if (!chrome.runtime.id) return;
    if (area === 'local' && changes.activeSessions) {
      if (toastVisible) return;
      clearTimeout(storageChangeTimeout);
      storageChangeTimeout = setTimeout(checkSessionState, 600);
    }
  } catch(e) { /* extension context invalidated — ignore */ }
});

// ── SPA NAVIGATION DETECTION ─────────────────────────────
setInterval(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    checkSessionState();
  }
}, 1000);

// ── INIT ─────────────────────────────────────────────────
setTimeout(checkSessionState, 500);