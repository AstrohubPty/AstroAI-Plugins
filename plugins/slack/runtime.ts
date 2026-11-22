// Slack as an AstroAI integration plugin. It never sees your token: ctx.http asks AstroAI to make each request, signs it, and sends it
// to slack.com. This file says which Web API calls to make and how to read the answers. Reads only here: no message is posted.

// The shapes AstroAI hands in and expects back (AstroAI's own types: src/plugins/integration-sdk.ts).
type Query = Record<string, string | number | boolean | string[]>
interface Ctx {
    simulate: boolean
    http: { get<T = unknown>(path: string, query?: Query): Promise<T> }
}
interface Source { id: string; scope: Record<string, unknown> }
type Why = 'mention' | 'dm' | 'thread' | 'channel'
interface Message {
    id: string
    channel: { id: string; name: string; kind: 'channel' | 'dm' | 'group' }
    thread: string | null
    author: { id: string; name: string; me: boolean }
    text: string
    at: string
    url: string | null
    why: Why
    replies: number
}
interface Options { sinceHours?: number; limit?: number; channels?: string[] }

/** Slack answers 200 even when it refuses: `{ ok: false, error }`. Say what it said, in words. */
interface Reply { ok: boolean; error?: string; needed?: string; provided?: string }
const WORDS: Record<string, string> = {
    invalid_auth: 'Slack refused the token (it is wrong or was revoked)', not_authed: 'Slack got no token', token_revoked: 'the token was revoked', token_expired: 'the token expired',
    account_inactive: 'that Slack account is deactivated', missing_scope: 'the token is missing a scope', ratelimited: 'Slack is rate limiting: try again in a minute',
    channel_not_found: 'that channel was not found', not_in_channel: 'you are not in that channel', is_archived: 'that channel is archived',
}
async function call<T extends Reply>(ctx: Ctx, method: string, query?: Query): Promise<T> {
    const body = await ctx.http.get<T>(`/${method}`, query)
    if (!body?.ok) {
        const code = body?.error ?? 'unknown_error'
        const scope = code === 'missing_scope' && body?.needed ? ` (${body.needed})` : ''
        throw new Error(`Slack: ${WORDS[code] ?? code}${scope}`)
    }
    return body
}

// ---------- Slack's shapes (only what is read) ----------

interface RawMessage { ts: string; user?: string; username?: string; bot_id?: string; text?: string; thread_ts?: string; reply_count?: number; subtype?: string }
interface RawConversation { id: string; name?: string; user?: string; is_im?: boolean; is_mpim?: boolean; is_private?: boolean; is_user_deleted?: boolean }
interface RawMatch { ts: string; text?: string; user?: string; username?: string; permalink?: string; channel?: { id: string; name?: string; is_im?: boolean; is_mpim?: boolean } }

const DAY_ONLY = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const isoOf = (ts: string) => new Date(Number(ts) * 1000).toISOString()

/** Turn Slack's markup into text a person reads: `<@U1>` → @name, `<#C1|general>` → #general, `<https://x|label>` → label. */
export function plain(text: string, names: Map<string, string>): string {
    return text
        .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_all, id: string) => `@${names.get(id) ?? id}`)
        .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
        .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
        .replace(/<mailto:[^|>]+\|([^>]+)>/g, '$1')
        .replace(/<mailto:([^>]+)>/g, '$1')
        .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2')
        .replace(/<(https?:\/\/[^>]+)>/g, '$1')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .trim()
}

function linkFor(workspace: string, channel: string, ts: string, thread?: string | null): string {
    const base = `${workspace.replace(/\/$/, '')}/archives/${channel}/p${ts.replace('.', '')}`
    return thread && thread !== ts ? `${base}?thread_ts=${thread}&cid=${channel}` : base
}

/** `thread_ts` out of a Slack permalink (`…/p1700000000000100?thread_ts=1699999999.000100&cid=C1`). */
const threadOf = (permalink: string | undefined) => /[?&]thread_ts=(\d+\.\d+)/.exec(permalink ?? '')?.[1] ?? null

export async function test(ctx: Ctx) {
    if (ctx.simulate) return { ok: true, detail: 'Simulated: signed in to Acme as riley' }
    try {
        const me = await call<Reply & { user: string; team: string }>(ctx, 'auth.test')
        return { ok: true, detail: `Signed in to ${me.team} as ${me.user}` }
    } catch (error) {
        return { ok: false, detail: (error as Error).message }
    }
}

