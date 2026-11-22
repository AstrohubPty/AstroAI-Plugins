# Outlook mail

The mail that needs you in Outlook (Microsoft 365 or Outlook.com), in Work → Email: messages that are **unread or marked important**, **addressed to you**
(not only copied), **not bulk** (newsletters and notifications in Outlook's *Other* inbox are left out) and **not answered yet** (you haven't replied in
the conversation since). **Reply…** drafts a reply in AstroAI's approval queue first: nothing is sent until you press the button and confirm (in
dry-run, the default, it is only recorded in the Outbox).

- **Microsoft Graph, with your own sign-in.** You register a small app in Microsoft Entra once and sign in to it from AstroAI. AstroAI keeps the refresh
  token in your keychain and signs each request with a short-lived access token; the plugin's code never sees either. It may read from `graph.microsoft.com`
  and send only `POST /me/messages/{id}/reply`.
- **Previews only.** Only the first few hundred characters of a message are read (Graph's `bodyPreview`), never the whole body.
- **Setup:** portal.azure.com → Microsoft Entra ID → App registrations → New registration. Add a **Mobile and desktop applications** redirect URI exactly as
  AstroAI shows it (`http://localhost:<port>/oauth/callback`), then API permissions → Microsoft Graph → *Delegated*: `Mail.Read`, `Mail.Send`, `User.Read`,
  `offline_access`. Copy the *Application (client) ID*. In Settings → Integrations connect Outlook mail with it (tenant `organizations` by default), press
  **Sign in**, add the *Mailbox* source and switch on the **Email** loop. (You can reuse the app you registered for Teams by adding these permissions to it.)

AstroAI keeps a copy of this folder in `vendor/plugins/outlook` for its own tests and for simulate's demo; change it here first, then refresh that copy.
