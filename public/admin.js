const secretInput = document.getElementById('admin-secret');
const connectBtn = document.getElementById('connect-btn');
const loginError = document.getElementById('login-error');
const dashboard = document.getElementById('dashboard');
const clientSelect = document.getElementById('client-select');
const clientDetails = document.getElementById('client-details');
const pingBtn = document.getElementById('ping-btn');
const infoBtn = document.getElementById('info-btn');
const execForm = document.getElementById('exec-form');
const execCommandInput = document.getElementById('exec-command');
const listBtn = document.getElementById('list-btn');
const readBtn = document.getElementById('read-btn');
const saveBtn = document.getElementById('save-btn');
const upBtn = document.getElementById('up-btn');
const refreshBtn = document.getElementById('refresh-btn');
const currentPathDisplay = document.getElementById('current-path-display');
const fileListEl = document.getElementById('file-list');
const pathInput = document.getElementById('path-input');
const fileContentInput = document.getElementById('file-content');
const logEl = document.getElementById('log');
const clearLogBtn = document.getElementById('clear-log-btn');

let socket;
let clients = [];
let currentClientId = null;
let currentPath = '';

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.textContent = `${line}\n${logEl.textContent}`;
}

function setClientDetails(client) {
  if (!client) {
    clientDetails.innerHTML = '<p>No client selected.</p>';
    return;
  }
  clientDetails.innerHTML = `
    <p><strong>ID:</strong> ${client.clientId}</p>
    <p><strong>Status:</strong> ${client.status}</p>
    <p><strong>Platform:</strong> ${client.metadata.platform || 'unknown'}</p>
    <p><strong>Hostname:</strong> ${client.metadata.hostname || 'unknown'}</p>
    <p><strong>Arch:</strong> ${client.metadata.arch || 'unknown'}</p>
  `;
}

function renderClients(list) {
  clients = list;
  clientSelect.innerHTML = '';

  if (!clients.length) {
    clientSelect.innerHTML = '<option value="">No clients connected</option>';
    setClientDetails(null);
    return;
  }

  clients.forEach((client, index) => {
    const option = document.createElement('option');
    option.value = client.clientId;
    option.textContent = `${client.clientId} (${client.status})`;
    clientSelect.appendChild(option);
    if (index === 0) {
      currentClientId = client.clientId;
    }
  });

  clientSelect.value = currentClientId || clients[0].clientId;
  setClientDetails(clients.find((c) => c.clientId === clientSelect.value));
}

function normalizePath(input) {
  return input.replace(/\\/g, '/');
}

function joinPath(base, name) {
  if (!base) return name;
  const delimiter = base.includes('\\') ? '\\' : '/';
  const trimmedBase = base.replace(/[\\/]+$/, '');
  if (trimmedBase === '' || trimmedBase === '/' || /^[A-Za-z]:$/.test(trimmedBase)) {
    return `${trimmedBase}${delimiter}${name}`;
  }
  return `${trimmedBase}${delimiter}${name}`;
}

function parentPath(path) {
  if (!path) return '';
  const normalized = normalizePath(path).replace(/\/+/g, '/');
  if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized;
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return normalized.startsWith('/') ? '/' : `${normalized.split('/')[0]}/`;
  }
  const parent = parts.slice(0, -1).join('/');
  if (normalized.startsWith('/')) return `/${parent}`;
  if (/^[A-Za-z]:$/.test(parts[0])) return `${parts[0]}/${parts.slice(1, -1).join('/')}`;
  return parent;
}

function setCurrentPath(path) {
  currentPath = path;
  currentPathDisplay.textContent = path || 'No path selected';
  pathInput.value = path || '';
}

function sendCommand(command, args = {}) {
  if (!currentClientId) {
    log('No client selected.');
    return;
  }
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload = { type: 'command', clientId: currentClientId, command, args, requestId };
  socket.send(JSON.stringify(payload));
  log(`Sent '${command}' to ${currentClientId}`);
  return requestId;
}

function browsePath(path) {
  if (!path) {
    log('Path is required to browse.');
    return;
  }
  setCurrentPath(path);
  sendCommand('list_dir', { path });
}

