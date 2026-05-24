const DEFAULT_DOMAINS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'tiktok.com', 'youtube.com', 'reddit.com', 'linkedin.com',
  'snapchat.com', 'pinterest.com', 'threads.net'
];

function getHostname(urlString) {
  try {
    const url = new URL(urlString);
    let host = url.hostname;
    if (host.startsWith('www.')) host = host.substring(4);
    return host;
  } catch (e) { return ''; }
}

async function getMonitoredDomains() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['monitoredDomains'], (result) => {
      if (result.monitoredDomains && result.monitoredDomains.length > 0) {
        resolve(result.monitoredDomains);
      } else {
        // First run — seed with defaults and save
        chrome.storage.local.set({ monitoredDomains: DEFAULT_DOMAINS });
        resolve(DEFAULT_DOMAINS);
      }
    });
  });
}

async function getSocialDomain(hostname) {
  const domains = await getMonitoredDomains();
  for (const domain of domains) {
    if (hostname === domain || hostname.endsWith('.' + domain)) return domain;
  }
  return null;
}

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

async function setStorageData(data) {
  return new Promise((resolve) => { chrome.storage.local.set(data, resolve); });
}

async function completeSession(tabId, data) {
  const session = data.activeSessions[tabId];
  if (!session) return;
  const endTime = Date.now();
  const duration = Math.round((endTime - session.startTime) / 1000);
  if (duration >= 2) {
    const historyItem = { domain: session.domain, intention: session.intention, startTime: session.startTime, endTime, duration };
    data.history.push(historyItem);
    // Keep today + last 7 days, max 100 entries
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    data.history = data.history.filter(item =>
      item.startTime >= startOfToday.getTime() || item.startTime >= sevenDaysAgo
    );
    if (data.history.length > 100) {
      data.history = data.history.slice(-100);
    }
  }
  delete data.activeSessions[tabId];
  await setStorageData(data);
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const hostname = getHostname(changeInfo.url);
    const socialDomain = await getSocialDomain(hostname);
    const data = await getStorageData();
    const activeSession = data.activeSessions[tabId];
    if (activeSession) {
      if (!socialDomain || socialDomain !== activeSession.domain) {
        await completeSession(tabId, data);
      }
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const data = await getStorageData();
  if (data.activeSessions[tabId]) await completeSession(tabId, data);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  if (message.type === 'CHECK_SESSION') {
    if (!tabId) { sendResponse({ active: false }); return; }
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
    if (!tabId) { sendResponse({ success: false }); return; }
    (async () => {
      const data = await getStorageData();
      const currentDomain = await getSocialDomain(getHostname(sender.tab.url));
      data.activeSessions[tabId] = {
        domain: currentDomain || 'social-media',
        intention: message.intention || 'Just browsing',
        startTime: Date.now()
      };
      await setStorageData(data);
      sendResponse({ success: true, session: data.activeSessions[tabId] });
    })();
    return true;
  }

  if (message.type === 'COMPLETE_SESSION') {
    const targetTabId = message.tabId || tabId;
    if (!targetTabId) { sendResponse({ success: false }); return; }
    (async () => {
      const data = await getStorageData();
      const session = data.activeSessions[targetTabId];
      if (session) {
        const duration = Math.round((Date.now() - session.startTime) / 1000);
        await completeSession(targetTabId, data);
        // Directly notify the tab's content script to tear down widget + show overlay
        chrome.tabs.sendMessage(targetTabId, {
          type: 'SESSION_COMPLETED_EXTERNALLY',
          duration
        }).catch(() => {}); // tab may be closed or inactive — ignore errors
        sendResponse({ success: true, duration });
      } else {
        sendResponse({ success: false });
      }
    })();
    return true;
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