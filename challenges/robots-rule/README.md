# Robots Rule (web, docker, 100)
- **Solution:** open `/robots.txt`, find `Disallow: /internal-admin-panel`, visit that page.
- **Flag location:** printed by `/internal-admin-panel` from the `FLAG` env var (different per team).
- **Hints:** 1) Crawlers are told where not to go. 2) Look at `/robots.txt`.
- **Build:** `docker build -t ctf/robots-rule challenges/robots-rule`