function renderFileList(entries) {
  fileListEl.innerHTML = '';
  if (!Array.isArray(entries) || entries.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No files or folders found.';
    empty.style.color = '#94a3b8';
    fileListEl.appendChild(empty);
    return;
  }
  entries.forEach((entry) => {
    const li = document.createElement('li');
    li.className = entry.type === 'dir' ? 'dir' : 'file';
    const name = document.createElement('span');
    name.textContent = entry.name;
    const typeLabel = document.createElement('small');
    typeLabel.textContent = entry.type;
    li.appendChild(name);
    li.appendChild(typeLabel);
    li.addEventListener('click', () => {
      const targetPath = joinPath(currentPath, entry.name);
      if (entry.type === 'dir') {
        browsePath(targetPath);
      } else {
        setCurrentPath(targetPath);
        sendCommand('read_file', { path: targetPath });
      }
    });
    fileListEl.appendChild(li);
  });
}

connectBtn.addEventListener('click', async () => {
  const secret = secretInput.value.trim();
  if (!secret) {
    loginError.textContent = 'Admin secret is required.';
    return;
  }
  loginError.textContent = '';
  await loginAdmin(secret);
});

clientSelect.addEventListener('change', () => {
  currentClientId = clientSelect.value;
  setClientDetails(clients.find((c) => c.clientId === currentClientId));
});

pingBtn.addEventListener('click', () => sendCommand('ping'));
infoBtn.addEventListener('click', () => sendCommand('info'));

execForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const command = execCommandInput.value.trim();
  if (!command) {
    log('Shell command is required.');
    return;
  }
  sendCommand('exec', { command });
  execCommandInput.value = '';
});

listBtn.addEventListener('click', () => {
  const path = pathInput.value.trim();
  if (!path) {
    log('Path is required to list directory.');
    return;
  }
  browsePath(path);
});

readBtn.addEventListener('click', () => {
  const path = pathInput.value.trim();
  if (!path) {
    log('Path is required to read file.');
    return;
  }
  setCurrentPath(path);
  sendCommand('read_file', { path });
});

saveBtn.addEventListener('click', () => {
  const path = pathInput.value.trim();
  if (!path) {
    log('Path is required to save file.');
    return;
  }
  sendCommand('write_file', { path, content: fileContentInput.value });
});

upBtn.addEventListener('click', () => {
  const parent = parentPath(currentPath);
  if (!parent) {
    log('Cannot go up from current path.');
    return;
  }
  browsePath(parent);
});

refreshBtn.addEventListener('click', () => {
  if (!currentPath) {
    log('No current path to refresh.');
    return;
  }
  browsePath(currentPath);
});

clearLogBtn.addEventListener('click', () => {
  logEl.textContent = '';
});

async function loginAdmin(secret) {
  const response = await fetch('/api/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
  });

  const data = await response.json();
  if (!data.ok) {
    loginError.textContent = data.message || 'Login failed.';
    return;
  }
  connectSocket();
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws`;
  socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'auth', role: 'admin' }));
  });

  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'auth_success') {
      document.getElementById('login-panel').classList.add('hidden');
      dashboard.classList.remove('hidden');
      log('Connected as admin.');
      return;
    }

    if (data.type === 'auth_error') {
      loginError.textContent = data.message || 'Authentication failed.';
      socket.close();
      return;
    }

    if (data.type === 'client_list') {
      renderClients(data.clients || []);
      return;
    }

    if (data.type === 'result') {
      if (data.command === 'list_dir') {
        if (Array.isArray(data.result)) {
          renderFileList(data.result);
          log(`Directory list received from ${data.clientId}.`);
        } else {
          fileContentInput.value = JSON.stringify(data.result, null, 2);
          log(`Directory list returned unexpected result from ${data.clientId}.`);
        }
        return;
      }

      if (data.command === 'read_file') {
        fileContentInput.value = data.success ? data.result.content : '';
        log(data.success ? `Read file from ${data.clientId}.` : `Read file error: ${data.error}`);
        return;
      }

      if (data.command === 'write_file') {
        log(data.success ? `Saved file on ${data.clientId}.` : `Write file error: ${data.error}`);
        return;
      }

      const output = data.success ? JSON.stringify(data.result, null, 2) : `ERROR: ${data.error}`;
      log(`Response from ${data.clientId} for ${data.requestId}: ${output}`);
      return;
    }

    if (data.type === 'command_error') {
      log(`Command error: ${data.message}`);
      return;
    }
  });

  socket.addEventListener('close', () => {
    log('Connection closed. Refresh the page to reconnect.');
  });

  socket.addEventListener('error', (error) => {
    log('WebSocket error.');
    console.error(error);
  });
}
