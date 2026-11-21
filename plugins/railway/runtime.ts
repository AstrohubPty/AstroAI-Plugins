// Railway as an AstroAI integration plugin. It never sees your token: ctx.http asks AstroAI to make each request,
// signs it, and sends it to backboard.railway.com. This file says which queries to make and how to read the answers.

// The shapes AstroAI hands in and expects back (AstroAI's own types: src/plugins/integration-sdk.ts).
interface Ctx {
    simulate: boolean
    http: { read<T = unknown>(path: string, body?: unknown): Promise<T> }
}
interface Source { id: string; scope: Record<string, unknown> }
type DeployStage = 'live' | 'building' | 'deploying' | 'queued' | 'failed' | 'crashed' | 'sleeping' | 'removed' | 'unknown'
interface Service {
    id: string; project: string; name: string; environment: string
    status: { name: string; stage: DeployStage }
    deployed_at: string | null; url: string | null; note: string | null; branch: string | null
}

// ---------- Railway's shapes (only what is read) ----------

interface GqlResponse<T> { data?: T; errors?: Array<{ message?: string }> }
interface RawDeployment { id: string; status: string; createdAt?: string | null; updatedAt?: string | null; meta?: Record<string, unknown> | null }
interface RawInstance { environmentId: string; latestDeployment?: RawDeployment | null }
interface RawProject {
    id: string
    name: string
    environments?: { edges: Array<{ node: { id: string; name: string } }> }
    services?: { edges: Array<{ node: { id: string; name: string; serviceInstances?: { edges: Array<{ node: RawInstance }> } } }> }
}

/** Railway's deployment statuses, as a stage. Anything new it adds reads as unknown, not as an error. */
export function stageOf(status: string | null | undefined): DeployStage {
    switch ((status ?? '').toUpperCase()) {
        case 'SUCCESS': return 'live'
        case 'BUILDING': case 'INITIALIZING': return 'building'
        case 'DEPLOYING': return 'deploying'
        case 'QUEUED': case 'WAITING': case 'NEEDS_APPROVAL': return 'queued'
        case 'FAILED': return 'failed'
        case 'CRASHED': return 'crashed'
        case 'SLEEPING': return 'sleeping'
        case 'REMOVED': case 'REMOVING': case 'SKIPPED': return 'removed'
        default: return 'unknown'
    }
}

const text = (value: unknown, max = 200): string | null => (typeof value === 'string' && value.trim() ? value.trim().split('\n')[0]!.slice(0, max) : null)

/** One project as the services every hosting integration gives (a row per service per environment). */
export function projectToServices(raw: RawProject, environment = ''): Service[] {
    const environments = new Map((raw.environments?.edges ?? []).map((edge) => [edge.node.id, edge.node.name]))
    const wanted = environment.trim().toLowerCase()
    const found: Service[] = []
    for (const { node: service } of raw.services?.edges ?? []) {
        for (const { node: instance } of service.serviceInstances?.edges ?? []) {
            const name = environments.get(instance.environmentId) ?? instance.environmentId
            if (wanted && name.toLowerCase() !== wanted) continue
            const deployment = instance.latestDeployment
            found.push({
                id: service.id,
                project: raw.name,
                name: service.name,
                environment: name,
                status: deployment ? { name: deployment.status.toLowerCase(), stage: stageOf(deployment.status) } : { name: 'no deployments', stage: 'unknown' },
                deployed_at: deployment?.createdAt ?? null,
                url: `https://railway.com/project/${raw.id}/service/${service.id}?environmentId=${instance.environmentId}`,
                note: text(deployment?.meta?.commitMessage),
                branch: text(deployment?.meta?.branch, 80),
            })
        }
    }
    return found
}

/** One query. Railway answers 200 with `errors` for most problems (a bad token among them), so those are read here. The endpoint is the base URL itself (no path). */
async function query<T>(ctx: Ctx, text: string, variables: Record<string, unknown> = {}): Promise<T> {
    const body = await ctx.http.read<GqlResponse<T>>('', { query: text, variables })
    if (body?.errors?.length) {
        const said = body.errors.map((error) => error.message ?? '').filter(Boolean).join('; ').slice(0, 200)
        throw new Error(/not authori[sz]ed|unauthenticated|invalid.*token/i.test(said) ? 'Railway refused the token (it is wrong, revoked, or a project token: use an account or workspace token)' : `Railway: ${said || 'the query failed'}`)
    }
    if (!body?.data) throw new Error('Railway sent nothing back')
    return body.data
}

