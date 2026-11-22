# Gmail

The mail that needs you in Gmail, in Work → Email: messages that are **unread, important or starred**, **addressed to you** (not only copied), **not bulk**
(promotions, social, updates, forums and anything with an unsubscribe header are left out) and **not answered yet** (you haven't replied in the conversation
since). **Reply…** drafts a reply in AstroAI's approval queue first: nothing is sent until you press the button and confirm (in dry-run, the default, it is
only recorded in the Outbox).

- **The Gmail API, with your own sign-in.** You create a small OAuth client in Google Cloud once and sign in to it from AstroAI. AstroAI keeps the refresh token
  in your keychain and signs each request with a short-lived access token; the plugin's code never sees either. It may read from `gmail.googleapis.com` and
  send only `POST /messages/send`.
- **Headers and snippets only.** Only the sender, subject and Gmail's short snippet are read, never the whole body.
- **Setup:** console.cloud.google.com → a project → *APIs & Services* → enable the **Gmail API** → *OAuth consent screen* (External; add yourself as a *test user*)
  → *Credentials* → *Create credentials* → *OAuth client ID* → **Desktop app**. Add the redirect URI exactly as AstroAI shows it (`http://localhost:<port>/oauth/callback`).
  Copy the client ID and client secret. In Settings → Integrations connect Gmail with them, press **Sign in**, add the *Mailbox* source and switch on the **Email** loop.
  While the consent screen is in *Testing*, Google expires the sign-in after 7 days: press *Sign in* again, or publish the app for yourself.

AstroAI keeps a copy of this folder in `vendor/plugins/gmail` for its own tests and for simulate's demo; change it here first, then refresh that copy.
