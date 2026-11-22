# Slack

What needs you in Slack, in Work → Messages: **mentions** of you, **direct messages** and group messages, and **threads you are in** that
have moved since you spoke, until you answer or dismiss them. A source can also name channels to **watch**, for a Chat digest brief.

- **Your own token.** You create a small Slack app in your workspace and paste its user token (`xoxp-…`). It acts as you, so it sees what you see.
  The plugin's code never sees the token: it asks AstroAI to make each Web API request; AstroAI signs it and sends it to `slack.com` and nowhere else.
- **Reads only** in this version. Nothing is posted.
- **User token scopes** the app needs: `search:read`, `channels:read`, `channels:history`, `groups:read`, `groups:history`, `im:read`,
  `im:history`, `mpim:read`, `mpim:history`, `users:read`.
- **Setup:** api.slack.com/apps → Create New App (from scratch) → OAuth & Permissions → add the user token scopes above → Install to Workspace
  → copy the *User OAuth Token*. Some workspaces need an admin to approve the app. Then Settings → Integrations → connect Slack, add the
  workspace as a source (optionally the channels to watch), and switch on the **Messages** loop.

AstroAI keeps a copy of this folder in `vendor/plugins/slack` for its own tests and for simulate's demo; change it here first, then refresh that copy.
