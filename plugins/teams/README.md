# Microsoft Teams

What needs you in your Teams chats, in Work → Messages: **direct messages** you haven't answered, and **group chats that mention you**. With
the Messages loop on, a new one is announced. You can **reply as you** from Work → Messages: it is drafted in AstroAI's approval queue first, and
nothing is posted until you press the button and confirm (in dry-run, the default, it is only recorded in the Outbox).

- **Microsoft Graph, with your own sign-in.** You register a small app in Microsoft Entra once and sign in to it from AstroAI. AstroAI keeps the
  refresh token in your keychain and signs each request with a short-lived access token; the plugin's code never sees either. It may read from
  `graph.microsoft.com` only, and post only `POST /chats/{id}/messages`.
- **Chats only.** Reading *channel* messages needs a Graph permission only an administrator can grant, so channels aren't read.
- **Setup:** portal.azure.com → Microsoft Entra ID → App registrations → New registration. Pick the account types (work or school for
  `organizations`), add a **Mobile and desktop applications** redirect URI exactly as AstroAI shows it (`http://localhost:<port>/oauth/callback`),
  then API permissions → Microsoft Graph → *Delegated*: `Chat.Read`, `ChatMessage.Send`, `User.Read`, `offline_access`. Copy the *Application
  (client) ID*. In Settings → Integrations connect Teams with it (and your tenant: `organizations` by default), press **Sign in**, add the
  *Teams chats* source and switch on the **Messages** loop. Some organisations restrict who can consent to apps: ask an administrator if you are blocked.

AstroAI keeps a copy of this folder in `vendor/plugins/teams` for its own tests and for simulate's demo; change it here first, then refresh that copy.
