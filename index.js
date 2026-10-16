require('dotenv').config();

const http = require('http');

// Formato: TARGETS=nome1=https://url1,nome2=https://url2
function parseTargets(raw) {
  if (!raw || !raw.trim()) return [];

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf('=');
      if (idx === -1) {
        throw new Error(`Formato inválido em TARGETS: "${entry}". Use nome=url`);
      }
      const name = entry.slice(0, idx).trim();
      const url = entry.slice(idx + 1).trim();
      if (!name || !url) {
        throw new Error(`Nome ou URL vazio em TARGETS: "${entry}"`);
      }
      new URL(url); // lança erro se a URL for inválida
      return { name, url };
    });
}

const TARGETS = parseTargets(process.env.TARGETS);

if (TARGETS.length === 0) {
  console.error('Nenhuma rota configurada. Defina TARGETS no .env ou nas variáveis do Render.');
  process.exit(1);
}

const INTERVAL_MS = 45_000;
const TIMEOUT_MS = 10_000;
const PORT = process.env.PORT || 3000;

const state = {};

async function checkTarget(target) {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  try {
    const res = await fetch(target.url, {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Descarta o corpo para liberar a conexão
    await res.arrayBuffer().catch(() => {});

    state[target.name] = {
      url: target.url,
      ok: res.ok,
      status: res.status,
      responseTimeMs: Date.now() - startedAt,
      checkedAt,
      error: null,
    };
  } catch (err) {
    state[target.name] = {
      url: target.url,
      ok: false,
      status: null,
      responseTimeMs: Date.now() - startedAt,
      checkedAt,
      error: err.name === 'TimeoutError' ? 'timeout' : err.message,
    };
  }

  const s = state[target.name];
  const label = s.ok ? 'OK  ' : 'FAIL';
  console.log(
    `[${checkedAt}] ${label} ${target.name} status=${s.status ?? '-'} ` +
      `tempo=${s.responseTimeMs}ms${s.error ? ` erro=${s.error}` : ''}`
  );
}

async function runChecks() {
  await Promise.all(TARGETS.map(checkTarget));
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'up' }));
  }

  if (req.url === '/status' || req.url === '/') {
    const allOk = TARGETS.every((t) => state[t.name]?.ok);
    res.writeHead(allOk ? 200 : 503, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        allOk,
        intervalMs: INTERVAL_MS,
        services: state,
      }, null, 2)
    );
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`Monitor rodando na porta ${PORT} com ${TARGETS.length} rota(s)`);
  runChecks();
  setInterval(runChecks, INTERVAL_MS);
});
