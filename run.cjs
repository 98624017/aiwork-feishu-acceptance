const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const reportDirectory = path.resolve('reports');
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-native-probe-'));
fs.mkdirSync(reportDirectory, { recursive: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
try {
  for (const mode of ['write', 'read']) {
    const result = spawnSync(require('electron'), [path.join(__dirname, 'probe.cjs'), mode, dataDirectory, reportDirectory], {
      env: environment,
      stdio: 'inherit',
      timeout: 60000
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${mode} probe failed; inspect reports`);
    const report = JSON.parse(fs.readFileSync(path.join(reportDirectory, `${mode}.json`), 'utf8'));
    assert.equal(report.mode, mode);
    assert.equal(report.passed, true);
  }
} finally {
  // Only this run's newly created OS temp directory is removed.
  fs.rmSync(dataDirectory, { recursive: true, force: true });
}
