// Microsoft Teams (chats) as an AstroAI integration plugin, through Microsoft Graph. It never sees your sign-in: ctx.http asks AstroAI to make each
// request, and AstroAI signs it with the access token it keeps fresh. Reads here; `chatReply` runs only after you confirmed a reply you drafted
// in AstroAI's approval queue. Channels are not read: that needs a Graph permission only an administrator can grant.

type Query = Record<string, string | number | boolean | string[]>
interface Ctx {
    simulate: boolean
    http: { get<T = unknown>(path: string, query?: Query): Promise<T>; send?<T = unknown>(method: 'POST', path: string, body?: Record<string, unknown>): Promise<T> }
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
    reply_to: string | null
}
interface Options { sinceHours?: number; limit?: number; channels?: string[] }

// ---------- Graph's shapes (only what is read) ----------

interface RawChat { id: string; topic?: string | null; chatType?: 'oneOnOne' | 'group' | 'meeting'; webUrl?: string; lastMessagePreview?: { createdDateTime?: string } | null }
interface RawMessage {
    id: string
    messageType?: string
    createdDateTime: string
    from?: { user?: { id?: string; displayName?: string } | null; application?: { displayName?: string } | null } | null
    body?: { contentType?: string; content?: string }
    mentions?: Array<{ mentioned?: { user?: { id?: string } | null } | null }>
    webUrl?: string | null
}

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }
/** A Teams message body is HTML: `<at>` becomes @name, breaks become new lines, the rest of the tags go. */
export function plain(body: { contentType?: string; content?: string } | undefined): string {
    const content = body?.content ?? ''
    if (body?.contentType !== 'html') return content.trim()
    return content
        .replace(/<at[^>]*>([^<]*)<\/at>/gi, '@$1')
        .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&(lt|gt|amp|quot|nbsp|#39);/g, (all) => ENTITIES[all] ?? all)
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

export async function test(ctx: Ctx) {
    if (ctx.simulate) return { ok: true, detail: 'Simulated: signed in as Riley Morgan' }
    try {
        const me = await ctx.http.get<{ displayName?: string; userPrincipalName?: string }>('/me')
        return { ok: true, detail: `Signed in as ${me.displayName || me.userPrincipalName || 'you'}` }
    } catch (error) {
        return { ok: false, detail: (error as Error).message }
    }
}

export async function chatMessages(ctx: Ctx, _source: Source, options: Options = {}) {
    const hours = Math.max(1, Math.min(168, options.sinceHours ?? 48))
    const limit = Math.max(1, Math.min(300, options.limit ?? 100))
    if (ctx.simulate) return simulated(hours)
    const since = Date.now() - hours * 3_600_000
    const who = await ctx.http.get<{ id: string; displayName?: string; userPrincipalName?: string }>('/me')
    const me = { id: who.id, name: who.displayName || who.userPrincipalName || 'you' }

    // The chats with something new in the window, newest first (a few: each is one more request).
    const chats = await ctx.http.get<{ value?: RawChat[] }>('/me/chats', { $expand: 'lastMessagePreview', $orderby: 'lastMessagePreview/createdDateTime desc', $top: 30 })
    const recent = (chats.value ?? []).filter((chat) => chat.lastMessagePreview?.createdDateTime && Date.parse(chat.lastMessagePreview.createdDateTime) >= since).slice(0, 15)

    const found: Message[] = []
    for (const chat of recent) {
        const listed = await ctx.http.get<{ value?: RawMessage[] }>(`/chats/${chat.id}/messages`, { $top: 25 })
        const messages = (listed.value ?? []).filter((raw) => raw.messageType === 'message' && Date.parse(raw.createdDateTime) >= since)
        const kind = chat.chatType === 'oneOnOne' ? 'dm' : 'group'
        // A one-to-one chat is named for the other person; a group by its topic.
        const other = messages.find((raw) => raw.from?.user?.id && raw.from.user.id !== me.id)?.from?.user?.displayName
        const name = kind === 'dm' ? other ?? 'a direct chat' : chat.topic || 'a group chat'
        for (const raw of messages) {
            const mentioned = (raw.mentions ?? []).some((entry) => entry.mentioned?.user?.id === me.id)
            const mine = raw.from?.user?.id === me.id
            // A direct message is for you; in a group chat only what mentions you is (the rest is a conversation you are in, not one you are asked into).
            const why: Why | null = kind === 'dm' ? (mentioned ? 'mention' : 'dm') : mentioned ? 'mention' : mine ? 'dm' : null
            if (!why) continue
            found.push({
                id: `${chat.id}:${raw.id}`, channel: { id: chat.id, name, kind }, thread: null,
                author: { id: raw.from?.user?.id ?? '', name: raw.from?.user?.displayName ?? raw.from?.application?.displayName ?? 'someone', me: mine },
                text: plain(raw.body).slice(0, 4000), at: new Date(raw.createdDateTime).toISOString(),
                url: raw.webUrl ?? chat.webUrl ?? `https://teams.microsoft.com/l/chat/${encodeURIComponent(chat.id)}/0`, why, replies: 0,
                // Chats have no threads: a reply is the next message in the chat.
                reply_to: null,
            })
        }
    }
    found.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    return { me, messages: found.slice(0, limit), truncated: found.length > limit }
}

// ---------- the write: only after you confirmed a reply in AstroAI's approval queue ----------

/** Post a message in a chat as you. */
export async function chatReply(ctx: Ctx, _source: Source, chat: string, _thread: string | null, text: string) {
    if (ctx.simulate) return { url: `https://teams.microsoft.com/l/chat/${encodeURIComponent(chat)}/0` }
    const sent = await ctx.http.send!<{ webUrl?: string | null }>('POST', `/chats/${chat}/messages`, { body: { contentType: 'text', content: text } })
    return { url: sent?.webUrl ?? `https://teams.microsoft.com/l/chat/${encodeURIComponent(chat)}/0` }
}

// ---------- simulate: invented chats, so it can be seen with no account ----------

function simulated(hours: number) {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
    const base = { me: { id: 'U1', name: 'Riley Morgan' } }
    const alex = { id: '19:alex-riley@unq.gbl.spaces', name: 'Alex Kim', kind: 'dm' as const }
    const crew = { id: '19:crew@thread.v2', name: 'Release crew', kind: 'group' as const }
    const messages: Message[] = [
        { id: `${alex.id}:2`, channel: alex, thread: null, author: { id: 'U-alex', name: 'Alex Kim', me: false }, text: 'Can you approve the staging deploy when you have a minute?', at: ago(40), url: 'https://teams.microsoft.com/l/message/1', why: 'dm', replies: 0, reply_to: null },
        { id: `${alex.id}:1`, channel: alex, thread: null, author: { id: 'U1', name: 'Riley Morgan', me: true }, text: 'On it after standup.', at: ago(300), url: null, why: 'dm', replies: 0, reply_to: null },
        { id: `${crew.id}:3`, channel: crew, thread: null, author: { id: 'U-priya', name: 'Priya Shah', me: false }, text: '@Riley Morgan the release notes need your sign-off before 4pm.', at: ago(95), url: 'https://teams.microsoft.com/l/message/3', why: 'mention', replies: 0, reply_to: null },
    ]
    return { ...base, messages: messages.filter((message) => Date.parse(message.at) > Date.now() - hours * 3_600_000), truncated: false }
}
