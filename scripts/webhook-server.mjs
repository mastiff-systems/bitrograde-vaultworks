// webhook-server.mjs — listens for GitHub push events and routes to per-environment deploy scripts
// main   → deploy-prod.sh    (port 3000, production)
// develop → deploy-staging.sh (port 3001, staging) + deploy-dev.sh (port 3002, dev)
import http from 'http';
import crypto from 'crypto';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 9876;
const SECRET = process.env.WEBHOOK_SECRET || 'vaultworks-webhook-secret';

const DEPLOY_SCRIPTS = {
  'refs/heads/main': path.join(__dirname, 'deploy-prod.sh'),
  'refs/heads/develop': [
    path.join(__dirname, 'deploy-staging.sh'),
    path.join(__dirname, 'deploy-dev.sh'),
  ],
};

const running = new Set();

function verify(secret, payload, sig) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

function runDeploy(script, label) {
  if (running.has(script)) {
    console.log(`webhook: deploy already running for ${label}, skipping`);
    return;
  }
  running.add(script);
  console.log(`webhook: triggering ${label}`);
  execFile(script, { timeout: 600_000 }, (err, stdout, stderr) => {
    running.delete(script);
    if (err) {
      console.error(`deploy ${label} failed:`, err.message);
      console.error(stderr);
    } else {
      console.log(`deploy ${label} succeeded`);
      console.log(stdout);
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/deploy') {
    res.writeHead(404); res.end('not found'); return;
  }

  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const sig = req.headers['x-hub-signature-256'] || '';

    if (!verify(SECRET, body, sig)) {
      console.log('webhook: bad signature');
      res.writeHead(401); res.end('unauthorized'); return;
    }

    const event = req.headers['x-github-event'];
    if (event !== 'push') {
      res.writeHead(200); res.end('ignored'); return;
    }

    let payload;
    try { payload = JSON.parse(body.toString()); } catch {
      res.writeHead(400); res.end('bad json'); return;
    }

    const scripts = DEPLOY_SCRIPTS[payload.ref];
    if (!scripts) {
      console.log(`webhook: ignoring push to ${payload.ref}`);
      res.writeHead(200); res.end('ignored'); return;
    }

    console.log(`webhook: push to ${payload.ref} @ ${payload.after}`);
    res.writeHead(202); res.end('deploy triggered');

    const scriptList = Array.isArray(scripts) ? scripts : [scripts];
    for (const script of scriptList) {
      runDeploy(script, path.basename(script));
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`webhook server listening on :${PORT}`);
  console.log('Routes:');
  console.log('  main    → deploy-prod.sh    (production, port 3000)');
  console.log('  develop → deploy-staging.sh (staging, port 3001)');
  console.log('           + deploy-dev.sh    (dev, port 3002)');
});
