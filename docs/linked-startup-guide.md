# Linked startup order

Linked Run and Debug can start an API, wait until it is ready, and only then
start its clients. Window numbers do not determine launch order: each selected
configuration owns its linked priority and optional readiness check.

## Guided setup

When Craidd finds an ASP.NET Web API and a client referencing the same local
HTTP address, the toolbar offers **Set up startup order…**. The Configurations
dialog also shows **Suggested startup order → Review setup**.

1. Choose the API Run/Debug configurations that should start first.
2. Confirm the readiness endpoint. A recognized health route is prefilled;
   otherwise enter your own. **Test endpoint** checks an already running API
   without starting anything.
3. Choose the client configurations that should start afterward. Advanced
   settings expose priorities and the readiness timeout.
4. Apply, then Save in Configurations. Apply only changes the draft; Save
   writes the selected settings to the `.cln`.
5. Select those configurations in the participating linked windows and use
   the gold Run/Debug button. For ordered or readiness-gated launches, a
   preview shows the phases, instances, commands, endpoints, and timeouts.

Inferred configurations are copied into uniquely named saved configurations,
not edited in place. Unselected configurations and alternate-port commands
keep their settings. For API configurations with no explicit binding, setup
adds `ASPNETCORE_URLS` to the saved profiles: debugger launches do not load
`launchSettings.json` themselves.

## Manual control

Every editable configuration has linked priority, readiness URL, and timeout
fields. Lower priorities start first (1–100); equal priorities start together.
The default priority is 50. An HTTP response with status 200–399 passes the
readiness check; HTTPS is not currently supported. Choose an endpoint that
actually represents readiness, not merely an open listener.

For example, inside an API `[[config]]` entry:

```toml
[config.linked]
priority = 20
ready_url = "http://127.0.0.1:5087/api/health"
timeout_ms = 30000
```

Leave clients at priority 50, or choose another higher value. A failed check
prevents later phases from launching. Stop cancels queued phases and stops the
remaining launched instances. Ordinary single-window actions are unchanged.

## Detection limits

Suggestions are advisory, never automatically saved or launched. Craidd matches
local HTTP ports from commands/profiles and ASP.NET launch settings against
client references in conventional entry points and Tauri configuration. It
looks for literal health routes in `Program.cs`. It does not resolve arbitrary
environment variables, generated configuration, route groups, or a full
dependency graph. Files outside the conventional entry points are not scanned;
client hint files over 256 KB and symlinked hint files are skipped.

A new `.cln` can therefore receive suggestions when matching evidence exists,
but not every solution will. Without a suggestion, use the manual fields to
declare the order and readiness endpoint yourself.
