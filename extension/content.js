// content.js - Loadboard Helper SmartBoard content script
// Injects SmartBoard UI, parses load board DOM, and provides dispatcher tools.

const DEFAULT_COLUMNS = [
  { key: 'broker', label: 'Broker', width: 160 },
  { key: 'origin', label: 'Origin', width: 140 },
  { key: 'destination', label: 'Destination', width: 140 },
  { key: 'pickup', label: 'Pickup', width: 140 },
  { key: 'equipment', label: 'Equipment', width: 110 },
  { key: 'weight', label: 'Weight', width: 90 },
  { key: 'rate', label: 'Rate', width: 90 },
  { key: 'rpm', label: 'RPM', width: 80 },
  { key: 'contact', label: 'Contact', width: 160 },
  { key: 'email', label: 'Email', width: 180 },
  { key: 'factoring', label: 'Factoring', width: 120 },
  { key: 'actions', label: 'Actions', width: 200 }
];

const DEFAULT_FILTERS = {
  minRpm: '',
  equipment: '',
  originState: '',
  destState: '',
  weightMax: '',
  hideCancelled: true,
  hideDuplicates: true
};

const state = {
  loads: new Map(),
  filters: { ...DEFAULT_FILTERS },
  columnOrder: DEFAULT_COLUMNS.map(c => c.key),
  hiddenColumns: new Set(),
  emailTemplate: {
    subject: 'Load inquiry - {{origin}} to {{destination}}',
    body: 'Hello {{broker}},%0D%0A%0D%0AWe can cover the load from {{origin}} to {{destination}} on {{pickup}}. Driver status: offloaded, location: Dallas, TX. Please confirm rate {{rate}}.%0D%0A%0D%0AThanks!',
    from: ''
  },
  telegramWebhook: ''
};

const ui = {
  container: null,
  tableBody: null,
  headerRow: null,
  mapPanel: null,
  reviewModal: null
};

/**
 * Loads persisted settings into state.
 */
async function hydrateSettings() {
  const result = await chrome.storage.local.get({
    filters: DEFAULT_FILTERS,
    columnOrder: DEFAULT_COLUMNS.map(c => c.key),
    hiddenColumns: [],
    emailTemplate: state.emailTemplate,
    telegramWebhook: ''
  });
  state.filters = { ...DEFAULT_FILTERS, ...(result.filters || {}) };
  state.columnOrder = result.columnOrder || DEFAULT_COLUMNS.map(c => c.key);
  state.hiddenColumns = new Set(result.hiddenColumns || []);
  state.emailTemplate = { ...state.emailTemplate, ...(result.emailTemplate || {}) };
  state.telegramWebhook = result.telegramWebhook || '';
}

/**
 * Saves user preferences.
 */
function persistSettings() {
  chrome.storage.local.set({
    filters: state.filters,
    columnOrder: state.columnOrder,
    hiddenColumns: Array.from(state.hiddenColumns),
    emailTemplate: state.emailTemplate,
    telegramWebhook: state.telegramWebhook
  });
}

/**
 * Simple hash to position mock markers on the map.
 * @param {string} text
 * @returns {{x:number,y:number}}
 */
function hashToPoint(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash << 5) - hash + text.charCodeAt(i);
  const x = Math.abs(hash % 100);
  const y = Math.abs((hash >> 1) % 100);
  return { x, y };
}

/**
 * Renders the integrated map panel. For production, replace with Google Maps or Leaflet.
 * @param {object} load
 */
function renderMap(load) {
  if (!ui.mapPanel || !load) return;
  const originPoint = hashToPoint(load.origin || 'origin');
  const destPoint = hashToPoint(load.destination || 'dest');
  ui.mapPanel.innerHTML = `
    <div class="lh-panel">
      <div class="lh-space-between">
        <h3>Route preview</h3>
        <span class="lh-badge">Mock map - plug in Google Maps API</span>
      </div>
      <div class="lh-map" aria-label="Map preview">
        <svg class="route" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="${originPoint.x}" y1="${originPoint.y}" x2="${destPoint.x}" y2="${destPoint.y}" stroke="#22d3ee" stroke-width="2" stroke-dasharray="3 3" />
        </svg>
        <div class="marker origin" style="left:${originPoint.x}%; top:${originPoint.y}%" title="${load.origin}"></div>
        <div class="marker dest" style="left:${destPoint.x}%; top:${destPoint.y}%" title="${load.destination}"></div>
        <div style="position:absolute;left:12px;bottom:12px;color:var(--lh-muted);font-size:12px;">
          ${load.origin || 'Origin'} → ${load.destination || 'Destination'}
        </div>
      </div>
    </div>
  `;
}

