# Contributing

Read LICENSE first: tinkering and free forks are welcome, while commercial software distribution requires permission. Third-party components retain their own terms.

Start with `npm ci`, `npm test`, `npm run test:integration` and the relevant browser tests. Use generated audio in fixtures. Describe changed behavior and actual verification; distinguish simulated capture from hardware testing. Keep the app offline-capable and avoid runtime CDNs. Include source and notices when modifying bundled components.

Do not commit personal recordings, browser recovery databases, access tokens, machine-specific logs, compiled launcher binaries, `dist/` release archives or `node_modules`. The four reviewed example ZIPs are intentionally included with their reproducible synthesis source and manifest. Changes should preserve existing project compatibility or document a migration.
