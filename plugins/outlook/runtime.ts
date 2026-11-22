// Outlook mail as an AstroAI integration plugin, through Microsoft Graph. It never sees your sign-in: ctx.http asks AstroAI to make each request, and
// AstroAI signs it with the access token it keeps fresh. Reads here; `emailReply` runs only after you confirmed a reply you drafted in AstroAI's
// approval queue. Only the preview of each message is read (Graph's bodyPreview), never the whole body.

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

interface Address { emailAddress?: { name?: string; address?: string } }
interface RawMail {
    id: string
    subject?: string | null
    from?: Address | null
    toRecipients?: Address[]
    bodyPreview?: string
    receivedDateTime: string
    isRead?: boolean
    importance?: string
    flag?: { flagStatus?: string }
    conversationId?: string
    webLink?: string
    inferenceClassification?: string
}

const same = (a: string | undefined, b: string | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase())

export async function test(ctx: Ctx) {
    if (ctx.simulate) return { ok: true, detail: 'Simulated: signed in as Riley Morgan' }
    try {
        const me = await ctx.http.get<{ displayName?: string; mail?: string; userPrincipalName?: string }>('/me')
        return { ok: true, detail: `Signed in as ${me.displayName || me.mail || me.userPrincipalName || 'you'}` }
    } catch (error) {
        return { ok: false, detail: (error as Error).message }
    }
}

export async function emailMessages(ctx: Ctx, _source: Source, options: Options = {}) {
    const hours = Math.max(1, Math.min(336, options.sinceHours ?? 72))
    const limit = Math.max(1, Math.min(300, options.limit ?? 100))
    if (ctx.simulate) return simulated(hours)
    const since = new Date(Date.now() - hours * 3_600_000).toISOString()
    const who = await ctx.http.get<{ displayName?: string; mail?: string; userPrincipalName?: string }>('/me')
    const address = who.mail || who.userPrincipalName || ''
    const me = { name: who.displayName || address || 'you', address }

    const inbox = await ctx.http.get<{ value?: RawMail[] }>('/me/mailFolders/inbox/messages', {
        $filter: `receivedDateTime ge ${since}`, $orderby: 'receivedDateTime desc', $top: 50,
        $select: 'id,subject,from,toRecipients,bodyPreview,receivedDateTime,isRead,importance,flag,conversationId,webLink,inferenceClassification',
    })
    // What you have replied to: the conversations you sent something in since then, and when.
    const sent = await ctx.http.get<{ value?: Array<{ conversationId?: string; sentDateTime?: string }> }>('/me/mailFolders/sentitems/messages', { $filter: `sentDateTime ge ${since}`, $orderby: 'sentDateTime desc', $top: 50, $select: 'conversationId,sentDateTime' })
    const repliedAt = new Map<string, number>()
    for (const message of sent.value ?? []) if (message.conversationId && message.sentDateTime) repliedAt.set(message.conversationId, Math.max(repliedAt.get(message.conversationId) ?? 0, Date.parse(message.sentDateTime)))

    const mails: Mail[] = (inbox.value ?? []).map((raw) => {
        const from = raw.from?.emailAddress
        const at = new Date(raw.receivedDateTime).toISOString()
        return {
            id: raw.id, thread: raw.conversationId ?? null,
            from: { name: from?.name || from?.address || 'someone', address: from?.address ?? '', me: same(from?.address, address) },
            to_me: (raw.toRecipients ?? []).some((entry) => same(entry.emailAddress?.address, address)),
            subject: (raw.subject ?? '(no subject)').slice(0, 300), preview: (raw.bodyPreview ?? '').replace(/\s+/g, ' ').trim().slice(0, 300), at, url: raw.webLink ?? null,
            unread: raw.isRead === false, flagged: raw.flag?.flagStatus === 'flagged' || raw.importance === 'high',
            // Outlook sorts newsletters, notifications and the like into "Other"; that is what counts as bulk.
            bulk: raw.inferenceClassification === 'other',
            answered: Boolean(raw.conversationId && (repliedAt.get(raw.conversationId) ?? 0) > Date.parse(raw.receivedDateTime)),
        }
    })
    return { me, messages: mails.slice(0, limit), truncated: mails.length > limit }
}

// ---------- the write: only after you confirmed a reply in AstroAI's approval queue ----------

/** Reply to one message (to its sender) as you. Graph answers 202 with nothing. */
export async function emailReply(ctx: Ctx, _source: Source, id: string, text: string) {
    if (ctx.simulate) return { url: null }
    await ctx.http.send!('POST', `/me/messages/${id}/reply`, { comment: text })
    return { url: null }
}

// ---------- simulate: an invented mailbox, so it can be seen with no account ----------

function simulated(hours: number) {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
    const me = { name: 'Riley Morgan', address: 'riley@acme.example' }
    const person = (name: string, address: string) => ({ name, address, me: false })
    const base = { thread: null, bulk: false, answered: false }
    const messages: Mail[] = [
        { ...base, id: 'AAMk-1', from: person('Priya Shah', 'priya@acme.example'), to_me: true, subject: 'Release notes need your sign-off', preview: 'Hi Riley, the v2.14 release notes are drafted. Could you read them before 4pm and say if anything is wrong?', at: ago(35), url: 'https://outlook.office.com/mail/id/AAMk-1', unread: true, flagged: true },
        { ...base, id: 'AAMk-2', from: person('Alex Kim', 'alex@acme.example'), to_me: true, subject: 'Staging deploy approval', preview: 'Can you approve the staging deploy when you have a minute? It is blocking QA.', at: ago(120), url: 'https://outlook.office.com/mail/id/AAMk-2', unread: true, flagged: false },
        { ...base, id: 'AAMk-3', from: person('Sam Lee', 'sam@acme.example'), to_me: true, subject: 'Re: CSV export', preview: 'Thanks, that works. I will merge it after lunch.', at: ago(300), url: 'https://outlook.office.com/mail/id/AAMk-3', unread: false, flagged: false, answered: true, thread: 'conv-3' },
        { ...base, id: 'AAMk-4', from: person('The Weekly Digest', 'news@digest.example'), to_me: true, subject: 'Your weekly digest', preview: 'Ten stories you might have missed this week…', at: ago(500), url: null, unread: true, flagged: false, bulk: true },
        { ...base, id: 'AAMk-5', from: person('Jo Ng', 'jo@acme.example'), to_me: false, subject: 'FYI: timezone bug notes', preview: 'Copying you on these notes for later. No action needed.', at: ago(700), url: null, unread: true, flagged: false },
    ]
    return { me, messages: messages.filter((mail) => Date.parse(mail.at) > Date.now() - hours * 3_600_000), truncated: false }
}
