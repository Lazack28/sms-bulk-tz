// ==========================================
// TAPSA Bulk SMS - Frontend Application
// ==========================================

// Replace with your Firebase project config (from Firebase Console > Project Settings)
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// UI References
const screens = {
  auth: document.getElementById('auth-screen'),
  main: document.getElementById('main-screen')
};

const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const btnLogin = document.getElementById('btn-login');
const btnRegister = document.getElementById('btn-register');
const btnLogout = document.getElementById('btn-logout');
const userInfo = document.getElementById('user-info');

const navLinks = document.querySelectorAll('.nav-link');
const pages = document.querySelectorAll('.page');

// ==========================================
// Auth
// ==========================================

btnLogin.addEventListener('click', async () => {
  authError.textContent = '';
  try {
    await auth.signInWithEmailAndPassword(authEmail.value, authPassword.value);
  } catch (err) {
    authError.textContent = err.message;
  }
});

btnRegister.addEventListener('click', async () => {
  authError.textContent = '';
  try {
    await auth.createUserWithEmailAndPassword(authEmail.value, authPassword.value);
  } catch (err) {
    authError.textContent = err.message;
  }
});

btnLogout.addEventListener('click', () => auth.signOut());

auth.onAuthStateChanged(async (user) => {
  if (user) {
    screens.auth.classList.add('hidden');
    screens.main.classList.remove('hidden');
    userInfo.textContent = user.email;
    await loadDashboard();
  } else {
    screens.auth.classList.remove('hidden');
    screens.main.classList.add('hidden');
    authEmail.value = '';
    authPassword.value = '';
  }
});

// ==========================================
// API Helper
// ==========================================

async function api(path, options = {}) {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : '';
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {})
    },
    ...options
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(err.message || err.error || 'Request failed');
  }
  return res.status === 204 ? null : res.json();
}

// ==========================================
// Navigation
// ==========================================

function showPage(name) {
  pages.forEach(p => p.classList.add('hidden'));
  document.getElementById(`page-${name}`).classList.remove('hidden');
  navLinks.forEach(l => l.classList.toggle('active', l.dataset.page === name));

  if (name === 'contacts') loadContacts();
  if (name === 'groups') loadGroups();
  if (name === 'history') loadHistory();
  if (name === 'api-keys') loadApiKeys();
  if (name === 'sender-ids') loadSenderIds();
  if (name === 'send') loadSendPage();
}

navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    showPage(link.dataset.page);
  });
});

// ==========================================
// Dashboard
// ==========================================

async function loadDashboard() {
  try {
    const me = await api('/me');
    document.getElementById('dash-balance').textContent = (me.balance || 0) + ' SMS';
    document.getElementById('dash-contacts').textContent = (me.contactCount || '-');
  } catch (e) {
    document.getElementById('dash-balance').textContent = '-';
  }

  try {
    const history = await api('/history');
    document.getElementById('dash-sent').textContent = history.length;
  } catch {
    document.getElementById('dash-sent').textContent = '-';
  }
}

// ==========================================
// Send SMS
// ==========================================

const sendMessage = document.getElementById('send-message');
const charCount = document.getElementById('char-count');

sendMessage.addEventListener('input', () => {
  charCount.textContent = sendMessage.value.length;
});

async function loadSendPage() {
  try {
    const senders = await api('/sender-ids');
    const select = document.getElementById('send-sender-id');
    select.innerHTML = '<option value="TAPSA">TAPSA (default)</option>';
    senders.forEach(s => {
      if (String(s.status).toLowerCase() === 'approved') {
        select.innerHTML += `<option value="${s.senderId}">${s.senderId}</option>`;
      }
    });
  } catch {
    // fallback
  }
}