/**
 * Creates the SmartBoard shell and control panels.
 */
function buildUI() {
  ui.container = document.createElement('section');
  ui.container.className = 'loadhunter-helper';
  ui.container.innerHTML = `
    <div class="lh-toolbar lh-space-between">
      <div class="lh-flex" style="gap:10px;">
        <strong>Loadboard Helper · SmartBoard</strong>
        <span class="lh-badge" id="lh-load-count">0 loads</span>
      </div>
      <div class="lh-flex" style="gap:10px;">
        <label class="lh-dark-toggle"><input type="checkbox" id="lh-dark-toggle" checked> Dark mode</label>
        <button class="lh-button" id="lh-refresh">Refresh</button>
      </div>
    </div>
    <div class="lh-grid">
      <div class="lh-panel lh-filters" id="lh-filters"></div>
      <div class="lh-panel" id="lh-table-panel">
        <div class="lh-space-between" style="margin-bottom:8px;">
          <h3>SmartBoard</h3>
          <div class="lh-flex" style="gap:6px;">
            <button class="lh-button" id="lh-column-visibility">Columns</button>
            <button class="lh-button" id="lh-clear-loads">Clear</button>
          </div>
        </div>
        <div class="lh-table-container">
          <table class="lh-table">
            <thead><tr id="lh-header"></tr></thead>
            <tbody id="lh-body"></tbody>
          </table>
        </div>
      </div>
      <div id="lh-map"></div>
    </div>
  `;
  document.body.prepend(ui.container);
  ui.tableBody = ui.container.querySelector('#lh-body');
  ui.headerRow = ui.container.querySelector('#lh-header');
  ui.mapPanel = ui.container.querySelector('#lh-map');
  renderFilters();
  renderHeaders();
  registerUIEvents();
}

/**
 * Renders filter controls.
 */
function renderFilters() {
  const filtersEl = ui.container.querySelector('#lh-filters');
  filtersEl.innerHTML = `
    <div class="lh-space-between" style="margin-bottom:8px;">
      <h3>Filters</h3>
      <button class="lh-button" id="lh-save-filters">Save</button>
    </div>
    <div class="lh-filters" style="display:grid;gap:8px;grid-template-columns:repeat(2,1fr);">
      <label>Min RPM<input id="lh-filter-rpm" type="number" step="0.01" value="${state.filters.minRpm}"></label>
      <label>Equipment<input id="lh-filter-eq" value="${state.filters.equipment}"></label>
      <label>Origin State<input id="lh-filter-os" maxlength="2" value="${state.filters.originState}"></label>
      <label>Destination State<input id="lh-filter-ds" maxlength="2" value="${state.filters.destState}"></label>
      <label>Max Weight (lbs)<input id="lh-filter-weight" type="number" value="${state.filters.weightMax}"></label>
      <label>Hide cancelled<input type="checkbox" id="lh-filter-cancel" ${state.filters.hideCancelled ? 'checked' : ''}></label>
      <label>Hide duplicates<input type="checkbox" id="lh-filter-dupe" ${state.filters.hideDuplicates ? 'checked' : ''}></label>
      <label>Telegram webhook<input id="lh-webhook" placeholder="https://api.telegram.org/..." value="${state.telegramWebhook}"></label>
    </div>
  `;
}

/**
 * Renders column headers with drag/drop for ordering and toggles for visibility.
 */
function renderHeaders() {
  ui.headerRow.innerHTML = '';
  state.columnOrder.forEach(key => {
    const column = DEFAULT_COLUMNS.find(c => c.key === key);
    if (!column || state.hiddenColumns.has(key)) return;
    const th = document.createElement('th');
    th.textContent = column.label;
    th.dataset.key = key;
    th.draggable = true;
    th.style.width = `${column.width}px`;
    th.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', key));
    th.addEventListener('dragover', e => e.preventDefault());
    th.addEventListener('drop', e => {
      e.preventDefault();
      const from = e.dataTransfer.getData('text/plain');
      reorderColumns(from, key);
    });
    ui.headerRow.appendChild(th);
  });
}

