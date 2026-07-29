# Hetzner deployment

The production site is deployed automatically from `main` by a systemd timer
on the existing Hetzner VPS. The timer checks GitHub approximately every three
minutes and does nothing when the revision has not changed.

## Build prerequisites

The deploy user must have the same pinned toolchain as development:

- Node.js `>=22.13.0`
- Rust `1.88.0`
- the `wasm32-unknown-unknown` target
- `wasm-pack 0.13.1`
- Linux utilities required by the deployment scripts: `flock`, `curl`,
  `sha256sum`, and GNU `timeout`

Install the Rust components before enabling automatic deployment:

```bash
rustup toolchain install 1.88.0 \
  --profile minimal \
  --component rustfmt \
  --component clippy \
  --target wasm32-unknown-unknown
cargo install wasm-pack --version 0.13.1 --locked
```

Make sure the systemd service and deploy script can find `cargo`, `rustc`, and
`wasm-pack`; an interactive-shell-only `PATH` is insufficient. The application
build checks the exact `wasm-pack` version and stops instead of producing a
JavaScript-only release when Rust/Wasm tooling is missing.

## Release flow

For a new revision, `/usr/local/sbin/twophotonlithography-deploy`:

1. fetches the exact `main` revision;
2. installs the locked dependencies, compiles the Rust Reaction Lens to Wasm,
   and runs the production build and tests;
3. creates an immutable release under
   `/srv/twophotonlithography-releases/<revision>`;
4. atomically switches `/srv/twophotonlithography/current`;
5. restarts the localhost-only Vinext service; and
6. rolls back the symlink if the local health check fails.

The service listens only on `127.0.0.1:45180`. Nginx owns public HTTP and HTTPS,
redirects `www` to the apex, and proxies the apex to the service.

The deployment script runs:

```bash
npm test
```

`npm test` runs the Rust tests, invokes the production build, validates that the
deployable artifact contains a real `.wasm` module, and runs the worker-thread
Wasm initialization test. For a build without the rest of the test suite, run
`npm run build`; it still compiles the pinned browser Wasm package before
Vinext.

## Operations

Operational commands on the server:

```bash
systemctl status twophotonlithography twophotonlithography-deploy.timer
journalctl -u twophotonlithography -u twophotonlithography-deploy --since '30 minutes ago'
/usr/local/sbin/twophotonlithography-deploy --dry-run --force
/usr/local/sbin/twophotonlithography-deploy --force
```

The bootstrap nginx template reuses the existing Setup Universe certificate
only for the DNS cutover. After DNS points to Hetzner, issue the dedicated
certificate and install `nginx-twophotonlithography`.
