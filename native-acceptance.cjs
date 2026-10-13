'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const MAGIC = Buffer.from('NAE1')
const COMMAND_TIMEOUT_MS = 290_000
function tarExecutable() {
  // Git Bash's GNU tar treats drive-letter paths as remote archive names.
  return process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar'
}
const REQUIRED_TEST_IDS = new Set([
  'window-minimize-continues',
  'window-close-continues',
  'explicit-exit',
  'process-restart-restores',
  'cleanup-conflict-warning',
  'idle-feishu-mock-operation',
  'onboarding-new-mock-flow',
  'onboarding-existing-mock-flow',
  'subscription-conflict-mock'
])
const TEST_IDS = new Set([
  ...REQUIRED_TEST_IDS,
  'sell-mock-material-to-local-delivery',
  'sell-mock-desktop-feishu-same-job'
])
const LIMITATIONS = [
  'mock-provider-and-feishu-events-only',
  'real-qr-scan-not-verified',
  'native-chinese-ime-not-verified',
  'operating-system-reboot-not-verified',
  'installer-and-packaged-release-not-verified',
  'continuous-24-hour-operation-not-verified'
]

function encryptionKey() {
  const value = process.env.NATIVE_ACCEPTANCE_KEY
  if (!/^[a-f\d]{64}$/i.test(value || '')) throw new Error('Invalid encryption key')
  return Buffer.from(value, 'hex')
}

function encryptBytes(bytes, key) {
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(MAGIC)
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()])
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), encrypted])
}

function decryptBytes(bytes, key) {
  assert.ok(bytes.length >= 32 && bytes.subarray(0, 4).equals(MAGIC))
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(4, 16))
  decipher.setAAD(MAGIC)
  decipher.setAuthTag(bytes.subarray(16, 32))
  return Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()])
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
}

function publicTestResults(value) {
  const statuses = new Map()
  for (const test of value && Array.isArray(value.tests) ? value.tests : []) {
    if (!test || !TEST_IDS.has(test.id)) continue
    const next = ['passed', 'failed', 'skipped'].includes(test.status) ? test.status : 'failed'
    const previous = statuses.get(test.id)
    statuses.set(test.id, previous && previous !== next ? 'failed' : next)
  }
  return [...TEST_IDS].map((id) => ({ id, status: statuses.get(id) || 'skipped' }))
}

function reportFiles() {
  const taskDir = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'native-acceptance')
  return { taskDir, artifacts: path.join(taskDir, 'private-artifacts') }
}

async function runPrivateCommand(stage, cwd, executable, args) {
  const { artifacts } = reportFiles()
  fs.mkdirSync(artifacts, { recursive: true })
  const resultsFile = path.join(artifacts, 'results.json')
  if (stage === 'test') fs.rmSync(resultsFile, { force: true })
  const log = fs.openSync(path.join(artifacts, stage + '.log'), 'w', 0o600)
  const env = { ...process.env, CI: '1', NATIVE_PRIVATE_ARTIFACTS_DIR: artifacts }
  delete env.NATIVE_ACCEPTANCE_KEY
  delete env.GH_TOKEN
  delete env.GITHUB_TOKEN
  let result
  try {
    result = await new Promise((resolve) => {
      const child = spawn(executable, args, {
        cwd,
        env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', log, log]
      })
      let timedOut = false
      const timeout = setTimeout(() => {
        timedOut = true
        if (child.pid && process.platform === 'win32') {
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            timeout: 5_000
          })
        } else if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch (error) {
            if (error.code !== 'ESRCH') fs.writeSync(log, 'Unable to kill command process group\n')
          }
        }
      }, COMMAND_TIMEOUT_MS)
      child.once('error', () => {
        clearTimeout(timeout)
        resolve({ status: 'failed', exitCode: null, timedOut: false })
      })
      child.once('close', (exitCode) => {
        clearTimeout(timeout)
        resolve({ status: exitCode === 0 && !timedOut ? 'passed' : 'failed', exitCode, timedOut })
      })
    })
  } finally {
    fs.closeSync(log)
  }
  if (stage === 'test' && result.status === 'passed') {
    try {
      const tests = publicTestResults(JSON.parse(fs.readFileSync(resultsFile, 'utf8')))
      if (
        tests.some(
          (test) =>
            test.status === 'failed' || (REQUIRED_TEST_IDS.has(test.id) && test.status !== 'passed')
        )
      ) {
        result.status = 'failed'
      }
    } catch {
      result.status = 'failed'
    }
  }
  writeJson(path.join(artifacts, stage + '.json'), result)
  console.log(JSON.stringify({ stage, ...result }))
  if (result.status !== 'passed') process.exitCode = 1
}