/**
 * Reorders columns and re-renders table.
 * @param {string} fromKey
 * @param {string} toKey
 */
function reorderColumns(fromKey, toKey) {
  const fromIndex = state.columnOrder.indexOf(fromKey);
  const toIndex = state.columnOrder.indexOf(toKey);
  if (fromIndex === -1 || toIndex === -1) return;
  state.columnOrder.splice(fromIndex, 1);
  state.columnOrder.splice(toIndex, 0, fromKey);
  persistSettings();
  renderHeaders();
  renderRows();
}

/**
 * Adds or removes column visibility.
 * @param {string} key
 */
function toggleColumn(key) {
  if (state.hiddenColumns.has(key)) state.hiddenColumns.delete(key);
  else state.hiddenColumns.add(key);
  persistSettings();
  renderHeaders();
  renderRows();
}

/**
 * Determines if a load passes the active filters.
 * @param {LoadRow} load
 */
function passesFilters(load) {
  const { minRpm, equipment, originState, destState, weightMax, hideCancelled } = state.filters;
  if (minRpm && Number(load.rpm || 0) < Number(minRpm)) return false;
  if (equipment && !(load.equipment || '').toLowerCase().includes(equipment.toLowerCase())) return false;
  if (originState && !(load.origin || '').toLowerCase().includes(originState.toLowerCase())) return false;
  if (destState && !(load.destination || '').toLowerCase().includes(destState.toLowerCase())) return false;
  if (weightMax && Number(load.weight || 0) > Number(weightMax)) return false;
  if (hideCancelled && /cancel/i.test(load.status || '')) return false;
  return true;
}

/**
 * Basic duplicate detection by broker + origin + destination + pickup date.
 * @param {LoadRow} load
 */
function isDuplicate(load) {
  const key = `${load.broker}|${load.origin}|${load.destination}|${load.pickup}`;
  for (const existing of state.loads.values()) {
    const existingKey = `${existing.broker}|${existing.origin}|${existing.destination}|${existing.pickup}`;
    if (existingKey === key) return true;
  }
  return false;
}

/**
 * Mock factoring rating.
 * @param {string} brokerMC
 */
function fetchFactoringRating(brokerMC) {
  const rating = (Math.floor(Math.random() * 5) + 1);
  return `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} (${brokerMC || 'MC N/A'})`;
}

/**
 * Renders load rows respecting filters and column order.
 */
function renderRows() {
  if (!ui.tableBody) return;
  ui.tableBody.innerHTML = '';
  let visibleCount = 0;
  for (const load of state.loads.values()) {
    if (state.filters.hideDuplicates && isDuplicate(load)) continue;
    if (!passesFilters(load)) continue;
    visibleCount++;
    const tr = document.createElement('tr');
    tr.dataset.loadId = load.id;
    tr.addEventListener('click', () => renderMap(load));
    state.columnOrder.forEach(key => {
      if (state.hiddenColumns.has(key)) return;
      const td = document.createElement('td');
      td.dataset.column = key;
      if (key === 'actions') {
        td.append(buildActions(load));
      } else if (key === 'factoring') {
        td.textContent = fetchFactoringRating(load.mc || '');
        td.appendChild(reviewLink(load));
      } else {
        td.innerHTML = formatCell(load, key);
      }
      tr.appendChild(td);
    });
    ui.tableBody.appendChild(tr);
  }
  const badge = ui.container.querySelector('#lh-load-count');
  if (badge) badge.textContent = `${visibleCount} loads`;
}

/**
 * Formats cell content safely.
 * @param {LoadRow} load
 * @param {string} key
 */
function formatCell(load, key) {
  const value = load[key] || '';
  if (key === 'rate') {
    return `<span class="lh-pill">${value || '$-'} / ${load.miles || '-'} mi</span>`;
  }
  if (key === 'contact' && load.phone) {
    return `${value || ''}<div class="lh-muted">${load.phone}</div>`;
  }
  if (key === 'rpm') {
    const rpm = load.rpm || calculateRpm(load.rate, load.miles);
    return rpm ? rpm.toFixed(2) : '';
  }
  return value;
}

