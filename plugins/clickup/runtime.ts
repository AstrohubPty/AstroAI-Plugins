// ClickUp as an AstroAI integration plugin. It never sees your token: ctx.http asks AstroAI to make each request,
// signs it, and sends it to api.clickup.com. This file only says which requests to make and how to read the answers.

// The shapes AstroAI hands in and expects back (AstroAI's own types: src/plugins/integration-sdk.ts).
type Query = Record<string, string | number | boolean | string[]>
interface Ctx {
    simulate: boolean
    http: { get<T = unknown>(path: string, query?: Query): Promise<T>; find<T = unknown>(path: string, query?: Query): Promise<T | null> }
}
interface Source { id: string; scope: Record<string, unknown> }
type Stage = 'todo' | 'active' | 'done' | 'cancelled'
interface Ticket {
    id: string; key: string; title: string; url: string; description: string | null
    status: { name: string; stage: Stage }
    priority: { name: string; rank: number } | null
    assignees: Array<{ id: string; name: string }>
    labels: string[]
    due: string | null; created_at: string | null; updated_at: string | null
    container: string | null; parent: string | null
    comments: Array<{ id: string; by: string | null; at: string; body: string }>
    extra: Record<string, unknown>
}

const PAGE = 100

// ---------- ClickUp's shapes (only what is read) ----------

interface RawStatus { status: string; type?: string }
interface RawTask {
    id: string
    custom_id?: string | null
    name: string
    text_content?: string | null
    description?: string | null
    status?: RawStatus | null
    priority?: { priority?: string; orderindex?: string } | null
    assignees?: Array<{ id: number | string; username?: string; email?: string }>
    tags?: Array<{ name: string }>
    parent?: string | null
    url?: string
    date_created?: string | null
    date_updated?: string | null
    due_date?: string | null
    list?: { id?: string; name?: string } | null
    folder?: { id?: string; name?: string } | null
}
interface RawComment { id: string | number; comment_text?: string; user?: { username?: string } | null; date?: string }

const iso = (ms: string | null | undefined): string | null => {
    const n = Number(ms)
    return ms && Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null
}

/** ClickUp's status types: open (the first), custom (in between), done and closed (the last). A status called cancelled is that. */
export function stageOf(status: RawStatus | null | undefined): Stage {
    const name = (status?.status ?? '').toLowerCase()
    if (/cancel|won'?t|abandon|declin/.test(name)) return 'cancelled'
    switch (status?.type) {
        case 'closed':
        case 'done': return 'done'
        case 'custom': return 'active'
        default: return 'todo'
    }
}

const PRIORITY_RANK: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4 }

/** One ClickUp task as the normalised ticket AstroAI wants. */
export function taskToTicket(raw: RawTask, comments: RawComment[] = []): Ticket {
    const priority = raw.priority?.priority ? { name: raw.priority.priority[0]!.toUpperCase() + raw.priority.priority.slice(1), rank: PRIORITY_RANK[raw.priority.priority.toLowerCase()] ?? 3 } : null
    return {
        id: raw.id,
        key: raw.custom_id || raw.id,
        title: raw.name,
        url: raw.url ?? `https://app.clickup.com/t/${raw.id}`,
        description: (raw.text_content ?? raw.description ?? '').trim() || null,
        status: { name: raw.status?.status ?? 'unknown', stage: stageOf(raw.status) },
        priority,
        assignees: (raw.assignees ?? []).map((person) => ({ id: String(person.id), name: person.username ?? person.email ?? String(person.id) })),
        labels: (raw.tags ?? []).map((tag) => tag.name),
        due: iso(raw.due_date),
        created_at: iso(raw.date_created),
        updated_at: iso(raw.date_updated),
        container: [raw.folder?.name, raw.list?.name].filter((name) => name && name !== 'hidden').join(' / ') || null,
        parent: raw.parent ?? null,
        // A comment with no date can't be placed in the conversation: it is left out.
        comments: comments.map((comment) => ({ id: String(comment.id), by: comment.user?.username ?? null, at: iso(comment.date) ?? '', body: (comment.comment_text ?? '').trim() })).filter((comment) => comment.body && comment.at),
        extra: { custom_id: raw.custom_id ?? null, list_id: raw.list?.id ?? null },
    }
}

