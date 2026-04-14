const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const session = require('express-session');
const dotenv = require('dotenv');

dotenv.config();

const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin-secret';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'client-secret';
const SESSION_SECRET = process.env.SESSION_SECRET || 'session-secret';
const HTTPS_KEY = process.env.HTTPS_KEY;
const HTTPS_CERT = process.env.HTTPS_CERT;

const app = express();
app.use(express.json());

// Trust the first proxy (Replit)
app.set('trust proxy', 1);

const sessionParser = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: 'auto', // Works with Replit's proxy
    httpOnly: true,
    sameSite: 'lax',
  },
});
app.use(sessionParser);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/api/login', (req, res) => {
  const { secret } = req.body || {};
  if (secret !== ADMIN_SECRET) {
    return res.status(401).json({ ok: false, message: 'Invalid secret.' });
  }
  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.get('/api/auth-status', (req, res) => {
  res.json({ ok: Boolean(req.session?.isAdmin) });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

let server;
if (HTTPS_KEY && HTTPS_CERT && fs.existsSync(HTTPS_KEY) && fs.existsSync(HTTPS_CERT)) {
  try {
    server = https.createServer({ 
      key: fs.readFileSync(HTTPS_KEY), 
      cert: fs.readFileSync(HTTPS_CERT) 
    }, app);
  } catch (err) {
    console.error('Failed to create HTTPS server, falling back to HTTP:', err.message);
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws') {
    socket.destroy();
    return;
  }

  sessionParser(request, {}, () => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.session = request.session;
      wss.emit('connection', ws, request);
    });
  });
});

const agents = new Map();
const adminSockets = new Set();

function getAgentInfo(agentSocket) {
  return {
    clientId: agentSocket.clientId,
    status: agentSocket.status || 'online',
    metadata: agentSocket.metadata || {},
    connectedAt: agentSocket.connectedAt || Date.now(),
  };
}

function broadcastClientList() {
  const list = Array.from(agents.values()).map(getAgentInfo);
  const payload = JSON.stringify({ type: 'client_list', clients: list });
  adminSockets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

function broadcastToAdmins(payload) {
  const json = JSON.stringify(payload);
  adminSockets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (error) {
      return;
    }

    if (data.type === 'auth') {
      if (data.role === 'admin') {
        if (!ws.session?.isAdmin) {
          ws.send(JSON.stringify({ type: 'auth_error', message: 'Admin login required.' }));
          ws.close();
          return;
        }
        ws.role = 'admin';
        adminSockets.add(ws);
        ws.send(JSON.stringify({ type: 'auth_success', role: 'admin' }));
        broadcastClientList();
        return;
      }

      if (data.role === 'agent') {
        if (data.secret !== CLIENT_SECRET) {
          ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid client secret.' }));
          ws.close();
          return;
        }
        if (!data.clientId) {
          ws.send(JSON.stringify({ type: 'auth_error', message: 'clientId is required.' }));
          ws.close();
          return;
        }
        ws.role = 'agent';
        ws.clientId = data.clientId;
        ws.metadata = data.metadata || {};
        ws.status = 'online';
        ws.connectedAt = Date.now();
        agents.set(ws.clientId, ws);
        ws.send(JSON.stringify({ type: 'auth_success', role: 'agent', clientId: ws.clientId }));
        broadcastClientList();
        return;
      }
    }

    if (data.type === 'command' && ws.role === 'admin') {
      const target = agents.get(data.clientId);
      if (!target || target.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'command_error', message: 'Client is not connected.', requestId: data.requestId }));
        return;
      }
      target.send(JSON.stringify({ type: 'command', requestId: data.requestId, command: data.command, args: data.args || {} }));
      return;
    }

    if (data.type === 'result' && ws.role === 'agent') {
      broadcastToAdmins({ type: 'result', clientId: ws.clientId, requestId: data.requestId, command: data.command, result: data.result, success: data.success, error: data.error || null, timestamp: data.timestamp });
      return;
    }

    if (data.type === 'status' && ws.role === 'agent') {
      ws.status = data.status || 'online';
      broadcastClientList();
      return;
    }
  });

  ws.on('close', () => {
    if (ws.role === 'admin') {
      adminSockets.delete(ws);
    }
    if (ws.role === 'agent' && ws.clientId) {
      agents.delete(ws.clientId);
      broadcastClientList();
    }
  });

  ws.on('error', () => {
    // ignore errors on individual sockets
  });
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => {
  const protocol = HTTPS_KEY && HTTPS_CERT ? 'https' : 'http';
  console.log(`Remote admin server listening on ${protocol}://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  clearInterval(interval);
  server.close(() => process.exit(0));
});
