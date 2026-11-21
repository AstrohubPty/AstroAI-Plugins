# Railway

The services of your Railway projects and how each one's latest deployment went (Work → Deploys, and a notification
when one fails or recovers).

- **Reads only.** It never deploys, restarts or changes anything.
- **Your token stays with AstroAI.** The plugin's code asks AstroAI to make each GraphQL query; AstroAI signs it and sends
  it to `backboard.railway.com` and nowhere else. Install it with `npm run astroai -- plugin install railway`.
- **Token:** an account or workspace token (Railway → avatar → Account Settings → Tokens). A project token isn't enough: it can't
  list your projects.
- **Setup:** Settings → Integrations → connect Railway, add a project (Browse lists yours; an environment such as
  `production` is optional), then switch on the **Deploys** loop.

AstroAI keeps a copy of this folder in `vendor/plugins/railway` for its own tests and for simulate's demo; change it here
first, then refresh that copy.
