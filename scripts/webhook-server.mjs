// webhook-server.mjs — listens for GitHub push events and triggers deploy
import http from 'http';
import crypto from 'crypto';
import { execFile } from 'child_process';

const PORT = 9876;
const SECRET = process.env.WEBHOOK_SECRET || 'vaultworks-webhook-secret';
const DEPLOY_SCRIPT = new URL('../scripts/deploy.sh', import.meta.url).pathname;
const WATCHED_BRANCHES = ['refs/heads/main', 'refs/heads/develop'];

let deployRunning = false;

function verify(secret, payload, sig) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
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

    if (!WATCHED_BRANCHES.includes(payload.ref)) {
      console.log(`webhook: ignoring push to ${payload.ref}`);
      res.writeHead(200); res.end('ignored'); return;
    }

    if (deployRunning) {
      console.log('webhook: deploy already running, skipping');
      res.writeHead(202); res.end('deploy already in progress'); return;
    }

    console.log(`webhook: triggering deploy for ${payload.ref} @ ${payload.after}`);
    res.writeHead(202); res.end('deploy triggered');

    deployRunning = true;
    execFile(DEPLOY_SCRIPT, { timeout: 600_000 }, (err, stdout, stderr) => {
      deployRunning = false;
      if (err) {
        console.error('deploy failed:', err.message);
        console.error(stderr);
      } else {
        console.log('deploy succeeded');
        console.log(stdout);
      }
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`webhook server listening on :${PORT}`);
});
