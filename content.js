let shadowRoot = null;
let host = null;
let activeWidgetSession = null;
let lastUrl = window.location.href;

// No-op: flash prevention removed (document_idle guarantees body exists)
function liftFlashPrevention() {}

// Safely wraps chrome extension messages to avoid "Extension context invalidated" errors
function safeSendMessage(message, callback) {
  if (!chrome.runtime || !chrome.runtime.id) {
    liftFlashPrevention();
    return;
  }
  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      liftFlashPrevention();
      return;
    }
    if (callback) callback(response);
  });
}

// Retrieves the ideal insertion node depending on current parser/hydration state
function getMountTarget() {
  return document.body || document.documentElement;
}

// Securely creates the isolated Shadow DOM container
function createShadowContainer() {
  const target = getMountTarget();

  if (host && target.contains(host)) {
    return shadowRoot;
  }

  // Migrate host container if it was previously mounted on documentElement instead of body
  if (host && host.parentNode && host.parentNode !== target) {
    host.remove();
  }

  host = document.createElement('div');
  host.id = 'intent-guard-shadow-host';
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '100vw';
  host.style.height = '100vh';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'none'; // only set to 'all' when overlay is active

  shadowRoot = host.attachShadow({ mode: 'open' });
  target.appendChild(host);

  // Set up loop-free MutationObserver to persist against client-side SPA routing resets
  const observer = new MutationObserver(() => {
    const activeTarget = getMountTarget();
    if (host && !activeTarget.contains(host)) {
      observer.disconnect();
      activeTarget.appendChild(host);
      observer.observe(document.documentElement, { childList: true });
      if (document.body) {
        observer.observe(document.body, { childList: true });
      }
    }
  });

  observer.observe(document.documentElement, { childList: true });
  if (document.body) {
    observer.observe(document.body, { childList: true });
  }

  return shadowRoot;
}

// Checks state and redraws UI accordingly
function checkSessionState() {
  safeSendMessage({ type: 'CHECK_SESSION' }, (response) => {
    const container = createShadowContainer();

    if (response && response.active) {
      liftFlashPrevention();
      
      const overlay = container.querySelector('.overlay-backdrop');
      if (overlay) {
        overlay.remove();
        restoreScrolling();
      }

      const currentWidget = container.querySelector('.widget-container');
      if (currentWidget) return; // widget already present, do not spawn a second one
      activeWidgetSession = response.session;
      showWidget(response.session);
    } else {
      const currentWidget = container.querySelector('.widget-container');
      if (currentWidget) {
        currentWidget.remove();
        activeWidgetSession = null;
      }

      const overlay = container.querySelector('.overlay-backdrop');
      if (!overlay && response && response.domain) {
        showOverlay(response.domain);
      } else {
        liftFlashPrevention();
      }
    }
  });
}

function lockScrolling() {
  document.documentElement.style.setProperty('overflow', 'hidden', 'important');
  if (document.body) {
    document.body.style.setProperty('overflow', 'hidden', 'important');
  }
}

function restoreScrolling() {
  document.documentElement.style.removeProperty('overflow');
  if (document.body) {
    document.body.style.removeProperty('overflow');
  }
}

