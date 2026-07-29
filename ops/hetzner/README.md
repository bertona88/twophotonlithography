# Hetzner deployment

The production site is deployed automatically from `main` by a systemd timer
on the existing Hetzner VPS. The timer checks GitHub approximately every three
minutes and does nothing when the revision has not changed.

For a new revision, `/usr/local/sbin/twophotonlithography-deploy`:

1. fetches the exact `main` revision;
2. installs the locked dependencies and runs the production build and tests;
3. creates an immutable release under
   `/srv/twophotonlithography-releases/<revision>`;
4. atomically switches `/srv/twophotonlithography/current`;
5. restarts the localhost-only Vinext service; and
6. rolls back the symlink if the local health check fails.

The service listens only on `127.0.0.1:45180`. Nginx owns public HTTP and HTTPS,
redirects `www` to the apex, and proxies the apex to the service.

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
