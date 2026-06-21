// Default domains seeded on first install
const DEFAULT_DOMAINS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'reddit.com', 'linkedin.com'
];

// Seed default domains on fresh install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ monitoredDomains: DEFAULT_DOMAINS });
  }
});

// Helper to clean and extract base domain
function getHostname(urlString) {
  try {
    const url = new URL(urlString);
    let host = url.hostname;
    if (host.startsWith('www.')) host = host.substring(4);
    return host;
  } catch (e) { return ''; }
}

// Read monitored domains from storage, seed defaults on first run
async function getMonitoredDomains() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['monitoredDomains'], (result) => {
      if (result.monitoredDomains && result.monitoredDomains.length > 0) {
        resolve(result.monitoredDomains);
      } else {
        chrome.storage.local.set({ monitoredDomains: DEFAULT_DOMAINS });
        resolve(DEFAULT_DOMAINS);
      }
    });
  });
}

// Find if hostname matches any user-configured monitored domain
async function getSocialDomain(hostname) {
  const domains = await getMonitoredDomains();
  for (const domain of domains) {
    if (hostname === domain || hostname.endsWith('.' + domain)) return domain;
  }
  return null;
}

// Read relevant state fields from extension local storage
async function getStorageData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['activeSessions', 'history'], (result) => {
      resolve({
        activeSessions: result.activeSessions || {},
        history: result.history || []
      });
    });
  });
}

// Set storage safely
async function setStorageData(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

// Clean up or complete active sessions for a specific tab ID
async function completeSession(tabId, data) {
  const session = data.activeSessions[tabId];
  if (!session) return;

  const endTime = Date.now();
  const duration = Math.round((endTime - session.startTime) / 1000); // in seconds

  // Store if navigation was at least a couple of seconds to maintain clean analytics logs
  if (duration >= 2) {
    const historyItem = {
      domain: session.domain,
      intention: session.intention,
      startTime: session.startTime,
      endTime: endTime,
      duration: duration
    };
    data.history.push(historyItem);

    // Keep today's entries (no cap) + last 7 days (max 50 older entries)
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const todayItems = data.history.filter(i => i.startTime >= startOfToday.getTime());
    const olderItems = data.history
      .filter(i => i.startTime >= sevenDaysAgo && i.startTime < startOfToday.getTime())
      .slice(-50); // keep only the most recent 50 from previous 7 days

    data.history = [...olderItems, ...todayItems];
  }

  delete data.activeSessions[tabId];
  await setStorageData(data);
}

// Tracks tabs that are mid-redirect to the intercept page, so we don't
// redirect them again in a loop while they're already on intercept.html
const redirectingTabs = new Set();

// Single listener that handles BOTH responsibilities:
// 1. Redirect to intercept.html the FIRST time a monitored domain is visited (no active session yet)
// 2. End the active session if the user navigates away from the monitored domain
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' && !changeInfo.url) return;

  let url = changeInfo.url || (tab && tab.url) || '';
  if (!url) {
    try {
      const tabInfo = await chrome.tabs.get(tabId);
      url = tabInfo.url || '';
    } catch (e) { url = ''; }
  }
  if (!url) return;

  // Never act on our own extension pages (prevents redirect loops)
  if (url.startsWith('chrome-extension://')) {
    redirectingTabs.delete(tabId);
    return;
  }

  const isInternalPage = !url.startsWith('http://') && !url.startsWith('https://');
  const hostname = getHostname(url);
  const socialDomain = isInternalPage ? null : await getSocialDomain(hostname);

  const data = await getStorageData();
  const activeSession = data.activeSessions[tabId];

  if (activeSession) {
    // There IS an active session for this tab — end it if user left the domain
    if (!socialDomain || socialDomain !== activeSession.domain) {
      const duration = Math.round((Date.now() - activeSession.startTime) / 1000);
      await completeSession(tabId, data);
      chrome.tabs.sendMessage(tabId, {
        type: 'SESSION_COMPLETED_EXTERNALLY', duration
      }).catch(() => {});
    }
    return;
  }

  // No active session — if this is a fresh visit to a monitored domain,
  // redirect to the intercept page instead of letting the site load
  if (socialDomain && !redirectingTabs.has(tabId)) {
    redirectingTabs.add(tabId);
    const interceptUrl = chrome.runtime.getURL('intercept.html') +
      '?domain=' + encodeURIComponent(socialDomain) +
      '&dest=' + encodeURIComponent(url);
    chrome.tabs.update(tabId, { url: interceptUrl }).catch(() => {});
    // Clear the redirecting flag shortly after — allows re-intercept on next fresh visit
    setTimeout(() => redirectingTabs.delete(tabId), 3000);
  }
});