function injectStyles(root) {
  if (root.querySelector('style')) return;
  const style = document.createElement('style');
  root.appendChild(style);
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
    
    :host {
      all: initial;
      font-size: 16px !important;
      line-height: 1.5 !important;
    }

    * {
      box-sizing: border-box;
      font-family: 'DM Sans', sans-serif;
      font-size: inherit;
      line-height: inherit;
    }

    /* OVERLAY BACKGROUND CONFIGURATION */
    .overlay-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.97);
      display: flex;
      justify-content: center;
      align-items: center;
      pointer-events: auto;
      opacity: 0;
      transition: opacity 250ms ease;
      z-index: 2147483647;
    }

    .overlay-backdrop.visible {
      opacity: 1;
    }

    .content-block {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      opacity: 0;
      transform: translateY(16px);
      transition: transform 350ms ease, opacity 350ms ease;
      transition-delay: 100ms;
    }

    .overlay-backdrop.visible .content-block {
      opacity: 1;
      transform: translateY(0);
    }

    .label-top {
      font-size: 11px;
      letter-spacing: 0.25em;
      color: #555;
      text-transform: uppercase;
      font-weight: 600;
    }

    .site-line {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 32px;
    }

    .site-favicon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #222;
    }

    .site-text {
      font-size: 28px;
      font-weight: 300;
      color: #ffffff;
    }

    .main-heading {
      font-size: 48px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.1;
      margin: 12px 0 0 0;
    }

    .subtext {
      font-size: 15px;
      color: #666;
      margin: 8px 0 0 0;
    }

    .intention-input {
      width: 480px;
      max-width: 90vw;
      margin-top: 40px;
      background: transparent;
      border: none;
      border-bottom: 1.5px solid #333;
      color: #ffffff;
      font-size: 20px;
      font-weight: 400;
      padding: 12px 0;
      outline: none;
      text-align: center;
      transition: border-bottom-color 0.2s ease;
    }

    .intention-input::placeholder {
      color: #444;
    }

    .intention-input:focus {
      border-bottom-color: #ffffff;
    }

    .btn-row {
      display: flex;
      gap: 12px;
      margin-top: 40px;
    }

    .btn-primary {
      background: #ffffff;
      color: #000000;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.05em;
      padding: 14px 36px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      transition: background 0.2s ease;
    }

    .btn-primary:hover {
      background: #e0e0e0;
    }

    .btn-secondary {
      background: transparent;
      color: #555;
      font-size: 14px;
      font-weight: 500;
      padding: 14px 24px;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      cursor: pointer;
      transition: border-color 0.2s ease, color 0.2s ease;
    }

    .btn-secondary:hover {
      border-color: #555;
      color: #888;
    }

    .footer-hint {
      font-size: 12px;
      color: #3a3a3a;
      margin-top: 20px;
    }

    /* REDESIGNED FLOATING WIDGET */
    .widget-container {
      position: fixed;
      bottom: 28px;
      right: 28px;
      z-index: 2147483647;
      pointer-events: auto;
      user-select: none;
      opacity: 0;
      transform: translateX(120%);
      transition: transform 400ms ease, opacity 400ms ease;
    }

    .widget-container.visible {
      opacity: 1;
      transform: translateX(0);
    }

    .widget-container.dragging {
      transition: none !important;
    }

    .widget-card {
      background: rgba(15, 15, 15, 0.85);
      backdrop-filter: blur(16px) saturate(180%);
      -webkit-backdrop-filter: blur(16px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 16px;
      padding: 16px 20px;
      min-width: 220px;
      max-width: 280px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      cursor: grab;
    }

    .widget-card:active {
      cursor: grabbing;
    }

    @keyframes alertGlow {
      0%   { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0px 0px rgba(200,60,60,0);      border-color: rgba(255,255,255,0.07); }
      30%  { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 16px 4px rgba(200,60,60,0.45);  border-color: rgba(200,80,80,0.6); }
      50%  { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 26px 7px rgba(200,60,60,0.65);  border-color: rgba(200,80,80,0.85); }
      70%  { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 16px 4px rgba(200,60,60,0.45);  border-color: rgba(200,80,80,0.6); }
      100% { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0px 0px rgba(200,60,60,0);      border-color: rgba(255,255,255,0.07); }
    }

    .widget-card.glow-alert {
      animation: alertGlow 2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }

    .widget-row1 {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .widget-dot {
      width: 6px;
      height: 6px;
      background-color: #10b981;
      border-radius: 50%;
    }

    .widget-label {
      font-size: 10px;
      color: #555;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.05em;
    }

    .widget-row2-intention {
      font-size: 14px;
      color: #ffffff;
      font-weight: 500;
      margin-top: 8px;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: normal;
    }

    .widget-row3-timer {
      font-size: 12px;
      font-family: monospace;
      color: #888;
      margin-top: 6px;
    }

    .widget-row4-btn {
      width: 100%;
      background: #ffffff;
      color: #000000;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      padding: 8px;
      margin-top: 12px;
      border: none;
      cursor: pointer;
      text-align: center;
      transition: background 0.2s ease;
    }

    .widget-row4-btn:hover {
      background: #e0e0e0;
    }

    /* TOAST BANNER NOTIFICATION */
    .toast-notification {
      position: fixed;
      bottom: 32px;
      left: 50%;
      transform: translate(-50%, 100px);
      background: #0f172a;
      color: #ffffff;
      padding: 14px 28px;
      border-radius: 16px;
      font-size: 14px !important;
      font-weight: 600;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
      z-index: 2147483647;
      pointer-events: none;
      transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s;
      opacity: 0;
    }

    .toast-notification.visible {
      transform: translate(-50%, 0);
      opacity: 1;
    }
  `;
}

function showOverlay(domain) {
  const root = createShadowContainer();
  injectStyles(root);

  // Lock target site interaction layer
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
        <img class="site-favicon" src="${faviconUrl}" alt="${formattedDomain}" onerror="this.style.display='none'">
        <span class="site-text">You're visiting ${formattedDomain}</span>
      </div>
      <h1 class="main-heading">What's your intention?</h1>
      <p class="subtext">State your purpose. Stay focused.</p>
      <input type="text" class="intention-input" placeholder="e.g., Check messages from mom" autofocus>
      <div class="btn-row">
        <button class="btn-primary" id="btn-submit">Let me in</button>
        <button class="btn-secondary" id="btn-browse">Just browsing</button>
      </div>
      <div class="footer-hint">Press Enter to continue</div>
    </div>
  `;

  root.appendChild(backdrop);
  host.style.pointerEvents = 'all'; // block site clicks while overlay is active
  
  // Lift visibility hidden override now that full screen backdrop is ready
  liftFlashPrevention();

  // Trigger smooth modal display animation
  setTimeout(() => {
    backdrop.classList.add('visible');
    const input = backdrop.querySelector('.intention-input');
    if (input) input.focus();
  }, 50);

  let submitted = false;
  const submitIntent = (textValue) => {
    if (submitted) return;
    submitted = true;
    const finalVal = textValue.trim() || 'Just browsing';
    safeSendMessage({
      type: 'START_SESSION',
      intention: finalVal
    }, (response) => {
      if (response && response.success) {
        clearInterval(scrollLockInterval);
        restoreScrolling();
        host.style.pointerEvents = 'none'; // widget showing next — allow site clicks

        backdrop.classList.remove('visible');
        setTimeout(() => {
          backdrop.remove();
          showWidget(response.session);
        }, 350);
      }
    });
  };

  backdrop.querySelector('#btn-submit').addEventListener('click', () => {
    const textVal = backdrop.querySelector('.intention-input').value;
    submitIntent(textVal);
  });

  backdrop.querySelector('#btn-browse').addEventListener('click', () => {
    submitIntent('Just browsing');
  });

  const intentionInput = backdrop.querySelector('.intention-input');

  // Stop ALL keyboard events from bubbling out of the input to the host page.
  // Sites like Twitter, YouTube and Instagram intercept keydown/keyup/keypress
  // globally and swallow keys (space, arrows, letters) before they reach
  // any input field they don't own — this prevents that entirely.
  ['keydown', 'keyup', 'keypress'].forEach(eventType => {
    intentionInput.addEventListener(eventType, (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.key === 'Enter') {
        submitIntent(intentionInput.value);
      }
    });
  });

  // Also stop the input's focus/click events from propagating
  intentionInput.addEventListener('click', (e) => e.stopPropagation());
  intentionInput.addEventListener('focus', (e) => e.stopPropagation());
}

