# GitHub Actions (to enable)

These workflows live here because the token used for the first push had no `workflow` scope.
To enable: move both files to `.github/workflows/` and push with a token that has the `workflow` scope
(or add them in the GitHub web UI). `tick.yml` needs repo secrets `CRON_SECRET` and `APP_URL`.

- `ci.yml`: lint, typecheck, tests, safety-copy lint, build on every PR / push to main.
- `tick.yml`: calls `/api/cron/tick` every 5 minutes to send due reminders (Vercel Hobby cron is daily only).
