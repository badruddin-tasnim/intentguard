# 🎯 IntentGuard

**Pause before you scroll.** IntentGuard is a Chrome extension that asks what you're here for before you enter social media — and keeps you focused until you're done.

Extension Link: https://chromewebstore.google.com/detail/intentguard/eoejkcoopacecmjcknnfchbhacocldpj

---

## What it does

Instead of mindlessly opening Instagram, YouTube, or Twitter out of habit, IntentGuard intercepts the page with a full-screen prompt asking: **"What's your intention?"**

You type your goal, hit enter, and a small floating widget tracks your intention and elapsed time for the rest of the session. When you're done, you mark the session complete — and the extension logs it.

That one moment of friction is often enough to make you stop and think before scrolling out of habit.

---

## Features

### 🎯 Intention Prompt
A clean, full-screen overlay appears every time you visit a monitored site. Type your purpose or click "Just browsing" to proceed. Built with a Shadow DOM so it never collides with the host page's styles.

### 📌 Persistent Reminder Widget
A draggable floating widget stays on screen showing your intention and a live timer. After a few seconds of inactivity it auto-minimizes into a small pill (timer + truncated intention text) and expands smoothly on hover.

### 🔔 Alert Glow + Sound
After a configurable interval (2 / 5 / 10 / 15 minutes), the widget pulses with a red glow and the entire screen edge flashes red — paired with a subtle audio beep — as a recurring reminder that you're still active. Fully toggleable in Settings.

### 📊 Session History
Every completed session is logged with site, intention, date, and duration. History is grouped into **Today** and **Previous 7 Days**, capped at 100 entries total to keep storage lean.

### ⚙️ Custom Site List
Not limited to a fixed list — add any domain you want monitored, or remove any of the defaults (Facebook, Instagram, X, Reddit, LinkedIn) from the Settings tab.

### 🖥️ Multi-Tab Support
Each tab tracks its own session independently. The popup shows all active sessions across every open tab with live timers and one-click completion.

### 🌙 Dark, Modern UI
Every surface — the overlay, the widget, the popup — follows a consistent dark design language with smooth, subtle animations throughout.

---

## How it works (architecture)

```
┌─────────────────┐         ┌──────────────────┐
│   content.js     │◄───────►│   background.js  │
│  (per-tab UI)    │ messages │ (service worker)  │
└─────────────────┘         └──────────────────┘
        │                            │
        ▼                            ▼
  Shadow DOM overlay         chrome.storage.local
  + floating widget          (sessions, history,
                               settings, domains)
```

- **`background.js`** — the service worker. Tracks active sessions per tab, detects navigation away from monitored sites (including home button / internal page navigation), completes and archives sessions to history, and exposes a small message-based API (`CHECK_SESSION`, `START_SESSION`, `COMPLETE_SESSION`, `GET_DOMAINS`, `SAVE_DOMAINS`).
- **`content.js`** — injected into every page. Builds the intention overlay and the floating widget inside a Shadow DOM (so host page CSS can never leak in or out). Handles SPA navigation detection, drag-to-reposition, auto-minimize, the alert glow/sound system, and tab visibility changes.
- **`popup.html` / `popup.js`** — the toolbar popup. Three tabs: **Sessions** (live view of all active tabs), **History** (grouped log), and **Settings** (monitored domains + alert glow/sound configuration).

---

## Tech stack

- **Manifest V3** — the current Chrome extension standard
- **Vanilla JavaScript** — zero dependencies, zero build step
- **Shadow DOM** — for complete style isolation from host pages
- **Web Audio API** — generates the alert beep procedurally, no audio file shipped
- **`chrome.storage.local`** — all data stored locally, nothing leaves the device

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Save sessions, history, and settings locally on the device |
| `host_permissions: *://*/*` | Inject the intention prompt on whatever domains the user adds to their custom monitored list |

No `tabs` or `webNavigation` permission is declared — tab lifecycle and navigation detection are handled through `chrome.tabs.onUpdated` and `chrome.tabs.onRemoved`, which work correctly under host permissions alone.

---

## Installation (developer / unpacked)

1. Clone this repo:
   ```bash
   git clone https://github.com/YOURUSERNAME/intentguard.git
   ```
2. Open Chrome and navigate to:
   ```
   chrome://extensions
   ```
3. Toggle **Developer mode** on (top right)
4. Click **Load unpacked**
5. Select the cloned `intentguard` folder

The extension icon will appear in your toolbar. Pin it for easy access.

---

## Project structure

```
intentguard/
├── manifest.json          # Extension configuration (Manifest V3)
├── background.js          # Service worker — session lifecycle, storage, messaging
├── content.js              # Injected UI — overlay, widget, glow, sound
├── popup.html               # Toolbar popup markup + styles
├── popup.js                  # Toolbar popup logic
├── logo.svg                   # Extension logo
├── icon.png                    # Toolbar icon (16/48/128)
└── privacy-policy.html          # Hosted privacy policy (GitHub Pages)
```

---

## Privacy

IntentGuard stores everything locally on your device via `chrome.storage.local`. Nothing is transmitted to any server, with one exception: a favicon image is fetched from Google's public favicon API (`google.com/s2/favicons`) to display site icons — only the domain name is sent, nothing else.

No accounts, no analytics, no tracking, no third-party data sharing.

Full privacy policy: [`privacy-policy.html`](./privacy-policy.html)

---

## Known limitations

- Domains using aggressive global keyboard shortcuts (YouTube, Twitter/X) are explicitly handled by stopping event propagation on the intention input — if you find a site where this still breaks, please open an issue
- The alert beep requires at least one prior user gesture on the page (per browser autoplay policy) — this is satisfied automatically by clicking "Let me in" when starting a session

---

## Contributing

Issues and pull requests are welcome. If you're reporting a bug, please include:
- The site domain it occurred on
- Steps to reproduce
- Browser version (`chrome://version`)

---

## Acknowledgements

Built iteratively with a lot of real-world bug hunting — timer drift, Shadow DOM pointer-event quirks, SPA navigation detection, audio autoplay policies, and Chrome Web Store review cycles all shaped this into its current form.
