// PostHog as an AstroAI integration plugin. It never sees your key: ctx.http asks AstroAI to make each request, signs it,
// and sends it to PostHog Cloud (the account's region). This file says which queries to make and how to read the answers.
// Everything is read with HogQL (PostHog's query language) through the query endpoint: nothing is created or changed.

// The shapes AstroAI hands in and expects back (AstroAI's own types: src/plugins/integration-sdk.ts).
interface Ctx {
    account: { region?: string }
    simulate: boolean
    http: { get<T = unknown>(path: string): Promise<T>; read<T = unknown>(path: string, body?: unknown): Promise<T> }
}
interface Source { id: string; scope: Record<string, unknown> }

const DAYS = 7

const projectIdOf = (source: Source): string => {
    const id = String(source.scope.project_id ?? '')
    if (!/^\d+$/.test(id)) throw new Error(`Source ${source.id} has no valid PostHog project id`)
    return id
}

/** The event names to count: a name PostHog could have (letters, digits and $ _ . : - space), at most 10, each quoted for HogQL. */
export function eventNames(source: Source): string[] {
    const given = Array.isArray(source.scope.events) ? source.scope.events : []
    return [...new Set(given.map((name) => String(name).trim()).filter((name) => /^[$A-Za-z0-9_.: -]{1,80}$/.test(name)))].slice(0, 10)
}
const quote = (name: string) => `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** One HogQL query: the rows it returns. */
async function hogql(ctx: Ctx, project: string, query: string): Promise<unknown[][]> {
    const body = await ctx.http.read<{ results?: unknown[][] }>(`/api/projects/${project}/query/`, { query: { kind: 'HogQLQuery', query } })
    return body.results ?? []
}
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0)

export async function test(ctx: Ctx) {
    if (ctx.simulate) return { ok: true, detail: 'Simulated: signed in as riley' }
    try {
        const me = await ctx.http.get<{ first_name?: string; email?: string }>('/api/users/@me/')
        return { ok: true, detail: `Signed in as ${me.first_name || me.email || 'you'}` }
    } catch (error) {
        return { ok: false, detail: (error as Error).message }
    }
}

export async function discover(ctx: Ctx, kind: string, query = '') {
    if (kind !== 'project') return []
    if (ctx.simulate) return [{ value: '12345', label: 'acme.example', name: 'acme.example' }]
    const body = await ctx.http.get<{ results?: Array<{ id: number | string; name?: string }> }>('/api/projects/')
    const needle = query.trim().toLowerCase()
    return (body.results ?? [])
        .filter((project) => !needle || (project.name ?? '').toLowerCase().includes(needle) || String(project.id).includes(needle))
        .map((project) => ({ value: String(project.id), label: project.name || String(project.id), name: project.name || String(project.id) }))
}

export async function analyticsSummary(ctx: Ctx, source: Source) {
    if (ctx.simulate) return SIMULATED(source)
    const project = projectIdOf(source)
    const window = `timestamp >= now() - INTERVAL ${DAYS} DAY`
    const earlier = `timestamp < now() - INTERVAL ${DAYS} DAY`
    const names = eventNames(source)
    const [info, totals, pages, counted] = await Promise.all([
        ctx.http.get<{ name?: string }>(`/api/projects/${project}/`).catch(() => ({ name: undefined })),
        hogql(ctx, project, `SELECT countIf(${window}), uniqIf(distinct_id, ${window}), countIf(${earlier}), uniqIf(distinct_id, ${earlier}) FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${DAYS * 2} DAY`),
        hogql(ctx, project, `SELECT properties.$pathname AS path, count() AS views, uniq(distinct_id) AS visitors FROM events WHERE event = '$pageview' AND ${window} GROUP BY path ORDER BY views DESC LIMIT 10`),
        names.length
            ? hogql(ctx, project, `SELECT event, countIf(${window}), countIf(${earlier}) FROM events WHERE event IN (${names.map(quote).join(', ')}) AND timestamp >= now() - INTERVAL ${DAYS * 2} DAY GROUP BY event`)
            : Promise.resolve([] as unknown[][]),
    ])
    const [views, visitors, viewsBefore, visitorsBefore] = (totals[0] ?? []).map(num)
    const byName = new Map(counted.map((row) => [String(row[0]), row]))
    const region = ctx.account.region === 'eu' ? 'eu' : 'us'
    return {
        project: info.name || `project ${project}`,
        days: DAYS,
        metrics: [
            { key: 'visitors', label: 'Visitors', value: visitors ?? 0, previous: visitorsBefore ?? null },
            { key: 'pageviews', label: 'Pageviews', value: views ?? 0, previous: viewsBefore ?? null },
        ],
        pages: pages.map((row) => ({ path: row[0] ? String(row[0]) : '(none)', views: num(row[1]), visitors: num(row[2]) })),
        // The events asked for, in the order asked, with zero for one that never fired.
        events: names.map((name) => ({ name, count: num(byName.get(name)?.[1]), previous: num(byName.get(name)?.[2]) })),
        url: `https://${region}.posthog.com/project/${project}`,
    }
}

// ---------- simulate: invented numbers, so it can be seen with no account ----------

function SIMULATED(source: Source) {
    const names = eventNames(source)
    const invented: Record<string, [number, number]> = { signup: [86, 71], export_csv: [212, 240] }
    return {
        project: 'acme.example',
        days: DAYS,
        metrics: [
            { key: 'visitors', label: 'Visitors', value: 4210, previous: 3685 },
            { key: 'pageviews', label: 'Pageviews', value: 12840, previous: 11902 },
        ],
        pages: [
            { path: '/', views: 4120, visitors: 3105 }, { path: '/pricing', views: 1980, visitors: 1544 }, { path: '/docs/getting-started', views: 1432, visitors: 902 },
            { path: '/blog/launch-week', views: 877, visitors: 811 }, { path: '/login', views: 640, visitors: 402 },
        ],
        events: names.map((name) => ({ name, count: invented[name]?.[0] ?? 0, previous: invented[name]?.[1] ?? 0 })),
        url: 'https://us.posthog.com/project/12345',
    }
}