export async function chatMessages(ctx: Ctx, source: Source, options: Options = {}) {
    const hours = Math.max(1, Math.min(168, options.sinceHours ?? 48))
    const limit = Math.max(1, Math.min(300, options.limit ?? 100))
    if (ctx.simulate) return simulated(options, hours)
    const since = Date.now() - hours * 3_600_000
    const oldest = String(since / 1000)
    const who = await call<Reply & { user_id: string; user: string; url: string }>(ctx, 'auth.test')
    const me = { id: who.user_id, name: who.user }
    const workspace = who.url ?? 'https://app.slack.com'

    // Who is who, once: a name for every id in what follows (a big workspace's first thousand is plenty).
    const names = new Map<string, string>()
    try {
        const users = await call<Reply & { members?: Array<{ id: string; name: string; real_name?: string; profile?: { display_name?: string } }> }>(ctx, 'users.list', { limit: 1000 })
        for (const member of users.members ?? []) names.set(member.id, member.profile?.display_name || member.real_name || member.name)
    } catch {
        // without users:read the ids stand in for names
    }
    names.set(me.id, me.name)
    const nameOf = (id: string | undefined, fallback?: string) => (id ? names.get(id) ?? fallback ?? id : fallback ?? 'someone')

    const found = new Map<string, Message>()
    const add = (channel: Message['channel'], raw: RawMessage, why: Why, permalink?: string) => {
        if (!raw.ts || raw.subtype === 'channel_join' || raw.subtype === 'channel_leave') return
        // Slack always includes a thread's first message, however old: only what is inside the window counts.
        if (Number(raw.ts) * 1000 < since) return
        const id = `${channel.id}:${raw.ts}`
        const thread = raw.thread_ts && raw.thread_ts !== raw.ts ? raw.thread_ts : null
        const existing = found.get(id)
        // A message found twice keeps the stronger reason: a mention or a direct message beats a thread or a channel.
        if (existing && ['dm', 'mention'].includes(existing.why)) return
        found.set(id, {
            id, channel, thread, author: { id: raw.user ?? raw.bot_id ?? '', name: nameOf(raw.user, raw.username ?? (raw.bot_id ? 'a bot' : undefined)), me: raw.user === me.id },
            text: plain(raw.text ?? '', names).slice(0, 4000), at: isoOf(raw.ts), url: permalink ?? linkFor(workspace, channel.id, raw.ts, thread), why, replies: raw.reply_count ?? 0,
        })
    }

    // 1. Mentions of you, from search (one call).
    const searched = await call<Reply & { messages?: { matches?: RawMatch[] } }>(ctx, 'search.messages', { query: `<@${me.id}> after:${DAY_ONLY(since - 86_400_000)}`, sort: 'timestamp', sort_dir: 'desc', count: 50 })
    for (const match of searched.messages?.matches ?? []) {
        if (!match.channel || Number(match.ts) * 1000 < since) continue
        const kind = match.channel.is_im ? 'dm' : match.channel.is_mpim ? 'group' : 'channel'
        add({ id: match.channel.id, name: match.channel.name ?? match.channel.id, kind }, { ts: match.ts, user: match.user, ...(match.username ? { username: match.username } : {}), ...(match.text ? { text: match.text } : {}), ...(threadOf(match.permalink) ? { thread_ts: threadOf(match.permalink)! } : {}) }, kind === 'channel' ? 'mention' : 'dm', match.permalink)
    }

    // 2. Direct messages and group messages with activity in the window (a few calls: the most recent conversations only).
    const conversations = await call<Reply & { channels?: RawConversation[] }>(ctx, 'conversations.list', { types: 'im,mpim', limit: 100, exclude_archived: true })
    for (const conversation of (conversations.channels ?? []).filter((entry) => !entry.is_user_deleted).slice(0, 20)) {
        const kind = conversation.is_mpim ? 'group' : 'dm'
        const name = conversation.is_mpim ? (conversation.name ?? 'group').replace(/^mpdm-/, '').replace(/-\d+$/, '').replace(/--/g, ', ') : nameOf(conversation.user)
        const history = await call<Reply & { messages?: RawMessage[] }>(ctx, 'conversations.history', { channel: conversation.id, oldest, limit: 15 })
        for (const raw of history.messages ?? []) add({ id: conversation.id, name, kind }, raw, 'dm')
    }

    // 3. Threads you are in that have moved since you spoke (your own recent thread posts, then what came after them).
    const mine = await call<Reply & { messages?: { matches?: RawMatch[] } }>(ctx, 'search.messages', { query: `from:<@${me.id}> is:thread after:${DAY_ONLY(since - 86_400_000)}`, sort: 'timestamp', sort_dir: 'desc', count: 30 })
    const threads = new Map<string, { channel: Message['channel']; thread: string }>()
    for (const match of mine.messages?.matches ?? []) {
        const thread = threadOf(match.permalink)
        if (!match.channel || !thread || match.channel.is_im || match.channel.is_mpim) continue
        threads.set(`${match.channel.id}:${thread}`, { channel: { id: match.channel.id, name: match.channel.name ?? match.channel.id, kind: 'channel' }, thread })
    }
    for (const { channel, thread } of [...threads.values()].slice(0, 10)) {
        const replies = await call<Reply & { messages?: RawMessage[] }>(ctx, 'conversations.replies', { channel: channel.id, ts: thread, oldest, limit: 30 })
        for (const raw of replies.messages ?? []) add(channel, raw, 'thread')
    }

    // 4. The channels this source watches (for digests): their recent messages, whoever they are for.
    const watched = (options.channels ?? []).map((name) => name.replace(/^#/, '').toLowerCase()).slice(0, 6)
    if (watched.length) {
        const list = await call<Reply & { channels?: RawConversation[] }>(ctx, 'conversations.list', { types: 'public_channel,private_channel', limit: 1000, exclude_archived: true })
        for (const entry of (list.channels ?? []).filter((channel) => watched.includes((channel.name ?? '').toLowerCase()))) {
            const history = await call<Reply & { messages?: RawMessage[] }>(ctx, 'conversations.history', { channel: entry.id, oldest, limit: 50 })
            for (const raw of history.messages ?? []) add({ id: entry.id, name: entry.name ?? entry.id, kind: 'channel' }, raw, 'channel')
        }
    }

    const messages = [...found.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    return { me, messages: messages.slice(0, limit), truncated: messages.length > limit }
}

// ---------- simulate: an invented workspace, so it can be seen with no account ----------

function simulated(options: Options, hours: number) {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
    const base = { me: { id: 'U1', name: 'riley' } }
    const person = (name: string) => ({ id: `U-${name}`, name, me: false })
    const eng = { id: 'C-eng', name: 'engineering', kind: 'channel' as const }
    const rel = { id: 'C-rel', name: 'releases', kind: 'channel' as const }
    const alex = { id: 'D-alex', name: 'alex', kind: 'dm' as const }
    const messages: Message[] = [
        { id: 'C-eng:1', channel: eng, thread: null, author: person('sam'), text: '@riley can you look at the CSV export PR before standup? It blocks the audit log work.', at: ago(25), url: 'https://acme.slack.com/archives/C-eng/p1', why: 'mention', replies: 2 },
        { id: 'D-alex:1', channel: alex, thread: null, author: person('alex'), text: 'Are we still shipping the digest fix on Friday?', at: ago(70), url: 'https://acme.slack.com/archives/D-alex/p1', why: 'dm', replies: 0 },
        { id: 'C-eng:2', channel: eng, thread: 'C-eng:0', author: person('jo'), text: 'Re: the timezone bug: it only reproduces for users on a UTC offset with a half hour.', at: ago(180), url: 'https://acme.slack.com/archives/C-eng/p2?thread_ts=0', why: 'thread', replies: 0 },
        { id: 'D-alex:0', channel: alex, thread: null, author: { id: 'U1', name: 'riley', me: true }, text: 'Morning! Looking at it now.', at: ago(400), url: null, why: 'dm', replies: 0 },
        { id: 'C-rel:1', channel: rel, thread: null, author: person('priya'), text: 'v2.14 is out: export, audit log filters, and the weekly digest timezone fix.', at: ago(300), url: 'https://acme.slack.com/archives/C-rel/p1', why: 'channel', replies: 4 },
        { id: 'C-eng:3', channel: eng, thread: null, author: person('sam'), text: 'Deploy of the api service failed on staging: rolling back. Root cause looks like the new migration.', at: ago(600), url: 'https://acme.slack.com/archives/C-eng/p3', why: 'channel', replies: 6 },
    ]
    const wanted = (options.channels ?? ['engineering', 'releases']).map((name) => name.replace(/^#/, ''))
    return { ...base, messages: messages.filter((message) => message.why !== 'channel' || wanted.includes(message.channel.name)).filter((message) => Date.parse(message.at) > Date.now() - hours * 3_600_000), truncated: false }
}