function archiveReports(payloadDir, outputFile) {
  const { taskDir, artifacts } = reportFiles()
  fs.mkdirSync(artifacts, { recursive: true })
  const archiveFile = path.join(taskDir, 'private-reports.tar.gz')
  const tarArguments = ['-czf', archiveFile, '-C', taskDir, 'private-artifacts']
  for (const relative of ['e2e/test-results', 'playwright-report']) {
    if (fs.existsSync(path.join(payloadDir, relative))) {
      tarArguments.push('-C', payloadDir, relative)
    }
  }
  const archived = spawnSync(tarExecutable(), tarArguments, { stdio: 'ignore', timeout: 60_000 })
  if (archived.status !== 0) throw new Error('Private report archive failed')
  fs.mkdirSync(path.dirname(outputFile), { recursive: true })
  fs.writeFileSync(outputFile, encryptBytes(fs.readFileSync(archiveFile), encryptionKey()), {
    mode: 0o600
  })
  const stages = [
    'inventory-before',
    'unpack',
    'install',
    'prepare',
    'test',
    'inventory-after'
  ].flatMap((stage) => {
    const file = path.join(artifacts, stage + '.json')
    if (!fs.existsSync(file)) return [{ stage, status: 'skipped' }]
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    return [
      {
        stage,
        status: ['passed', 'failed', 'skipped'].includes(value.status) ? value.status : 'failed'
      }
    ]
  })
  const resultsFile = path.join(artifacts, 'results.json')
  const tests = fs.existsSync(resultsFile)
    ? publicTestResults(JSON.parse(fs.readFileSync(resultsFile, 'utf8')))
    : publicTestResults(null)
  writeJson(path.join(path.dirname(outputFile), 'summary.json'), {
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    stages,
    tests,
    limitations: LIMITATIONS
  })
}

async function main(args) {
  const [command, input, output, expectedHash] = args
  if (command === 'self-test') {
    const key = crypto.randomBytes(32)
    const plain = Buffer.from('public fixture')
    const encrypted = encryptBytes(plain, key)
    assert.deepEqual(decryptBytes(encrypted, key), plain)
    assert.notDeepEqual(encryptBytes(plain, key), encrypted)
    assert.throws(() => decryptBytes(encrypted, crypto.randomBytes(32)))
    for (const offset of [0, 4, 16, encrypted.length - 1]) {
      const altered = Buffer.from(encrypted)
      altered[offset] ^= 1
      assert.throws(() => decryptBytes(altered, key))
    }
    assert.throws(() => decryptBytes(Buffer.alloc(32), key))
    const filtered = publicTestResults({
      tests: [
        { id: 'explicit-exit', status: 'passed', secret: 'must-not-escape' },
        { id: 'explicit-exit', status: 'failed' },
        { id: 'private-name', status: 'passed' },
        { id: 'process-restart-restores', status: 'private-message' }
      ]
    })
    assert.equal(filtered.length, TEST_IDS.size)
    assert.deepEqual(
      filtered.find((test) => test.id === 'explicit-exit'),
      { id: 'explicit-exit', status: 'failed' }
    )
    assert.deepEqual(
      filtered.find((test) => test.id === 'process-restart-restores'),
      { id: 'process-restart-restores', status: 'failed' }
    )
    assert.ok(filtered.every((test) => TEST_IDS.has(test.id)))
    assert.ok(publicTestResults(null).every((test) => test.status === 'skipped'))
    console.log('Encryption authentication and public result allowlist checks passed')
    return
  }
  if (!input) throw new Error('Missing input')
  if (command === 'encrypt' || command === 'decrypt') {
    if (!output) throw new Error('Missing output')
    const bytes = fs.readFileSync(input)
    if (command === 'decrypt') {
      if (!/^[a-f\d]{64}$/i.test(expectedHash || '')) throw new Error('Missing payload SHA256')
      const actual = crypto.createHash('sha256').update(bytes).digest('hex')
      assert.equal(actual, expectedHash.toLowerCase(), 'Payload checksum mismatch')
    }
    const result =
      command === 'encrypt'
        ? encryptBytes(bytes, encryptionKey())
        : decryptBytes(bytes, encryptionKey())
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, result, { mode: 0o600 })
  } else if (command === 'inventory') {
    assert.ok(['before', 'after'].includes(input), 'Invalid inventory phase')
    await runPrivateCommand('inventory-' + input, __dirname, process.execPath, [
      path.join(__dirname, 'native-capabilities.cjs'),
      input
    ])
  } else if (command === 'unpack') {
    if (!output) throw new Error('Missing payload destination')
    fs.mkdirSync(output, { recursive: true })
    await runPrivateCommand('unpack', path.resolve(output), tarExecutable(), [
      '-xzf',
      path.resolve(input),
      '-C',
      path.resolve(output)
    ])
  } else if (command === 'install') {
    assert.ok(fs.existsSync(path.join(input, 'package-lock.json')), 'Locked dependencies required')
    const windows = process.platform === 'win32'
    await runPrivateCommand(
      'install',
      input,
      windows ? process.env.ComSpec || 'cmd.exe' : 'npm',
      windows
        ? ['/d', '/s', '/c', 'npm ci --no-audit --no-fund']
        : ['ci', '--no-audit', '--no-fund']
    )
  } else if (command === 'prepare' || command === 'test') {
    const entrypoint = path.join(
      input,
      'acceptance',
      command === 'test' ? 'run.cjs' : 'prepare.cjs'
    )
    if (command === 'prepare' && !fs.existsSync(entrypoint)) {
      writeJson(path.join(reportFiles().artifacts, 'prepare.json'), { status: 'skipped' })
      return
    }
    assert.ok(fs.statSync(entrypoint).isFile(), 'Private entrypoint required')
    await runPrivateCommand(command, input, process.execPath, [entrypoint])
  } else if (command === 'seal-reports') {
    if (!output) throw new Error('Missing encrypted report output')
    archiveReports(path.resolve(input), path.resolve(output))
  } else {
    throw new Error('Unknown command')
  }
}

main(process.argv.slice(2)).catch(() => {
  // Product output is private; CI exposes only this fixed infrastructure failure message.
  console.error('Native acceptance infrastructure command failed; inspect encrypted reports')
  process.exitCode = 1
})