const PROJECT_QUERY = `query ($id: String!) {
  project(id: $id) {
    id
    name
    environments { edges { node { id name } } }
    services { edges { node { id name serviceInstances { edges { node { environmentId latestDeployment { id status createdAt meta } } } } } } }
  }
}`

const projectIdOf = (source: Source): string => {
    const id = String(source.scope.project_id ?? '')
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new Error(`Source ${source.id} has no valid Railway project id`)
    return id
}

// ---------- what AstroAI calls ----------

export async function hostingServices(ctx: Ctx, source: Source) {
    if (ctx.simulate) {
        const environment = String(source.scope.environment ?? '')
        return { project: SIMULATED.name, services: projectToServices(simulatedProject(), environment) }
    }
    const data = await query<{ project: RawProject | null }>(ctx, PROJECT_QUERY, { id: projectIdOf(source) })
    if (!data.project) throw new Error(`Railway has no project ${projectIdOf(source)} this token can see`)
    return { project: data.project.name, services: projectToServices(data.project, String(source.scope.environment ?? '')) }
}

export async function test(ctx: Ctx) {
    if (ctx.simulate) return { ok: true, detail: 'Simulated: signed in as riley' }
    try {
        // An account token can say who it is; a workspace token can't (it has no user), but can list projects.
        try {
            const data = await query<{ me: { name?: string | null; email?: string | null } }>(ctx, 'query { me { name email } }')
            return { ok: true, detail: `Signed in as ${data.me.name || data.me.email || 'you'}` }
        } catch (error) {
            if (/couldn't be reached|no token saved/i.test((error as Error).message)) throw error
        }
        await query(ctx, 'query { projects(first: 1) { edges { node { id } } } }')
        return { ok: true, detail: 'Signed in with a workspace token' }
    } catch (error) {
        return { ok: false, detail: (error as Error).message }
    }
}

export async function discover(ctx: Ctx, kind: string, queryText = '') {
    if (kind !== 'project') return []
    if (ctx.simulate) return [{ value: SIMULATED.id, label: SIMULATED.name, name: SIMULATED.name }]
    const data = await query<{ projects: { edges: Array<{ node: { id: string; name: string } }> } }>(ctx, 'query { projects { edges { node { id name } } } }')
    const needle = queryText.trim().toLowerCase()
    return data.projects.edges
        .map((edge) => edge.node)
        .filter((project) => !needle || project.name.toLowerCase().includes(needle) || project.id.includes(needle))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((project) => ({ value: project.id, label: project.name, name: project.name }))
}

// ---------- simulate: an invented project, so it can be seen with no account ----------

const SIMULATED = { id: 'f3a1c2d4-5b6e-4f70-8a91-0123456789ab', name: 'acme-platform' }
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

function simulatedProject(): RawProject {
    const instance = (environmentId: string, status: string, minutes: number, commitMessage?: string, branch = 'main'): { node: RawInstance } => ({
        node: { environmentId, latestDeployment: { id: `dep-${status}-${minutes}`, status, createdAt: ago(minutes), meta: commitMessage ? { commitMessage, branch } : {} } },
    })
    return {
        id: SIMULATED.id,
        name: SIMULATED.name,
        environments: { edges: [{ node: { id: 'env-prod', name: 'production' } }, { node: { id: 'env-stage', name: 'staging' } }] },
        services: {
            edges: [
                { node: { id: 'svc-web', name: 'web', serviceInstances: { edges: [instance('env-prod', 'SUCCESS', 95, 'Fix timezone on weekly digest'), instance('env-stage', 'SUCCESS', 20, 'Try the new digest layout', 'digest-layout')] } } },
                { node: { id: 'svc-api', name: 'api', serviceInstances: { edges: [instance('env-prod', 'FAILED', 12, 'Export audit log as CSV'), instance('env-stage', 'DEPLOYING', 2, 'Export audit log as CSV', 'audit-csv')] } } },
                { node: { id: 'svc-worker', name: 'worker', serviceInstances: { edges: [instance('env-prod', 'CRASHED', 40, 'Retry failed webhooks')] } } },
                { node: { id: 'svc-db', name: 'postgres', serviceInstances: { edges: [{ node: { environmentId: 'env-prod', latestDeployment: { id: 'dep-db', status: 'SUCCESS', createdAt: ago(60 * 24 * 9), meta: {} } } }] } } },
            ],
        },
    }
}
