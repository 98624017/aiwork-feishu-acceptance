# Encrypted native desktop acceptance

This public repository contains a generic runner and authenticated ciphertext. Product code,
private test fixtures, browser screenshots, traces, dependency logs and test errors remain
inside an encrypted payload or encrypted evidence artifact. No production credentials belong
in the payload. The public summary exposes only fixed test IDs, pass/fail/skipped statuses,
platform/runtime metadata and fixed capability limitations.

## Payload contract

`payload/desktop-acceptance.enc` is an encrypted gzip tar archive, less than 100 MB. Its archive
root must contain a private `package.json`, pinned `package-lock.json`, actual Electron app
entrypoint/build files, test fixtures and `acceptance/run.cjs`. Node 22 and `npm ci` install
the platform-specific Electron/native dependencies. Optional `acceptance/prepare.cjs` prepares
the application before testing. Both private scripts run with cwd set to the payload root.

Every install/prepare/test stage has a 290-second process-tree timeout. All stdout/stderr go
into private log files. The private scripts must use bounded child commands and write
screenshots/traces/results to `NATIVE_PRIVATE_ARTIFACTS_DIR`. The runner also archives
`e2e/test-results` and `playwright-report` if they exist. The encryption key is removed from the
environment passed to private scripts and dependency installation.

The required `results.json` in that artifacts directory has shape
`{"tests":[{"id":"explicit-exit","status":"passed"}]}`. Unknown fields and IDs are dropped.
Conflicting duplicate statuses and invalid statuses fail closed as `failed`. Every expected
test ID is included; absent evidence is `skipped`. A successful test process must also provide
fresh `passed` results for all nine `REQUIRED_TEST_IDS` desktop cases; missing/malformed reports,
failed/skipped cases or incomplete evidence fail the test stage. Any reported failure, including
an optional sell case, also fails the stage. Previous results are removed
before each test invocation. The two local sell IDs may remain `skipped` in native runs.
Allowed IDs are listed in `TEST_IDS` in
`native-acceptance.cjs`; real QR scanning, native IME and OS reboot are deliberately absent.
Private results remain encrypted even when public result filtering succeeds.

## Encryption and local commands

`NATIVE_ACCEPTANCE_KEY` is exactly 64 hexadecimal characters (32 random bytes). The envelope is
ASCII `NAE1`, 12-byte nonce, 16-byte authentication tag, then AES-256-GCM ciphertext. `NAE1`
is also authenticated as AAD. Each encryption uses a fresh random nonce.

```sh
node native-acceptance.cjs self-test
node native-acceptance.test.cjs
node native-acceptance.cjs encrypt /private/payload.tar.gz payload/desktop-acceptance.enc
node native-acceptance.cjs decrypt payload/desktop-acceptance.enc /private/roundtrip.tar.gz ENCRYPTED_FILE_SHA256
```

Set the same key as the temporary repository secret `NATIVE_ACCEPTANCE_KEY`. Dispatch
`desktop-acceptance.yml` with the ciphertext file and its SHA256. Workflow source never embeds
the key. The runner produces only `summary.json` and `private-reports.enc` as public artifacts.
Download and decrypt reports locally with the `decrypt` command and their encrypted SHA256.
Remove the temporary repository secret after verification.

The `windows_only` dispatch input repeats just Windows after a Windows-specific infrastructure
fix; unchanged passing Mac evidence can be retained for the same encrypted application payload.
Windows archive operations use the system `System32/tar.exe`, because Git Bash's GNU tar treats
drive-letter paths as remote archive names.

## What native CI can establish

The Windows x64, macOS ARM64 and macOS Intel matrix runs the actual Electron process with an
OS window server. Private tests can invoke production window APIs, inspect minimized state,
verify explicit app exit, and relaunch with the same isolated userData. Mock business providers
and mock Feishu events test application behavior across real process/window boundaries.

Application process restart is not OS reboot. Programmatic text insertion and synthetic
composition events are not a native Chinese IME test. A displayed/mock QR flow is not a real
phone scan, Feishu authorization or subscription update. Hosted CI does not establish packaged
installer behavior or one uninterrupted 24-hour unattended session. These limits remain in
every public summary, including passing runs.

Read-only native inventories before and after acceptance are encrypted with the evidence.
Windows queries the user's configured language/input-method list, interactive session state
and OS boot time. macOS queries Carbon TIS current/enabled input sources and
`AXIsProcessTrusted()` without requesting permission, plus kernel boot time/session ID.
The macOS probe is compiled only in the temporary artifact directory using the runner's
existing compiler. Inventory records availability and whether the boot identity stayed
unchanged. It does not install an input method, alter system settings, request Accessibility
authorization or reboot the runner. Installed/enabled input sources alone do not prove that
the app correctly handles native IME composition.