/**
 * Builds action buttons for a row.
 * @param {LoadRow} load
 */
function buildActions(load) {
  const wrapper = document.createElement('div');
  wrapper.className = 'lh-flex';

  const emailBtn = document.createElement('button');
  emailBtn.className = 'lh-button';
  emailBtn.textContent = 'Email broker';
  emailBtn.addEventListener('click', e => {
    e.stopPropagation();
    openEmail(load);
  });

  const profitBtn = document.createElement('button');
  profitBtn.className = 'lh-button';
  profitBtn.textContent = 'Profit';
  profitBtn.addEventListener('click', e => {
    e.stopPropagation();
    openProfitModal(load);
  });

  const copyBtn = document.createElement('button');
  copyBtn.className = 'lh-button';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', e => {
    e.stopPropagation();
    navigator.clipboard.writeText(JSON.stringify(load, null, 2));
  });

  wrapper.append(emailBtn, profitBtn, copyBtn);
  return wrapper;
}

/**
 * Returns a link to open reviews modal.
 * @param {LoadRow} load
 */
function reviewLink(load) {
  const link = document.createElement('button');
  link.className = 'lh-button';
  link.textContent = 'Reviews';
  link.addEventListener('click', e => {
    e.stopPropagation();
    openReviewsModal(load);
  });
  return link;
}

/**
 * Calculates RPM from rate and miles.
 * @param {number|string} rate
 * @param {number|string} miles
 */
function calculateRpm(rate, miles) {
  const r = Number(String(rate).replace(/[^0-9.]/g, ''));
  const m = Number(miles || 0);
  if (!r || !m) return 0;
  return r / m;
}

/**
 * Opens mailto with templated subject/body.
 * @param {LoadRow} load
 */
function openEmail(load) {
  const template = state.emailTemplate;
  const subject = template.subject
    .replace('{{origin}}', load.origin || '')
    .replace('{{destination}}', load.destination || '')
    .replace('{{pickup}}', load.pickup || '')
    .replace('{{broker}}', load.broker || '');
  const body = template.body
    .replace('{{origin}}', load.origin || '')
    .replace('{{destination}}', load.destination || '')
    .replace('{{pickup}}', load.pickup || '')
    .replace('{{rate}}', load.rate || '')
    .replace('{{broker}}', load.broker || '');
  const recipient = load.email || '';
  const from = template.from ? `&from=${encodeURIComponent(template.from)}` : '';
  const href = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${body}${from}`;
  window.location.href = href;
}

/**
 * Opens profit calculator modal.
 */
function openProfitModal(load) {
  const backdrop = document.createElement('div');
  backdrop.className = 'lh-modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'lh-modal';
  modal.innerHTML = `
    <h3>Profit calculator</h3>
    <p>${load.origin} → ${load.destination}</p>
    <label>Fuel cost per mile <input id="lh-fuel" type="number" step="0.01" value="0.6"></label>
    <label>Tolls <input id="lh-tolls" type="number" step="0.01" value="0"></label>
    <div class="lh-flex" style="margin-top:12px;">
      <button class="lh-button" id="lh-calc">Calculate</button>
      <button class="lh-button danger" id="lh-close">Close</button>
    </div>
    <div id="lh-profit-result" style="margin-top:10px;"></div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  modal.querySelector('#lh-close').addEventListener('click', () => backdrop.remove());
  modal.querySelector('#lh-calc').addEventListener('click', () => {
    const fuel = Number(modal.querySelector('#lh-fuel').value || 0);
    const tolls = Number(modal.querySelector('#lh-tolls').value || 0);
    const miles = Number(load.miles || 0);
    const rate = Number(String(load.rate || '').replace(/[^0-9.]/g, ''));
    const profit = rate - (fuel * miles) - tolls;
    const rpm = miles ? profit / miles : 0;
    modal.querySelector('#lh-profit-result').innerHTML = `Profit: $${profit.toFixed(2)} · RPM: ${rpm.toFixed(2)}`;
  });
}

/**
 * Opens broker reviews modal with local storage persistence.
 */
