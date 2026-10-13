'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const when = process.argv[2]
assert.ok(['before', 'after'].includes(when))
const artifacts = process.env.NATIVE_PRIVATE_ARTIFACTS_DIR
assert.ok(artifacts)
fs.mkdirSync(artifacts, { recursive: true })

function readCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000 })
  return { available: !result.error && result.status === 0, output: result.stdout || '' }
}

const inventory = { platform: process.platform, arch: process.arch, uptimeSeconds: os.uptime() }
if (process.platform === 'win32') {
  const script = [
    '$ErrorActionPreference="Stop"',
    '$languages=@(Get-WinUserLanguageList | ForEach-Object { @{languageTag=$_.LanguageTag;inputMethodTips=@($_.InputMethodTips)} })',
    '$boot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString("o")',
    '@{languages=$languages;bootTime=$boot;userInteractive=[Environment]::UserInteractive;sessionId=(Get-Process -Id $PID).SessionId} | ConvertTo-Json -Depth 5 -Compress'
  ].join(';')
  const result = readCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script
  ])
  inventory.nativeQueryAvailable = result.available
  if (result.available) Object.assign(inventory, JSON.parse(result.output))
} else if (process.platform === 'darwin') {
  const executable = path.join(artifacts, 'native-input-sources')
  const compilation = readCommand('/usr/bin/clang', [
    path.join(__dirname, 'native-input-sources.c'),
    '-o',
    executable,
    '-framework',
    'Carbon',
    '-framework',
    'ApplicationServices'
  ])
  inventory.nativeQueryAvailable = compilation.available
  if (compilation.available) {
    const result = readCommand(executable, [])
    inventory.nativeQueryAvailable = result.available
    inventory.enabledInputSources = []
    for (const line of result.output.trim().split('\n')) {
      const [kind, value] = line.split('\t')
      if (kind === 'current') inventory.currentInputSource = value
      if (kind === 'enabled') inventory.enabledInputSources.push(value)
      if (kind === 'accessibility') inventory.accessibilityTrusted = value === 'true'
    }
  }
  for (const [field, name] of [
    ['bootTime', 'kern.boottime'],
    ['bootSessionId', 'kern.bootsessionuuid']
  ]) {
    const result = readCommand('/usr/sbin/sysctl', ['-n', name])
    if (result.available) inventory[field] = result.output.trim()
  }
}

const beforeFile = path.join(artifacts, 'native-capabilities-before.json')
if (when === 'after' && fs.existsSync(beforeFile)) {
  const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'))
  const field = inventory.bootSessionId ? 'bootSessionId' : 'bootTime'
  inventory.bootUnchanged =
    inventory[field] && before[field] ? inventory[field] === before[field] : null
}
fs.writeFileSync(
  path.join(artifacts, 'native-capabilities-' + when + '.json'),
  JSON.stringify(inventory, null, 2) + '\n',
  { mode: 0o600 }
)
console.log('Read-only native capability inventory captured privately')
