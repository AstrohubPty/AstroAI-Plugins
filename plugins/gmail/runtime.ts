// Gmail as an AstroAI integration plugin, through the Gmail API. It never sees your sign-in: ctx.http asks AstroAI to make each request, and AstroAI
// signs it with the access token it keeps fresh. Reads here; `emailReply` runs only after you confirmed a reply you drafted in AstroAI's approval queue.
// Only headers and Gmail's short snippet are read, never the whole body.

type Query = Record<string, string | number | boolean | string[]>
interface Ctx {
    simulate: boolean
    http: { get<T = unknown>(path: string, query?: Query): Promise<T>; send?<T = unknown>(method: 'POST', path: string, body?: Record<string, unknown>): Promise<T> }
}
interface Source { id: string; scope: Record<string, unknown> }
interface Mail {
    id: string
    thread: string | null
    from: { name: string; address: string; me: boolean }
    to_me: boolean
    subject: string
    preview: string
    at: string
    url: string | null
    unread: boolean
    flagged: boolean
    bulk: boolean
    answered: boolean
}
interface Options { sinceHours?: number; limit?: number }

interface RawMessage { id: string; threadId?: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: { headers?: Array<{ name: string; value: string }> } }

const header = (message: RawMessage, name: string) => message.payload?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? ''
/** `Ada Lovelace <ada@x.example>` or a bare address, split. */
export function address(value: string): { name: string; address: string } {
    const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value)
    return match ? { name: match[1]!.trim() || match[2]!.trim(), address: match[2]!.trim() } : { name: value.trim(), address: value.trim() }
}
const lower = (value: string) => value.toLowerCase()
const decode = (text: string) => text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

export async function test(ctx: Ctx) {
    if (ctx.simulate) return { ok: true, detail: 'Simulated: signed in as riley@acme.example' }
    try {
        const profile = await ctx.http.get<{ emailAddress?: string }>('/profile')
        return { ok: true, detail: `Signed in as ${profile.emailAddress ?? 'you'}` }
    } catch (error) {
        return { ok: false, detail: (error as Error).message }
    }
}

export async function emailMessages(ctx: Ctx, _source: Source, options: Options = {}) {
    const hours = Math.max(1, Math.min(336, options.sinceHours ?? 72))
    const limit = Math.max(1, Math.min(300, options.limit ?? 100))
    if (ctx.simulate) return simulated(hours)
    const days = Math.max(1, Math.ceil(hours / 24))
    const since = Date.now() - hours * 3_600_000
    const profile = await ctx.http.get<{ emailAddress?: string }>('/profile')
    const mine = profile.emailAddress ?? ''
    const me = { name: mine, address: mine }

    // The inbox over the window, then each message's headers and snippet (a few at a time).
    const listed = await ctx.http.get<{ messages?: Array<{ id: string; threadId?: string }> }>('/messages', { q: `in:inbox newer_than:${days}d`, maxResults: 40 })
    const get = (id: string, headers: string[]) => ctx.http.get<RawMessage>(`/messages/${id}`, { format: 'metadata', metadataHeaders: headers })
    const raws: RawMessage[] = []
    const ids = (listed.messages ?? []).slice(0, 40)
    for (let i = 0; i < ids.length; i += 10) raws.push(...(await Promise.all(ids.slice(i, i + 10).map((entry) => get(entry.id, ['From', 'To', 'Subject', 'List-Unsubscribe', 'Precedence'])))))

    // What you have replied to: your sent mail in the window, by conversation and when.
    const sentList = await ctx.http.get<{ messages?: Array<{ id: string; threadId?: string }> }>('/messages', { q: `in:sent newer_than:${days}d`, maxResults: 20 })
    const sent = await Promise.all((sentList.messages ?? []).slice(0, 20).map((entry) => get(entry.id, ['Date'])))
    const repliedAt = new Map<string, number>()
    for (const message of sent) if (message.threadId && message.internalDate) repliedAt.set(message.threadId, Math.max(repliedAt.get(message.threadId) ?? 0, Number(message.internalDate)))

    const mails: Mail[] = raws.filter((raw) => Number(raw.internalDate) >= since).map((raw) => {
        const from = address(header(raw, 'From'))
        const labels = raw.labelIds ?? []
        const bulk = Boolean(header(raw, 'List-Unsubscribe')) || /bulk|list|junk/i.test(header(raw, 'Precedence')) || labels.some((label) => ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'].includes(label))
        return {
            id: raw.id, thread: raw.threadId ?? null, from: { ...from, me: lower(from.address) === lower(mine) },
            to_me: lower(header(raw, 'To')).includes(lower(mine)), subject: (header(raw, 'Subject') || '(no subject)').slice(0, 300), preview: decode(raw.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
            at: new Date(Number(raw.internalDate)).toISOString(), url: `https://mail.google.com/mail/u/0/#inbox/${raw.id}`,
            unread: labels.includes('UNREAD'), flagged: labels.includes('IMPORTANT') || labels.includes('STARRED'), bulk,
            answered: Boolean(raw.threadId && (repliedAt.get(raw.threadId) ?? 0) > Number(raw.internalDate)),
        }
    }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    return { me, messages: mails.slice(0, limit), truncated: mails.length > limit }
}

// ---------- the write: only after you confirmed a reply in AstroAI's approval queue ----------

/** Reply to one message (to its sender, in its conversation) as you. */
export async function emailReply(ctx: Ctx, _source: Source, id: string, text: string) {
    if (ctx.simulate) return { url: null }
    const original = await ctx.http.get<RawMessage>(`/messages/${id}`, { format: 'metadata', metadataHeaders: ['From', 'Reply-To', 'Subject', 'Message-ID', 'References'] })
    const to = address(header(original, 'Reply-To') || header(original, 'From')).address
    if (!to) throw new Error('the message has no sender to reply to')
    const subject = header(original, 'Subject')
    const messageId = header(original, 'Message-ID')
    // A plain-text reply in the same conversation (In-Reply-To and References thread it), with no line of the headers left to injection.
    const clean = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()
    const lines = [
        `To: ${clean(to)}`, `Subject: ${/^re:/i.test(subject) ? clean(subject) : `Re: ${clean(subject)}`}`,
        ...(messageId ? [`In-Reply-To: ${clean(messageId)}`, `References: ${clean([header(original, 'References'), messageId].filter(Boolean).join(' '))}`] : []),
        'Content-Type: text/plain; charset="UTF-8"', 'MIME-Version: 1.0', '', text,
    ]
    const raw = Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url')
    await ctx.http.send!('POST', '/messages/send', { raw, ...(original.threadId ? { threadId: original.threadId } : {}) })
    return { url: null }
}

// ---------- simulate: an invented mailbox, so it can be seen with no account ----------

function simulated(hours: number) {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
    const me = { name: 'riley@acme.example', address: 'riley@acme.example' }
    const base = { thread: null, bulk: false, answered: false, url: null }
    const messages: Mail[] = [
        { ...base, id: 'g1', from: { name: 'Priya Shah', address: 'priya@acme.example', me: false }, to_me: true, subject: 'Release notes need your sign-off', preview: 'Could you read the v2.14 notes before 4pm?', at: ago(35), unread: true, flagged: true },
        { ...base, id: 'g2', from: { name: 'Digest', address: 'news@digest.example', me: false }, to_me: true, subject: 'Your weekly digest', preview: 'Ten stories…', at: ago(500), unread: true, flagged: false, bulk: true },
    ]
    return { me, messages: messages.filter((mail) => Date.parse(mail.at) > Date.now() - hours * 3_600_000), truncated: false }
}
