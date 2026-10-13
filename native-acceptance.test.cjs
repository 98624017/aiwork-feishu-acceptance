'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-harness-self-test-'))
const script = path.join(__dirname, 'native-acceptance.cjs')
const key = crypto.randomBytes(32).toString('hex')
const env = {
  ...process.env,
  RUNNER_TEMP: temp,
  NATIVE_ACCEPTANCE_KEY: key,
  GH_TOKEN: 'public-fixture-token',
  GITHUB_TOKEN: 'public-fixture-token'
}
const marker = 'PRIVATE_LOG_SENTINEL_must_never_appear_in_public_reports'
const requiredIds = [
  'window-minimize-continues',
  'window-close-continues',
  'explicit-exit',
  'process-restart-restores',
  'cleanup-conflict-warning',
  'idle-feishu-mock-operation',
  'onboarding-new-mock-flow',
  'onboarding-existing-mock-flow',
  'subscription-conflict-mock'
]

function command(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {
    env,
    encoding: 'utf8',
    timeout: 10_000
  })
  assert.equal(result.status, expectedStatus, result.stderr)
  assert.ok(!result.stdout.includes(marker) && !result.stderr.includes(marker))
  return result
}

try {
  const payload = path.join(temp, 'fixture-payload')
  const acceptance = path.join(payload, 'acceptance')
  fs.mkdirSync(acceptance, { recursive: true })
  fs.writeFileSync(
    path.join(acceptance, 'run.cjs'),
    `
    const assert = require('node:assert/strict')
    const fs = require('node:fs')
    const path = require('node:path')
    assert.equal(process.env.NATIVE_ACCEPTANCE_KEY, undefined)
    assert.equal(process.env.GH_TOKEN, undefined)
    assert.equal(process.env.GITHUB_TOKEN, undefined)
    console.log(${JSON.stringify(marker)})
    fs.writeFileSync(path.join(process.env.NATIVE_PRIVATE_ARTIFACTS_DIR, 'results.json'), JSON.stringify({
      tests: ${JSON.stringify(requiredIds.map((id) => ({ id, status: 'passed', secret: marker })))},
      privateSource: ${JSON.stringify(marker)}
    }))
  `
  )
  command(['test', payload])
  const encryptedReports = path.join(temp, 'public-reports', 'private-reports.enc')
  command(['seal-reports', payload, encryptedReports])
  const summary = fs.readFileSync(path.join(temp, 'public-reports', 'summary.json'), 'utf8')
  assert.ok(!summary.includes(marker) && !summary.includes(temp))
  assert.deepEqual(
    JSON.parse(summary).tests.find((test) => test.id === 'explicit-exit'),
    { id: 'explicit-exit', status: 'passed' }
  )
  assert.ok(
    JSON.parse(summary)
      .tests.filter((test) => !requiredIds.includes(test.id))
      .every((test) => test.status === 'skipped')
  )
  const encrypted = fs.readFileSync(encryptedReports)
  assert.ok(!encrypted.includes(Buffer.from(marker)))
  const checksum = crypto.createHash('sha256').update(encrypted).digest('hex')
  const decrypted = path.join(temp, 'decrypted-reports.tar.gz')
  command(['decrypt', encryptedReports, decrypted, checksum])
  assert.deepEqual(
    fs.readFileSync(decrypted),
    fs.readFileSync(path.join(temp, 'native-acceptance', 'private-reports.tar.gz'))
  )
  command(['decrypt', encryptedReports, decrypted, '0'.repeat(64)], 1)
  encrypted[encrypted.length - 1] ^= 1
  fs.writeFileSync(encryptedReports, encrypted)
  command(
    [
      'decrypt',
      encryptedReports,
      decrypted,
      crypto.createHash('sha256').update(encrypted).digest('hex')
    ],
    1
  )
  fs.writeFileSync(path.join(acceptance, 'run.cjs'), 'process.exitCode = 7\n')
  command(['test', payload], 1)
  assert.equal(
    JSON.parse(
      fs.readFileSync(
        path.join(temp, 'native-acceptance', 'private-artifacts', 'test.json'),
        'utf8'
      )
    ).exitCode,
    7
  )
  // A successful process without fresh complete evidence must not make CI green.
  fs.writeFileSync(path.join(acceptance, 'run.cjs'), 'process.exitCode = 0\n')
  command(['test', payload], 1)
  assert.equal(
    fs.existsSync(path.join(temp, 'native-acceptance', 'private-artifacts', 'results.json')),
    false
  )
  for (const tests of [
    [],
    requiredIds.map((id) => ({ id, status: 'skipped' })),
    requiredIds.map((id) => ({ id, status: id === 'explicit-exit' ? 'failed' : 'passed' })),
    requiredIds.filter((id) => id !== 'explicit-exit').map((id) => ({ id, status: 'passed' })),
    [
      ...requiredIds.map((id) => ({ id, status: 'passed' })),
      { id: 'explicit-exit', status: 'failed' }
    ],
    [
      ...requiredIds.map((id) => ({ id, status: 'passed' })),
      { id: 'sell-mock-material-to-local-delivery', status: 'failed' }
    ]
  ]) {
    fs.writeFileSync(
      path.join(acceptance, 'run.cjs'),
      `require('node:fs').writeFileSync(require('node:path').join(process.env.NATIVE_PRIVATE_ARTIFACTS_DIR, 'results.json'), ${JSON.stringify(JSON.stringify({ tests }))})\n`
    )
    command(['test', payload], 1)
  }
  fs.writeFileSync(
    path.join(acceptance, 'run.cjs'),
    `require('node:fs').writeFileSync(require('node:path').join(process.env.NATIVE_PRIVATE_ARTIFACTS_DIR, 'results.json'), 'malformed')\n`
  )
  command(['test', payload], 1)
  console.log(
    'Private output isolation, environment stripping, encrypted evidence, and fail-closed evidence checks passed'
  )
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
