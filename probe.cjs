const { app, safeStorage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const [mode, dataDirectory, reportDirectory] = process.argv.slice(2);
assert.ok(['write', 'read'].includes(mode), 'Invalid probe mode');
assert.ok(path.isAbsolute(dataDirectory), 'userData must be absolute');
assert.ok(path.isAbsolute(reportDirectory), 'Report directory must be absolute');
app.setName('FeishuNativeReadinessProbe');
app.setPath('userData', dataDirectory);
const FIXTURE = 'public-non-secret-encryption-fixture';
const NETWORK_TIMEOUT_MS = 15000;
const report = {
  mode,
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  node: process.versions.node,
  timestamp: new Date().toISOString(),
  authenticatedWebSocket: 'not-tested-requires-credentials',
  productionApplication: 'not-tested',
  passed: false
};

function checkHttps() {
  return new Promise((resolve, reject) => {
    const request = https.get('https://open.feishu.cn/', (response) => {
      response.resume();
      if (!response.socket.authorized) {
        reject(new Error('TLS certificate not authorized'));
        return;
      }
      resolve({ certificateVerified: true, statusCode: response.statusCode });
    });
    const timer = setTimeout(() => request.destroy(new Error('HTTPS deadline exceeded')), NETWORK_TIMEOUT_MS);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}

app.whenReady().then(async () => {
  assert.ok(['win32', 'darwin'].includes(process.platform), 'This probe requires Windows or macOS');
  report.encryptionAvailable = safeStorage.isEncryptionAvailable();
  assert.equal(report.encryptionAvailable, true, 'Secure OS storage is unavailable');
  report.backend = process.platform === 'win32' ? 'Windows-DPAPI' : 'macOS-Keychain';
  const ciphertextPath = path.join(dataDirectory, 'fixture.bin');
  if (mode === 'write') {
    const ciphertext = safeStorage.encryptString(FIXTURE);
    assert.notEqual(ciphertext.toString('utf8'), FIXTURE);
    assert.equal(safeStorage.decryptString(ciphertext), FIXTURE);
    fs.writeFileSync(ciphertextPath, ciphertext, { flag: 'wx' });
    report.sameProcessRoundTrip = true;
    const sdk = require('@larksuiteoapi/node-sdk');
    assert.equal(typeof sdk.WSClient, 'function');
    assert.equal(typeof sdk.Client, 'function');
    report.sdkLoaded = true;
    report.sdkVersion = require('@larksuiteoapi/node-sdk/package.json').version;
    report.https = await checkHttps();
  } else {
    assert.equal(safeStorage.decryptString(fs.readFileSync(ciphertextPath)), FIXTURE);
    report.crossProcessRoundTrip = true;
  }
  report.passed = true;
}).catch((error) => {
  report.error = error instanceof Error ? error.message : String(error);
}).finally(() => {
  fs.writeFileSync(path.join(reportDirectory, `${mode}.json`), JSON.stringify(report, null, 2));
  app.exit(report.passed ? 0 : 1);
});
