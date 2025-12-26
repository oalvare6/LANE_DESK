// options.js - manages templates, email accounts, filters, and Telegram webhook

const DEFAULT_TEMPLATE = {
  subject: 'Load inquiry - {{origin}} to {{destination}}',
  body: 'Hello {{broker}},%0D%0AWe can cover this load from {{origin}} to {{destination}} on {{pickup}}.',
  from: ''
};

const DEFAULT_FILTERS = {
  minRpm: '',
  equipment: '',
  originState: '',
  destState: '',
  weightMax: '',
  hideCancelled: true,
  hideDuplicates: true
};

const accounts = new Set();

async function loadSettings() {
  const stored = await chrome.storage.local.get({
    emailTemplate: DEFAULT_TEMPLATE,
    emailAccounts: [],
    filters: DEFAULT_FILTERS,
    telegramWebhook: ''
  });
  const template = stored.emailTemplate || DEFAULT_TEMPLATE;
  document.getElementById('tmpl-subject').value = template.subject;
  document.getElementById('tmpl-body').value = template.body.replace(/%0D%0A/g, '\n');
  stored.emailAccounts.forEach(a => accounts.add(a));
  renderAccountOptions(template.from || stored.emailAccounts[0] || '');

  const filters = { ...DEFAULT_FILTERS, ...(stored.filters || {}) };
  document.getElementById('opt-rpm').value = filters.minRpm;
  document.getElementById('opt-eq').value = filters.equipment;
  document.getElementById('opt-os').value = filters.originState;
  document.getElementById('opt-ds').value = filters.destState;
  document.getElementById('opt-weight').value = filters.weightMax;
  document.getElementById('opt-cancel').checked = filters.hideCancelled;
  document.getElementById('opt-dupe').checked = filters.hideDuplicates;
  document.getElementById('opt-webhook').value = stored.telegramWebhook || '';
}

function renderAccountOptions(selected) {
  const select = document.getElementById('tmpl-from');
  select.innerHTML = '';
  accounts.forEach(email => {
    const opt = document.createElement('option');
    opt.value = email;
    opt.textContent = email;
    if (email === selected) opt.selected = true;
    select.appendChild(opt);
  });
}

function bindEvents() {
  document.getElementById('add-account').addEventListener('click', () => {
    const input = document.getElementById('new-account');
    const email = input.value.trim();
    if (email && /@/.test(email)) {
      accounts.add(email);
      renderAccountOptions(email);
      chrome.storage.local.set({ emailAccounts: Array.from(accounts) });
      input.value = '';
    }
  });

  document.getElementById('save-template').addEventListener('click', () => {
    const subject = document.getElementById('tmpl-subject').value;
    const body = document.getElementById('tmpl-body').value.replace(/\n/g, '%0D%0A');
    const from = document.getElementById('tmpl-from').value;
    chrome.storage.local.set({ emailTemplate: { subject, body, from } });
  });

  document.getElementById('save-filters').addEventListener('click', () => {
    const filters = {
      minRpm: document.getElementById('opt-rpm').value,
      equipment: document.getElementById('opt-eq').value,
      originState: document.getElementById('opt-os').value,
      destState: document.getElementById('opt-ds').value,
      weightMax: document.getElementById('opt-weight').value,
      hideCancelled: document.getElementById('opt-cancel').checked,
      hideDuplicates: document.getElementById('opt-dupe').checked
    };
    const telegramWebhook = document.getElementById('opt-webhook').value;
    chrome.storage.local.set({ filters, telegramWebhook });
  });
}

loadSettings();
bindEvents();
