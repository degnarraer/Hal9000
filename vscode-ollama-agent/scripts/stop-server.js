const http = require('http');
const { execFile } = require('child_process');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || 'localhost';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

function forceStopByPort(reason) {
  if (process.platform !== 'win32') {
    console.error(`${reason}. Automatic port cleanup is only implemented for Windows.`);
    process.exitCode = 1;
    return;
  }

  const script = [
    `$pids = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue |`,
    '  Select-Object -ExpandProperty OwningProcess -Unique;',
    'if (-not $pids) { exit 0 }',
    '$pids | ForEach-Object { Stop-Process -Id $_ -Force }'
  ].join(' ');

  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (err) => {
    if (err) {
      console.error(`${reason}. Port cleanup failed: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    console.log(`Stopped process listening on port ${port}.`);
  });
}

const req = http.request(
  {
    host,
    port,
    path: '/api/control/shutdown',
    method: 'POST',
    timeout: 5000,
  },
  (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`Server on http://${host}:${port} is shutting down.`);
        return;
      }

      forceStopByPort(`Shutdown request failed with ${res.statusCode}: ${body}`);
    });
  }
);

req.on('timeout', () => {
  req.destroy(new Error(`Timed out contacting http://${host}:${port}`));
});

req.on('error', (err) => {
  if (err.code === 'ECONNREFUSED') {
    console.log(`No server is listening on http://${host}:${port}.`);
    return;
  }

  forceStopByPort(`Failed to stop server cleanly: ${err.message}`);
});

req.end();
