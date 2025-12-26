// background.js - service worker for Loadboard Helper
// Handles notifications and optional Telegram webhooks.

/**
 * Dispatches a Chrome notification.
 * @param {string} title
 * @param {string} message
 */
async function showNotification(title, message) {
  if (!('Notification' in self)) return;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message
  });
}

/**
 * Attempts to send a Telegram webhook payload. The URL is user-provided and should be a fully qualified endpoint.
 * @param {string} url
 * @param {object} payload
 */
async function sendTelegramWebhook(url, payload) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Telegram webhook failed', error);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'notify') {
    showNotification(message.title, message.message);
  }
  if (message.type === 'telegram') {
    sendTelegramWebhook(message.url, message.payload);
  }
  if (message.type === 'ping') {
    sendResponse({ ok: true });
  }
  return true;
});
