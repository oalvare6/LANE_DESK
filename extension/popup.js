// popup.js - summarizes active loads and notifications

async function loadRecent() {
  const { lastLoads = [] } = await chrome.storage.local.get({ lastLoads: [] });
  const list = document.getElementById('load-list');
  list.innerHTML = '';
  if (!lastLoads.length) {
    list.innerHTML = '<li class="lh-muted">No loads observed yet.</li>';
  }
  lastLoads.slice(-10).reverse().forEach(load => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="lh-space-between">
        <div>
          <strong>${load.origin || 'Origin'} → ${load.destination || 'Destination'}</strong>
          <div class="lh-muted">${load.pickup || ''} · ${load.equipment || ''}</div>
        </div>
        <span class="lh-pill">${load.rate || 'TBD'}</span>
      </div>`;
    list.appendChild(li);
  });
  document.getElementById('status').textContent = `${lastLoads.length} captured`;
}

document.addEventListener('DOMContentLoaded', loadRecent);