function showWidget(session) {
  const root = createShadowContainer();
  injectStyles(root);

  const widgetContainer = document.createElement('div');
  widgetContainer.className = 'widget-container';
  
  // Set default starting position
  widgetContainer.style.bottom = '28px';
  widgetContainer.style.right = '28px';

  widgetContainer.innerHTML = `
    <div class="widget-card">
      <div class="widget-row1">
        <div class="widget-dot"></div>
        <span class="widget-label">Active Intention</span>
      </div>
      <div class="widget-row2-intention" title="${escapeHtml(session.intention)}">
        ${escapeHtml(session.intention)}
      </div>
      <div class="widget-row3-timer">00:00 elapsed</div>
      <button class="widget-row4-btn" id="btn-complete">Mark done ✓</button>
    </div>
  `;

  root.appendChild(widgetContainer);

  setTimeout(() => widgetContainer.classList.add('visible'), 50);

  // Timer configuration
  const timerEl = widgetContainer.querySelector('.widget-row3-timer');
  const updateTimerValue = () => {
    const duration = Math.floor((Date.now() - session.startTime) / 1000);
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;

    const pad = (num) => String(num).padStart(2, '0');
    timerEl.textContent = `${pad(mins)}:${pad(secs)} elapsed`;
  };
  updateTimerValue();
  let timerInterval = setInterval(updateTimerValue, 1000);

  // Grab references early so they are available inside visibilitychange handler
  const widgetCard = widgetContainer.querySelector('.widget-card');
  const btnComplete = widgetContainer.querySelector('#btn-complete');

  // When tab becomes visible again after being hidden, Chrome may have throttled
  // the interval — clear and restart it so the timer and buttons wake up instantly
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      clearInterval(timerInterval);
      updateTimerValue(); // immediately correct the displayed time
      timerInterval = setInterval(updateTimerValue, 1000);
      // Reaffirm pointer events on the host and widget — some SPAs reset styles while tab is hidden
      if (host) host.style.pointerEvents = 'none';
      widgetContainer.style.pointerEvents = 'auto';
      widgetCard.style.pointerEvents = 'auto';
      btnComplete.style.pointerEvents = 'auto';
    } else {
      // Tab going hidden — pause interval to save resources
      clearInterval(timerInterval);
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Alert glow — fires at exact multiples of the chosen interval
  let glowInterval = null;

  function triggerGlow() {
    const card = widgetContainer.querySelector('.widget-card');
    if (!card) return;
    card.classList.remove('glow-alert');
    void card.offsetWidth; // reflow to restart animation
    card.classList.add('glow-alert');
    setTimeout(() => card.classList.remove('glow-alert'), 2200);
  }

  function startGlowInterval() {
    if (glowInterval) clearInterval(glowInterval);

    // Check every 10 seconds for precision — but only glow at exact interval multiples
    glowInterval = setInterval(() => {
      chrome.storage.local.get(['glowEnabled', 'glowMinutes'], prefs => {
        if (prefs.glowEnabled === false) return;
        const intervalMs = (prefs.glowMinutes || 10) * 60 * 1000;
        const elapsed = Date.now() - session.startTime;
        if (elapsed < intervalMs) return; // haven't hit first interval yet

        // How many complete intervals have passed?
        const intervalsPassed = Math.floor(elapsed / intervalMs);
        // When did the latest interval boundary occur?
        const lastBoundary = session.startTime + intervalsPassed * intervalMs;
        // Fire only if we're within a 10s window of that boundary
        const sinceLastBoundary = Date.now() - lastBoundary;
        if (sinceLastBoundary <= 10000) {
          triggerGlow();
        }
      });
    }, 10000); // poll every 10 seconds
  }

  // Initial load of glow settings
  chrome.storage.local.get(['glowEnabled', 'glowMinutes'], prefs => {
    if (prefs.glowEnabled !== false) {
      startGlowInterval();
    }
  });

  // Drag and Drop implementation details
  let isDragging = false;
  let startX, startY, origX, origY;

  widgetCard.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;

    isDragging = true;
    widgetContainer.classList.add('dragging');
    const rect = widgetContainer.getBoundingClientRect();

    // Convert fixed positioning to direct pixel layout coordinates
    widgetContainer.style.right = 'auto';
    widgetContainer.style.bottom = 'auto';
    widgetContainer.style.left = `${rect.left}px`;
    widgetContainer.style.top = `${rect.top}px`;

    startX = e.clientX;
    startY = e.clientY;
    origX = rect.left;
    origY = rect.top;

    document.addEventListener('mousemove', dragHandler);
    document.addEventListener('mouseup', releaseHandler);
    e.preventDefault();
  });

  function dragHandler(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let targetX = origX + dx;
    let targetY = origY + dy;

    // Viewport window constraints
    const rightBoundary = window.innerWidth - widgetContainer.offsetWidth - 8;
    const bottomBoundary = window.innerHeight - widgetContainer.offsetHeight - 8;

    targetX = Math.max(8, Math.min(targetX, rightBoundary));
    targetY = Math.max(8, Math.min(targetY, bottomBoundary));

    widgetContainer.style.left = `${targetX}px`;
    widgetContainer.style.top = `${targetY}px`;
  }

  function releaseHandler() {
    isDragging = false;
    widgetContainer.classList.remove('dragging');
    document.removeEventListener('mousemove', dragHandler);
    document.removeEventListener('mouseup', releaseHandler);
  }

  // Completion task trigger
  btnComplete.addEventListener('click', () => {
    safeSendMessage({ type: 'COMPLETE_SESSION' }, (response) => {
      clearInterval(timerInterval);
      if (glowInterval) clearInterval(glowInterval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      widgetContainer.classList.remove('visible');
      setTimeout(() => {
        widgetContainer.remove();
        if (response && response.success) {
          showCompletionToast(response.duration);
        }
      }, 300);
    });
  });
}