document.getElementById('btn-send').addEventListener('click', async () => {
  const recipients = document.getElementById('send-recipients').value;
  const message = sendMessage.value;
  const senderId = document.getElementById('send-sender-id').value;
  const statusEl = document.getElementById('send-status');
  statusEl.textContent = 'Sending...';
  statusEl.className = '';

  const numbers = recipients.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);

  try {
    const res = await api('/send', {
      method: 'POST',
      body: JSON.stringify({ phoneNumbers: numbers, message, senderId })
    });
    statusEl.textContent = res.message || 'Sent successfully!';
    statusEl.className = 'status-success';
    document.getElementById('send-recipients').value = '';
    sendMessage.value = '';
    charCount.textContent = '0';
    loadDashboard();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'status-error';
  }
});

// ==========================================
// Contacts
// ==========================================

let editingContactId = null;

async function loadContacts() {
  try {
    const contacts = await api('/contacts');
    const tbody = document.querySelector('#contacts-table tbody');
    tbody.innerHTML = contacts.map(c => `
      <tr data-id="${c.id}">
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.phone)}</td>
        <td>
          <button class="action-btn action-edit" data-id="${c.id}" data-name="${escapeHtml(c.name)}" data-phone="${escapeHtml(c.phone)}">Edit</button>
          <button class="action-btn action-delete" data-id="${c.id}">Delete</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.action-edit').forEach(btn => {
      btn.addEventListener('click', () => openContactModal(btn.dataset.id, btn.dataset.name, btn.dataset.phone));
    });
    tbody.querySelectorAll('.action-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteContact(btn.dataset.id));
    });
  } catch (err) {
    console.error('Contacts error:', err);
  }
}

function openContactModal(id = null, name = '', phone = '') {
  editingContactId = id;
  document.getElementById('contact-modal-title').textContent = id ? 'Edit Contact' : 'Add Contact';
  document.getElementById('contact-name').value = name;
  document.getElementById('contact-phone').value = phone;
  document.getElementById('contact-modal').classList.remove('hidden');
}

function closeContactModal() {
  editingContactId = null;
  document.getElementById('contact-modal').classList.add('hidden');
}

document.getElementById('btn-add-contact').addEventListener('click', () => openContactModal());
document.getElementById('btn-cancel-contact').addEventListener('click', closeContactModal);

document.getElementById('btn-save-contact').addEventListener('click', async () => {
  const name = document.getElementById('contact-name').value.trim();
  const phone = document.getElementById('contact-phone').value.trim();
  if (!name || !phone) return;

  try {
    if (editingContactId) {
      await api(`/contacts/${editingContactId}`, { method: 'PUT', body: JSON.stringify({ name, phone }) });
    } else {
      await api('/contacts', { method: 'POST', body: JSON.stringify({ name, phone }) });
    }
    closeContactModal();
    loadContacts();
    loadDashboard();
  } catch (err) {
    alert(err.message);
  }
});

async function deleteContact(id) {
  if (!confirm('Delete this contact?')) return;
  try {
    await api(`/contacts/${id}`, { method: 'DELETE' });
    loadContacts();
    loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

document.getElementById('contact-search').addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase();
  document.querySelectorAll('#contacts-table tbody tr').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(term) ? '' : 'none';
  });
});

// ==========================================
// Groups
// ==========================================

async function loadGroups() {
  try {
    const groups = await api('/groups');
    const tbody = document.querySelector('#groups-table tbody');
    tbody.innerHTML = groups.map(g => `
      <tr data-id="${g.id}">
        <td>${escapeHtml(g.name)}</td>
        <td>
          <button class="action-btn action-edit" data-id="${g.id}" data-name="${escapeHtml(g.name)}">Rename</button>
          <button class="action-btn action-delete" data-id="${g.id}">Delete</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.action-edit').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newName = prompt('New group name:', btn.dataset.name);
        if (!newName) return;
        try {
          await api(`/groups/${btn.dataset.id}`, { method: 'PUT', body: JSON.stringify({ name: newName }) });
          loadGroups();
        } catch (err) { alert(err.message); }
      });
    });

    tbody.querySelectorAll('.action-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this group?')) return;
        try {
          await api(`/groups/${btn.dataset.id}`, { method: 'DELETE' });
          loadGroups();
        } catch (err) { alert(err.message); }
      });
    });
  } catch (err) {
    console.error('Groups error:', err);
  }
}

