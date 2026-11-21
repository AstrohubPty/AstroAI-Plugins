# ClickUp

Tasks from the ClickUp lists you choose, as tickets in AstroAI (Work → Tickets, the ticket flow, briefs).

- **Reads only.** It never creates, moves or comments on a task.
- **Your token stays with AstroAI.** The plugin's code asks AstroAI to make each request; AstroAI signs it and sends it to
  `api.clickup.com` and nowhere else. Install it with `npm run astroai -- plugin install clickup`.
- **Setup:** Settings → Integrations → add a ClickUp account with your personal API token (ClickUp → avatar → Settings →
  ClickUp API, it starts with `pk_`), then add a list. **Sync** on the list reads its statuses so you can map each to a
  role (to do, building, review, QA, ready, blocked, done).

AstroAI keeps a copy of this folder in `vendor/plugins/clickup` for its own tests and for simulate's demo; change it here
first, then refresh that copy.