const listIdOf = (source: Source): string => {
    const id = String(source.scope.list_id ?? '')
    if (!/^\d+$/.test(id)) throw new Error(`Source ${source.id} has no valid ClickUp list id`)
    return id
}

// ---------- what AstroAI calls ----------

export async function test(ctx: Ctx) {
    if (ctx.simulate) return { ok: true, detail: 'Simulated: signed in as riley' }
    try {
        const { user } = await ctx.http.get<{ user: { username?: string; email?: string } }>('/user')
        return { ok: true, detail: `Signed in as ${user.username ?? user.email ?? 'you'}` }
    } catch (error) {
        return { ok: false, detail: (error as Error).message }
    }
}

/** Every list you can reach, as "Workspace / Space / Folder / List", filtered by what you've typed. */
export async function discover(ctx: Ctx, kind: string, query = '') {
    if (kind !== 'list') return []
    if (ctx.simulate) return SIMULATED.lists.filter((entry) => !query || entry.label.toLowerCase().includes(query.toLowerCase()))
    const out: Array<{ value: string; label: string; name: string }> = []
    const needle = query.trim().toLowerCase()
    const add = (label: string, value: string, name: string) => {
        if (!needle || label.toLowerCase().includes(needle) || value === needle) out.push({ value, label, name })
    }
    const { teams } = await ctx.http.get<{ teams: Array<{ id: string; name: string }> }>('/team')
    for (const team of teams ?? []) {
        const { spaces } = await ctx.http.get<{ spaces: Array<{ id: string; name: string }> }>(`/team/${team.id}/space`, { archived: false })
        for (const space of spaces ?? []) {
            const { folders } = await ctx.http.get<{ folders: Array<{ name: string; lists?: Array<{ id: string; name: string }> }> }>(`/space/${space.id}/folder`, { archived: false })
            for (const folder of folders ?? []) for (const list of folder.lists ?? []) add(`${team.name} / ${space.name} / ${folder.name} / ${list.name}`, list.id, list.name)
            const { lists } = await ctx.http.get<{ lists: Array<{ id: string; name: string }> }>(`/space/${space.id}/list`, { archived: false })
            for (const list of lists ?? []) add(`${team.name} / ${space.name} / ${list.name}`, list.id, list.name)
        }
        if (out.length >= 200) break
    }
    return out.slice(0, 200)
}

/** The list's own statuses, in the order the list shows them (Sync keeps a role for each). */
export async function ticketsStatuses(ctx: Ctx, source: Source) {
    if (ctx.simulate) return SIMULATED.statuses
    const body = await ctx.http.get<{ statuses?: Array<{ status: string; type?: string; orderindex?: number }> }>(`/list/${listIdOf(source)}`)
    return [...(body.statuses ?? [])].sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0)).map((entry) => ({ name: entry.status, ...(entry.type ? { type: entry.type } : {}) }))
}

export async function ticketsList(ctx: Ctx, source: Source, options: { assignedToMe?: boolean; includeClosed?: boolean; limit?: number }) {
    if (ctx.simulate) return { tickets: SIMULATED.tasks.filter((task) => options.includeClosed || stageOf(task.status) !== 'done').map((task) => taskToTicket(task)), truncated: false }
    const list = listIdOf(source)
    const limit = Math.min(options.limit ?? 200, 1000)
    const me = options.assignedToMe ? (await ctx.http.get<{ user: { id: number } }>('/user')).user.id : null
    const found: Ticket[] = []
    let truncated = false
    for (let page = 0; ; page++) {
        const body = await ctx.http.get<{ tasks: RawTask[]; last_page?: boolean }>(`/list/${list}/task`, {
            page, include_closed: Boolean(options.includeClosed), subtasks: true, order_by: 'updated', reverse: true,
            ...(me !== null ? { assignees: [String(me)] } : {}),
        })
        for (const task of body.tasks ?? []) found.push(taskToTicket(task))
        const more = body.last_page === false || (body.last_page === undefined && (body.tasks?.length ?? 0) >= PAGE)
        if (found.length >= limit) {
            truncated = more || found.length > limit
            found.length = Math.min(found.length, limit)
            break
        }
        if (!more || !(body.tasks?.length)) break
    }
    return { tickets: found, truncated }
}