function showCompletionToast(durationInSeconds) {
  const root = createShadowContainer();
  const toast = document.createElement('div');
  toast.className = 'toast-notification';

  const mins = Math.floor(durationInSeconds / 60);
  const secs = durationInSeconds % 60;
  const timeString = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  toast.innerHTML = `✓ Session complete! Time spent: <strong>${timeString}</strong>`;
  root.appendChild(toast);

  toastVisible = true;
  setTimeout(() => toast.classList.add('visible'), 50);

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => {
      toast.remove();
      toastVisible = false;
      // Safely tear down container if empty
      if (root.children.length <= 1 && host) {
        host.remove();
        host = null;
        shadowRoot = null;
      }
      // Now safe to show the next overlay
      checkSessionState();
    }, 400);
  }, 1200);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Watch for storage updates from external completions (such as manual termination via popup)
// Use a short debounce to avoid double-widget on session start (storage fires right after submitIntent callback)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.activeSessions) {
    if (toastVisible) return; // wait — toast is showing, checkSessionState fires after it clears
    clearTimeout(storageChangeTimeout);
    storageChangeTimeout = setTimeout(checkSessionState, 600);
  }
});

// Direct message from background when session is completed via the popup
// This is more reliable than waiting for storage.onChanged
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'SESSION_COMPLETED_EXTERNALLY') return;

  // Find and tear down the active widget if present
  if (shadowRoot) {
    const widgetContainer = shadowRoot.querySelector('.widget-container');
    if (widgetContainer) {
      widgetContainer.classList.remove('visible');
      setTimeout(() => {
        widgetContainer.remove();
        showCompletionToast(message.duration);
      }, 300);
      return;
    }
  }

  // No widget found — session was already gone, just show overlay for next intent
  showCompletionToast(message.duration);
});

// Watch for client-side SPA route URL changes
setInterval(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    checkSessionState();
  }
}, 1000);

// Initialize application state check
if (document.body) {
  checkSessionState();
} else {
  document.addEventListener('DOMContentLoaded', checkSessionState);
}