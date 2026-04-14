# Remote Admin Demo

A minimal remote administration demo with:

- `server.js` — central Express + WebSocket server
- `public/admin.html` — browser-based admin console
- `client-agent.js` — remote agent that connects outbound to the server

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and adjust secrets as needed:

```bash
copy .env.example .env
```

3. Start the server:

```bash
npm start
```

If you provide `HTTPS_KEY` and `HTTPS_CERT` in `.env`, the server will run with HTTPS/WSS.

4. Run the remote agent on the client machine:

```bash
node client-agent.js --server http://localhost:3000 --client-id my-client --client-secret client-secret
```

Replace `localhost` with your server hostname if the agent runs on a different machine.

## Usage

- Open `http://localhost:3000` in a browser
- Enter the admin secret from `.env`
- Select a connected client
- Send `ping`, `Client Info`, execute a shell command, or perform file operations

The admin console now supports:
- `list_dir` to list a directory
- `read_file` to read a text file
- `write_file` to save edited file content back to the client

## Standalone client packaging

The remote agent can be packaged as a standalone executable so the client does not need Node.js installed.

1. Install dependencies locally:
   ```bash
   npm install
   ```
2. Build the standalone agent:
   ```bash
   npm run build-agent
   ```
3. The generated binaries appear in `dist/`.

Use the appropriate executable on the client machine and pass the same `--server`, `--client-id`, and `--client-secret` arguments.

## Replit deployment

Replit is a good free option because it provides a public URL and avoids local port forwarding.

Steps:
1. Create a new Replit project and import this repository.
2. Add the required secrets in Replit's Secrets/Environment variables panel:
   - `ADMIN_SECRET`
   - `CLIENT_SECRET`
   - `SESSION_SECRET`
3. Replit will run `npm install && npm start` using the provided `.replit` file.
4. Use the public Replit URL shown in Replit as your server address.

Example client command:
```bash
node client-agent.js --server https://your-repl-name.username.repl.co --client-id home-client --client-secret client-secret
```

If Replit provides HTTPS, the app will use `wss://` automatically for WebSocket connections.

## GitHub integration and deployment

You can store this project in a GitHub repository, but GitHub Pages cannot run the Node.js server directly.

What GitHub is good for here:
- version control for the server and client code
- collaboration and code reviews
- GitHub Actions for CI builds and packaging

If you want to deploy the server, use GitHub only as the source repository. Then deploy to a real runtime host such as a VPS, cloud VM, Azure App Service, DigitalOcean App Platform, or a self-hosted server.

For example:
- push this code to GitHub
- set up GitHub Actions to build and test
- deploy the server from GitHub to your target host

## Notes

- The remote agent must be running on each client machine that you want to manage.
- This demo is intentionally minimal and uses simple shared secrets.
- Do not expose this to the public internet without HTTPS/TLS and proper access controls.
- Only use this system with explicit authorization from the remote machine owner.
