# Cookie Monster (web, docker, 100)
- **Solution:** the site sets `role=Z3Vlc3Q=` (base64 of `guest`). Change it to `YWRtaW4=` (base64 of `admin`) in dev tools and visit `/admin`.
- **Flag location:** printed on `/admin` from the `FLAG` env var (different per team).
- **Hints:** 1) What does the browser remember about you? 2) That value looks like base64.
- **Build:** `docker build -t ctf/cookie-monster challenges/cookie-monster`