// Clean up if the tab itself is removed/closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const data = await getStorageData();
  if (data.activeSessions[tabId]) {
    await completeSession(tabId, data);
  }
});

// Message listener processing tasks from Content Script and Popup Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  if (message.type === 'CHECK_SESSION') {
    if (!tabId) { sendResponse({ active: false }); return true; }
    (async () => {
      const data = await getStorageData();
      const session = data.activeSessions[tabId];
      const currentDomain = await getSocialDomain(getHostname(sender.tab.url));
      if (session && currentDomain === session.domain) {
        sendResponse({ active: true, session });
      } else {
        sendResponse({ active: false, domain: currentDomain });
      }
    })();
    return true;
  }

  if (message.type === 'START_SESSION') {
    if (!tabId) { sendResponse({ success: false }); return true; }
    (async () => {
      const data = await getStorageData();
      // On intercept.html, the real site's domain is passed explicitly
      // since sender.tab.url would just be the intercept page itself
      const currentDomain = message.domain || await getSocialDomain(getHostname(sender.tab.url));
      data.activeSessions[tabId] = {
        domain: currentDomain || 'social-media',
        intention: message.intention || 'Just browsing',
        startTime: Date.now()
      };
      await setStorageData(data);
      sendResponse({ success: true, session: data.activeSessions[tabId] });

      // If a destination URL was provided (from intercept.html), navigate there now
      if (message.dest) {
        chrome.tabs.update(tabId, { url: message.dest }).catch(() => {});
      }
    })();
    return true;
  }

  if (message.type === 'COMPLETE_SESSION') {
    const targetTabId = message.tabId || tabId;
    if (!targetTabId) { sendResponse({ success: false }); return true; }
    (async () => {
      const data = await getStorageData();
      const session = data.activeSessions[targetTabId];
      if (session) {
        const duration = message.actualDuration !== undefined
          ? message.actualDuration
          : Math.round((Date.now() - session.startTime) / 1000);
        await completeSession(targetTabId, data);
        chrome.tabs.sendMessage(targetTabId, {
          type: 'SESSION_COMPLETED_EXTERNALLY', duration
        }).catch(() => {});
        sendResponse({ success: true, duration });
      } else {
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  if (message.type === 'REQUEST_INTERCEPT_REDIRECT') {
    // Sent by content.js right after a session completes, while still on
    // a monitored domain — redirect back through intercept.html for a fresh intention
    if (tabId && message.domain) {
      (async () => {
        try {
          const tabInfo = await chrome.tabs.get(tabId);
          const currentUrl = tabInfo.url || '';
          if (currentUrl.startsWith('chrome-extension://')) return; // already on our page
          const interceptUrl = chrome.runtime.getURL('intercept.html') +
            '?domain=' + encodeURIComponent(message.domain) +
            '&dest=' + encodeURIComponent(currentUrl);
          redirectingTabs.add(tabId);
          chrome.tabs.update(tabId, { url: interceptUrl }).catch(() => {});
          setTimeout(() => redirectingTabs.delete(tabId), 3000);
        } catch (e) { /* tab may have closed */ }
      })();
    }
    return false; // no response needed
  }

  if (message.type === 'GET_DOMAINS') {
    getMonitoredDomains().then(domains => sendResponse({ domains }));
    return true;
  }

  if (message.type === 'SAVE_DOMAINS') {
    chrome.storage.local.set({ monitoredDomains: message.domains }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});