const http = require('http');
const path = require('path');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || 'localhost';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

function waitForAvailablePort() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port,
        path: '/api/ollama/monitor/details',
        method: 'GET',
        timeout: 1000,
      },
      (res) => {
        res.resume();
        reject(new Error(`A server is already listening on http://${host}:${port} (${res.statusCode}). Run npm run stop-server first.`));
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Timed out checking http://${host}:${port}`));
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        resolve();
        return;
      }
      reject(err);
    });

    req.end();
  });
}

async function main() {
  try {
    await waitForAvailablePort();
    require(path.join(__dirname, '..', 'server', 'index.js'));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