document.getElementById('btn-create-group').addEventListener('click', async () => {
  const name = document.getElementById('group-name-input').value.trim();
  if (!name) return;
  try {
    await api('/groups', { method: 'POST', body: JSON.stringify({ name }) });
    document.getElementById('group-name-input').value = '';
    loadGroups();
  } catch (err) { alert(err.message); }
});

// ==========================================
// History
// ==========================================

async function loadHistory() {
  try {
    const history = await api('/history');
    const tbody = document.querySelector('#history-table tbody');
    tbody.innerHTML = history.map(h => `
      <tr>
        <td>${escapeHtml(h.number || '')}</td>
        <td>${escapeHtml(h.message || '')}</td>
        <td><span class="badge">${escapeHtml(h.status || '')}</span></td>
        <td>${h.timestamp ? new Date(h.timestamp.seconds ? h.timestamp.seconds * 1000 : h.timestamp).toLocaleString() : '-'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('History error:', err);
  }
}

// ==========================================
// API Keys
// ==========================================

async function loadApiKeys() {
  try {
    const keys = await api('/api-keys');
    const tbody = document.querySelector('#api-keys-table tbody');
    tbody.innerHTML = keys.map(k => `
      <tr data-id="${k.id}">
        <td>${escapeHtml(k.name)}</td>
        <td>${k.createdAt ? new Date(k.createdAt).toLocaleString() : '-'}</td>
        <td>${k.isActive ? 'Yes' : 'No'}</td>
        <td><button class="action-btn action-delete" data-id="${k.id}">Revoke</button></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.action-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Revoke this API key?')) return;
        try {
          await api(`/api-keys/${btn.dataset.id}`, { method: 'DELETE' });
          loadApiKeys();
        } catch (err) { alert(err.message); }
      });
    });
  } catch (err) {
    console.error('API keys error:', err);
  }
}

document.getElementById('btn-generate-key').addEventListener('click', async () => {
  const name = document.getElementById('api-key-name').value.trim();
  if (!name) return;
  try {
    const res = await api('/api-keys/generate', { method: 'POST', body: JSON.stringify({ name }) });
    document.getElementById('api-key-name').value = '';
    const banner = document.getElementById('new-key-banner');
    document.getElementById('new-key-value').textContent = res.apiKey;
    banner.classList.remove('hidden');
    loadApiKeys();
  } catch (err) { alert(err.message); }
});

// ==========================================
// Sender IDs
// ==========================================

async function loadSenderIds() {
  try {
    const senders = await api('/sender-ids');
    const tbody = document.querySelector('#sender-ids-table tbody');
    tbody.innerHTML = senders.map(s => `
      <tr>
        <td>${escapeHtml(s.senderId)}</td>
        <td>${escapeHtml(s.purpose || '')}</td>
        <td><span class="badge">${escapeHtml(s.status)}</span></td>
        <td>${s.createdAt ? new Date(s.createdAt.seconds ? s.createdAt.seconds * 1000 : s.createdAt).toLocaleString() : '-'}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Sender IDs error:', err);
  }
}

document.getElementById('btn-request-sender').addEventListener('click', async () => {
  const senderId = document.getElementById('sender-id-input').value.trim();
  const purpose = document.getElementById('sender-id-purpose').value.trim();
  if (!senderId || !purpose) return;
  try {
    await api('/sender-ids/request', { method: 'POST', body: JSON.stringify({ senderId, purpose }) });
    document.getElementById('sender-id-input').value = '';
    document.getElementById('sender-id-purpose').value = '';
    loadSenderIds();
  } catch (err) { alert(err.message); }
});

// ==========================================
// Utilities
// ==========================================

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Init dashboard on load
showPage('dashboard');
