# Native environment probe

An independent, credential-free environment experiment. It contains no application source,
credentials, private fixtures or business data. Dependency versions match the application
under investigation; this is not the application itself.

Run `npm ci`, `npm run check`, then `npm test` on Windows or macOS, or manually run
the **Native environment probe** workflow. Each Electron process is limited to 60 seconds.
Reports contain platform, runtime versions, assertions and failures only. No userData is uploaded.

The probe checks:

- Electron OS-backed safeStorage availability (Windows DPAPI or macOS Keychain), encryption
  and decryption of a public fixture, then decryption in a second process with the same userData.
  Linux/basic_text is rejected. No keychain settings or permissions are changed.
- Official Feishu SDK loads and exports its HTTP and WebSocket clients.
- A credential-free HTTPS GET to `open.feishu.cn`, including TLS certificate validation.
  Any HTTP status proves transport reachability only, not API authorization.

The probe never starts the SDK client, sends a message, creates an application or invokes a
paid service. Actual WSS endpoints are provided by authenticated Feishu endpoint discovery;
this credential-free run cannot prove WebSocket authentication, event receipt or callbacks.

Passing is only environment readiness. It does not validate production application behavior,
installer integration, native desktop UX, operating-system reboot, tray/notification behavior,
real Feishu actions, billing safety or 24-hour unattended execution. Hosted runners are ephemeral;
consecutive runs do not constitute one continuous 24-hour session. macOS runner Keychain failure
must be reported as an environment limitation rather than bypassed with insecure storage.

The workflow is manual-only, uses read-only repository permissions, and requires no secrets.