export async function ticketsGet(ctx: Ctx, _source: Source, id: string, options?: { comments?: boolean }) {
    if (ctx.simulate) {
        const task = [...SIMULATED.tasks, ...SIMULATED.parents].find((entry) => entry.id === id || entry.custom_id === id)
        return task ? taskToTicket(task, SIMULATED.comments[task.id] ?? []) : null
    }
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) return null
    // Any task the token can see, not only the lists you added: a ticket's parent is often in another one.
    const task = await ctx.http.find<RawTask>(`/task/${encodeURIComponent(id)}`, { include_subtasks: true })
    if (!task) return null
    const comments = options?.comments === false ? [] : (await ctx.http.get<{ comments: RawComment[] }>(`/task/${encodeURIComponent(id)}/comment`)).comments ?? []
    return taskToTicket(task, comments.slice().sort((a, b) => Number(a.date) - Number(b.date)))
}

// ---------- simulate: invented data through the same mapping ----------

const DAY = 86_400_000
// Relative to now, so the demo's due dates are never already overdue.
const at = (days: number) => String(Date.now() + days * DAY)
const SIMULATED = {
    lists: [{ value: '901100000001', label: 'Acme / Product / Sprint board', name: 'Sprint board' }, { value: '901100000002', label: 'Acme / Product / Bugs', name: 'Bugs' }],
    tasks: [
        { id: '86abc001', custom_id: 'ACME-101', name: 'Export audit log as CSV', text_content: 'Admins need the audit log as a CSV.\n\nAcceptance: one file per month, UTC dates.', status: { status: 'in progress', type: 'custom' }, priority: { priority: 'high', orderindex: '2' }, assignees: [{ id: 1, username: 'riley' }], tags: [{ name: 'export' }], parent: null, url: 'https://app.clickup.com/t/86abc001', date_created: at(-9), date_updated: at(-1), due_date: at(3), list: { id: '901100000001', name: 'Sprint board' }, folder: { name: 'hidden' } },
        { id: '86abc002', custom_id: 'ACME-102', name: 'Fix timezone on weekly digest', text_content: 'The digest goes out an hour late in winter.', status: { status: 'to do', type: 'open' }, priority: { priority: 'urgent', orderindex: '1' }, assignees: [{ id: 1, username: 'riley' }, { id: 2, username: 'sam' }], tags: [{ name: 'bug' }], parent: '86abc000', url: 'https://app.clickup.com/t/86abc002', date_created: at(-4), date_updated: at(-2), due_date: null, list: { id: '901100000001', name: 'Sprint board' }, folder: { name: 'hidden' } },
        { id: '86abc003', custom_id: null, name: 'Draft the onboarding email', text_content: '', status: { status: 'complete', type: 'closed' }, priority: null, assignees: [{ id: 2, username: 'sam' }], tags: [], parent: null, url: 'https://app.clickup.com/t/86abc003', date_created: at(-20), date_updated: at(-6), due_date: null, list: { id: '901100000001', name: 'Sprint board' }, folder: { name: 'hidden' } },
    ] as RawTask[],
    statuses: [
        { name: 'to do', type: 'open' }, { name: 'in progress', type: 'custom' }, { name: 'in review', type: 'custom' }, { name: 'ready for QA', type: 'custom' }, { name: 'complete', type: 'closed' },
    ],
    /** Tickets that are parents of the above and not on your board: asked for by id, never in the list. */
    parents: [
        { id: '86abc000', custom_id: 'ACME-100', name: 'Epic: Reporting overhaul', text_content: 'The umbrella for the digest and export work.', status: { status: 'in progress', type: 'custom' }, priority: { priority: 'normal', orderindex: '3' }, assignees: [{ id: 2, username: 'sam' }], tags: [], parent: null, url: 'https://app.clickup.com/t/86abc000', date_created: at(-30), date_updated: at(-1), due_date: null, list: { id: '901100000009', name: 'Roadmap' }, folder: { name: 'hidden' } },
    ] as RawTask[],
    comments: { '86abc001': [{ id: 'c1', comment_text: 'Should it skip months with no events?', user: { username: 'sam' }, date: at(-3) }, { id: 'c2', comment_text: 'Yes: no file for an empty month.', user: { username: 'riley' }, date: at(-2) }] } as Record<string, RawComment[]>,
}
