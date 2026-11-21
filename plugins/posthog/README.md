# PostHog

How a PostHog Cloud project did over the last 7 days against the 7 before, in Work → Analytics: visitors, pageviews, the top
pages and the events you name.

- **Reads only.** Everything is a HogQL query through PostHog's query endpoint; nothing is created or changed.
- **Your key stays with AstroAI.** The plugin's code asks AstroAI to make each request; AstroAI signs it and sends it to
  `us.posthog.com` or `eu.posthog.com` (your account's region) and nowhere else. Install it with
  `npm run astroai -- plugin install posthog`.
- **Key:** a personal API key (PostHog → avatar → Account settings → Personal API keys) with read access to Query and Project.
  Self-hosted PostHog isn't supported yet.
- **Setup:** Settings → Integrations → connect PostHog (key and region), add a project (Browse lists yours) and the
  events to count, then switch on the **Analytics** loop.

AstroAI keeps a copy of this folder in `vendor/plugins/posthog` for its own tests and for simulate's demo; change it here
first, then refresh that copy.
