// Read domain and destination URL from query params
const params = new URLSearchParams(window.location.search);
const domain = params.get('domain') || '';
const dest = params.get('dest') || '';

// Populate site name + favicon
const cleanName = domain.split('.')[0];
const formattedDomain = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
document.getElementById('site-text').textContent = `You're visiting ${formattedDomain}`;

if (domain) {
  const favicon = document.getElementById('site-favicon');
  favicon.addEventListener('error', () => { favicon.style.display = 'none'; });
  favicon.src = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
}

// Fade in
requestAnimationFrame(() => {
  setTimeout(() => document.body.classList.add('visible'), 50);
});

const input = document.getElementById('intention-input');
input.focus();

// Guard against double-submit (Enter + button click firing together)
let submitted = false;

function submitIntent(textValue) {
  if (submitted) return;
  submitted = true;

  const finalVal = (textValue || '').trim() || 'Just browsing';

  chrome.runtime.sendMessage(
    { type: 'START_SESSION', intention: finalVal, domain, dest },
    (response) => {
      if (chrome.runtime.lastError) {
        // Background didn't respond — fall back to direct navigation
        if (dest) window.location.href = dest;
        return;
      }
      // background.js handles navigating the tab to `dest` after starting the session.
      // No need to navigate here — but as a safety net, do it anyway if nothing happened
      // within a short window (in case the background redirect silently failed).
      setTimeout(() => {
        if (dest && window.location.href.indexOf('intercept.html') !== -1) {
          window.location.href = dest;
        }
      }, 800);
    }
  );
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitIntent(input.value);
});

document.getElementById('btn-submit').addEventListener('click', () => {
  submitIntent(input.value);
});

document.getElementById('btn-browse').addEventListener('click', () => {
  submitIntent('Just browsing');
});