async function openReviewsModal(load) {
  const storageKey = `reviews:${load.broker}`;
  const stored = await chrome.storage.local.get({ [storageKey]: [] });
  const reviews = stored[storageKey] || [];
  const backdrop = document.createElement('div');
  backdrop.className = 'lh-modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'lh-modal lh-reviews';
  modal.innerHTML = `
    <div class="lh-space-between" style="margin-bottom:8px;">
      <h3>Reviews · ${load.broker || 'Broker'}</h3>
      <button class="lh-button danger" id="lh-close-review">Close</button>
    </div>
    <textarea id="lh-review-text" placeholder="Share your experience"></textarea>
    <div class="lh-space-between" style="margin-top:8px;">
      <button class="lh-button" id="lh-save-review">Save review</button>
      <span class="lh-muted">Stored locally</span>
    </div>
    <ul id="lh-review-list"></ul>
  `;
  const list = modal.querySelector('#lh-review-list');
  reviews.forEach(r => {
    const li = document.createElement('li');
    li.textContent = r;
    list.appendChild(li);
  });
  modal.querySelector('#lh-save-review').addEventListener('click', () => {
    const text = modal.querySelector('#lh-review-text').value.trim();
    if (!text) return;
    reviews.push(text);
    chrome.storage.local.set({ [storageKey]: reviews });
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
    modal.querySelector('#lh-review-text').value = '';
  });
  modal.querySelector('#lh-close-review').addEventListener('click', () => backdrop.remove());
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

/**
 * Handles filter changes and persistence.
 */
function registerFilterEvents() {
  const rpm = ui.container.querySelector('#lh-filter-rpm');
  const eq = ui.container.querySelector('#lh-filter-eq');
  const os = ui.container.querySelector('#lh-filter-os');
  const ds = ui.container.querySelector('#lh-filter-ds');
  const weight = ui.container.querySelector('#lh-filter-weight');
  const cancel = ui.container.querySelector('#lh-filter-cancel');
  const dupe = ui.container.querySelector('#lh-filter-dupe');
  const webhook = ui.container.querySelector('#lh-webhook');
  const save = ui.container.querySelector('#lh-save-filters');

  const update = () => {
    state.filters = {
      minRpm: rpm.value,
      equipment: eq.value,
      originState: os.value,
      destState: ds.value,
      weightMax: weight.value,
      hideCancelled: cancel.checked,
      hideDuplicates: dupe.checked
    };
    state.telegramWebhook = webhook.value;
    persistSettings();
    renderRows();
  };

  [rpm, eq, os, ds, weight, cancel, dupe, webhook].forEach(el => el.addEventListener('input', update));
  save.addEventListener('click', update);
}

/**
 * Binds top-level UI events.
 */
function registerUIEvents() {
  registerFilterEvents();
  ui.container.querySelector('#lh-refresh').addEventListener('click', scanPage);
  ui.container.querySelector('#lh-clear-loads').addEventListener('click', () => {
    state.loads.clear();
    renderRows();
  });
  ui.container.querySelector('#lh-column-visibility').addEventListener('click', openColumnModal);
  ui.container.querySelector('#lh-dark-toggle').addEventListener('change', e => {
    const root = document.documentElement;
    if (e.target.checked) root.style.setProperty('--lh-bg', '#0f172a');
    else root.style.setProperty('--lh-bg', '#f8fafc');
  });
}

/**
 * Opens column manager modal.
 */
function openColumnModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'lh-modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'lh-modal';
  modal.innerHTML = `
    <div class="lh-space-between" style="margin-bottom:8px;">
      <h3>Columns</h3>
      <button class="lh-button danger" id="lh-close-cols">Close</button>
    </div>
    <div id="lh-col-list" style="display:flex;flex-direction:column;gap:6px;"></div>
  `;
  const list = modal.querySelector('#lh-col-list');
  DEFAULT_COLUMNS.forEach(col => {
    const row = document.createElement('label');
    row.className = 'lh-flex';
    row.style.justifyContent = 'space-between';
    row.innerHTML = `<span>${col.label}</span><input type="checkbox" ${state.hiddenColumns.has(col.key) ? '' : 'checked'} data-key="${col.key}">`;
    list.appendChild(row);
  });
  list.addEventListener('change', e => {
    const key = e.target.dataset.key;
    toggleColumn(key);
  });
  modal.querySelector('#lh-close-cols').addEventListener('click', () => backdrop.remove());
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

/**
 * Parses load rows from the host DOM. This uses generic selectors and should be adjusted per load board.
 */
function parseLoadsFromDOM() {
  const rows = document.querySelectorAll('[data-load-id], .load-row, tr[data-id]');
  const parsed = [];
  rows.forEach(row => {
    const id = row.getAttribute('data-load-id') || row.getAttribute('data-id') || row.innerText;
    if (!id) return;
    const text = row.innerText;
    const broker = row.querySelector('[data-broker], .broker, .company')?.textContent?.trim() || '';
    const email = row.querySelector('a[href^="mailto:"]')?.getAttribute('href')?.replace('mailto:', '') || '';
    const contact = row.querySelector('[data-contact], .contact, .phone')?.textContent?.trim() || '';
    const origin = row.querySelector('[data-origin], .origin, .from')?.textContent?.trim() || extractSegment(text, 0);
    const destination = row.querySelector('[data-destination], .destination, .to')?.textContent?.trim() || extractSegment(text, 1);
    const pickup = row.querySelector('[data-pickup], .pickup, .date')?.textContent?.trim() || '';
    const equipment = row.querySelector('[data-equipment], .equipment')?.textContent?.trim() || '';
    const weight = row.querySelector('[data-weight], .weight')?.textContent?.trim() || '';
    const rate = row.querySelector('[data-rate], .rate, .price')?.textContent?.trim() || '';
    const miles = Number(row.querySelector('[data-miles], .miles')?.textContent?.replace(/[^0-9.]/g, '') || 0);
    const rpm = calculateRpm(rate, miles);
    const mc = row.querySelector('[data-mc], .mc')?.textContent?.trim() || '';
    parsed.push({ id, broker, email, contact, origin, destination, pickup, equipment, weight, rate, miles, rpm, phone: contact, mc });
  });
  return parsed;
}

function extractSegment(text, index) {
  const parts = text.split('\n').map(t => t.trim()).filter(Boolean);
  return parts[index] || '';
}

/**
 * Observes DOM for changes and re-parses batches.
 */
function installObserver() {
  const observer = new MutationObserver(() => {
    window.clearTimeout(installObserver.debounce);
    installObserver.debounce = window.setTimeout(scanPage, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Scans the page, parses loads, updates state, and notifies.
 */
function scanPage() {
  const parsed = parseLoadsFromDOM();
  let newLoads = 0;
  parsed.forEach(load => {
    if (!state.loads.has(load.id)) {
      state.loads.set(load.id, load);
      newLoads++;
      maybeNotify(load);
    } else {
      state.loads.set(load.id, { ...state.loads.get(load.id), ...load });
    }
  });
  renderRows();
  chrome.storage.local.set({ lastLoads: Array.from(state.loads.values()).slice(-50) });
  if (newLoads) {
    chrome.runtime.sendMessage({ type: 'ping' }, () => {});
  }
}

/**
 * Triggers notifications when filters match.
 * @param {LoadRow} load
 */
function maybeNotify(load) {
  if (!passesFilters(load)) return;
  const message = `${load.origin} → ${load.destination} @ ${load.rate || 'TBD'}`;
  chrome.runtime.sendMessage({ type: 'notify', title: 'New matching load', message });
  if (state.telegramWebhook) {
    chrome.runtime.sendMessage({ type: 'telegram', url: state.telegramWebhook, payload: load });
  }
}

/**
 * Initializes SmartBoard after settings load.
 */
async function init() {
  await hydrateSettings();
  buildUI();
  renderMap({ origin: 'Waiting', destination: 'Select a load' });
  scanPage();
  installObserver();
}

init();

/**
 * @typedef {Object} LoadRow
 * @property {string} id
 * @property {string} broker
 * @property {string} email
 * @property {string} contact
 * @property {string} origin
 * @property {string} destination
 * @property {string} pickup
 * @property {string} equipment
 * @property {string} weight
 * @property {string|number} rate
 * @property {number} miles
 * @property {number} rpm
 * @property {string} phone
 * @property {string} mc
 */
