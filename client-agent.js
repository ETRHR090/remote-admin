const WebSocket = require('ws');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) return undefined;
  return args[index + 1];
};

const serverUrl = getArg('--server') || process.env.SERVER_URL;
const clientId = getArg('--client-id') || process.env.CLIENT_ID;
const clientSecret = getArg('--client-secret') || process.env.CLIENT_SECRET;

if (!serverUrl || !clientId || !clientSecret) {
  console.log('Usage: node client-agent.js --server http://localhost:3000 --client-id my-client --client-secret client-secret');
  process.exit(1);
}

/**
 * Safely converts an http/https URL to ws/wss and appends the path
 */
function formatWsUrl(inputUrl) {
  try {
    const url = new URL(inputUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.origin.replace(/\/$/, '') + '/ws';
  } catch (e) {
    // Fallback for simple string replacement if URL parsing fails
    return inputUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
  }
}

const wsUrl = formatWsUrl(serverUrl);
const metadata = {
  hostname: os.hostname(),
  platform: os.platform(),
  arch: os.arch(),
  nodeVersion: process.version,
};

let ws;

function connect() {
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'auth', role: 'agent', secret: clientSecret, clientId, metadata }));
    console.log(`Connected to remote admin server as '${clientId}'.`);
    sendStatus('online');
  });

  ws.on('ping', () => {
    ws.pong();
  });

  ws.on('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (error) {
      return;
    }

    if (data.type === 'command') {
      await handleCommand(data);
    }
  });

  ws.on('close', () => {
    console.log('Disconnected from server, reconnecting in 5s...');
    setTimeout(connect, 5000);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message || error);
  });
}

function sendStatus(status) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'status', clientId, status, timestamp: Date.now() }));
  }
}

function sendResult(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function handleCommand(data) {
  const requestId = data.requestId;
  const command = data.command;
  const args = data.args || {};

  if (command === 'ping') {
    sendResult({ type: 'result', requestId, command, result: { pong: true, time: Date.now() }, success: true, timestamp: Date.now() });
    return;
  }

  if (command === 'info') {
    const info = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      uptime: os.uptime(),
      loadavg: os.loadavg(),
      totalmem: os.totalmem(),
      freemem: os.freemem(),
      cpus: os.cpus().length,
    };
    sendResult({ type: 'result', requestId, command, result: info, success: true, timestamp: Date.now() });
    return;
  }

  if (command === 'list_drives') {
    const platform = os.platform();
    if (platform === 'win32') {
      exec('wmic logicaldisk get caption', (error, stdout) => {
        if (error) {
          sendResult({ type: 'result', requestId, command, result: null, success: false, error: error.message, timestamp: Date.now() });
          return;
        }
        const drives = stdout.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.includes('Caption'))
          .map(d => d.endsWith(':') ? d + '\\' : d);
      ws.send(JSON.stringify(stdout));
      });
    } else {
      ws.send(JSON.stringify(stdout));
    }
    return;
  }

  if (command === 'exec') {
    if (!args.command) {
      sendResult({ type: 'result', requestId, command, result: null, success: false, error: 'Missing args.command', timestamp: Date.now() });
      return;
    }

    exec(args.command, { timeout: 30000, windowsHide: true }, (error, stdout, stderr) => {
      sendResult({
        type: 'result',
        requestId,
        command,
        result: {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: error && error.code ? error.code : 0,
        },
        success: !error,
        error: error ? error.message : null,
        timestamp: Date.now(),
      });
    });
    return;
  }

  if (command === 'list_dir') {
    if (!args.path) {
      sendResult({ type: 'result', requestId, command, result: null, success: false, error: 'Missing args.path', timestamp: Date.now() });
      return;
    }
    fs.readdir(args.path, { withFileTypes: true }, (error, files) => {
      if (error) {
        sendResult({ type: 'result', requestId, command, result: null, success: false, error: error.message, timestamp: Date.now() });
        return;
      }
      const result = files.map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'dir' : 'file' }));
      sendResult({ type: 'result', requestId, command, result, success: true, timestamp: Date.now() });
    });
    return;
  }

  if (command === 'read_file') {
    if (!args.path) {
      sendResult({ type: 'result', requestId, command, result: null, success: false, error: 'Missing args.path', timestamp: Date.now() });
      return;
    }
    fs.readFile(args.path, 'utf8', (error, content) => {
      if (error) {
        sendResult({ type: 'result', requestId, command, result: null, success: false, error: error.message, timestamp: Date.now() });
        return;
      }
      sendResult({ type: 'result', requestId, command, result: { content }, success: true, timestamp: Date.now() });
    });
    return;
  }

  if (command === 'write_file') {
    if (!args.path) {
      sendResult({ type: 'result', requestId, command, result: null, success: false, error: 'Missing args.path', timestamp: Date.now() });
      return;
    }
    fs.writeFile(args.path, args.content || '', 'utf8', (error) => {
      if (error) {
        sendResult({ type: 'result', requestId, command, result: null, success: false, error: error.message, timestamp: Date.now() });
        return;
      }
      sendResult({ type: 'result', requestId, command, result: { written: true }, success: true, timestamp: Date.now() });
    });
    return;
  }

  sendResult({ type: 'result', requestId, command, result: null, success: false, error: `Unknown command '${command}'`, timestamp: Date.now() });
}

connect();
setInterval(() => sendStatus('online'), 15000);
