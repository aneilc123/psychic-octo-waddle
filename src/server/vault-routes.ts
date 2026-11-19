import type { Context, Hono } from 'hono'
import { z } from 'zod/v4'
import type { ActionResult, VerifyResult } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker.js'
import type { GrantState } from './vault-grant-room.js'
import { buildVisitorAgentContext } from './vault-context.js'
import type { Fact } from './vault-types.js'

type ResolveAuth = (req: Request, env: Env) => Promise<VerifyResult | null>
type AppRecord<T> = { recordId: string; data: T }
type Mutation = { recordId: string }

class OpenRouterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenRouterError'
  }
}

const factInput = z.object({
  key: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(80),
  value: z.string().max(8000),
  visibility: z.enum(['public', 'gated']),
  defaultGrantMinutes: z.number().int().min(15).max(43_200),
}).strict()

const requestInput = z.object({
  factIds: z.array(z.string().min(1).max(100)).min(1).max(12),
  reason: z.string().trim().min(8).max(1000),
}).strict()

const approvalInput = z.object({
  duration: z.enum(['15m', '24h', 'one-view', 'default']),
}).strict()

const chatMessageInput = z.object({
  role: z.enum(['assistant', 'user']),
  content: z.string().trim().min(1).max(10_000),
}).strict()

const chatInput = z.object({
  content: z.string().trim().min(1).max(10_000).optional(),
  messages: z.array(chatMessageInput).min(1).max(16).optional(),
}).strict()
  .refine((value) => (!!value.content) !== (!!value.messages), 'Provide either content or messages.')
  .refine((value) => !value.messages || value.messages[value.messages.length - 1]?.role === 'user', 'The latest message must be from the user.')
  .refine((value) => !value.messages || value.messages.reduce((total, message) => total + message.content.length, 0) <= 20_000, 'Conversation is too long.')

const updateAgentInput = z.object({
  factId: z.string().min(1),
  key: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  value: z.string().max(8000).optional(),
  visibility: z.enum(['public', 'gated']).optional(),
  defaultGrantMinutes: z.number().int().min(15).max(43_200).optional(),
}).strict()

function recordStub(env: Env): DurableObjectStub {
  return env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
}

async function runRecordsTool<T>(
  env: Env,
  actorId: string,
  tool: string,
  params: Record<string, unknown>,
): Promise<T> {
  const response = await recordStub(env).fetch(
    new Request('https://internal/api/tools/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': actorId,
        'X-App-Action': 'true',
      },
      body: JSON.stringify({ tool, params }),
    }),
  )
  const result = (await response.json()) as ActionResult<T>
  if (!result.success) throw new Error(result.error)
  return result.data
}

async function query<T extends Record<string, unknown>>(
  env: Env,
  actorId: string,
  collection: string,
  where: Record<string, unknown>,
  limit = 500,
): Promise<AppRecord<T>[]> {
  const result = await runRecordsTool<{ records: AppRecord<T>[] }>(env, actorId, 'records.query', {
    collection,
    where,
    limit,
  })
  return result.records
}

async function getRecord<T extends Record<string, unknown>>(
  env: Env,
  actorId: string,
  collection: string,
  recordId: string,
): Promise<AppRecord<T> | null> {
  try {
    const result = await runRecordsTool<{ record: AppRecord<T> }>(env, actorId, 'records.get', {
      collection,
      recordId,
    })
    return result.record
  } catch {
    return null
  }
}

async function create<T extends Record<string, unknown>>(
  env: Env,
  actorId: string,
  collection: string,
  data: T,
  recordId?: string,
): Promise<string> {
  const result = await runRecordsTool<Mutation>(env, actorId, 'records.create', {
    collection,
    data,
    ...(recordId ? { recordId } : {}),
  })
  return result.recordId
}

async function update(
  env: Env,
  actorId: string,
  collection: string,
  recordId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await runRecordsTool<Mutation>(env, actorId, 'records.update', {
    collection,
    recordId,
    data,
  })
}

async function remove(env: Env, actorId: string, collection: string, recordId: string): Promise<void> {
  await runRecordsTool<Mutation>(env, actorId, 'records.delete', { collection, recordId })
}

async function audit(
  env: Env,
  ownerId: string,
  actorId: string,
  action: string,
  fields: { factId?: string; requestId?: string; grantId?: string; details?: Record<string, unknown> } = {},
): Promise<void> {
  await create(env, actorId, 'vault_audit_events', {
    ownerId,
    actorId,
    action,
    factId: fields.factId ?? '',
    requestId: fields.requestId ?? '',
    grantId: fields.grantId ?? '',
    createdAt: Date.now(),
    details: fields.details ?? {},
  })
}

async function recordExpiredGrants(
  env: Env,
  ownerId: string,
  grants: Array<AppRecord<Record<string, unknown>>>,
): Promise<void> {
  const now = Date.now()
  for (const grant of grants) {
    if (Number(grant.data.expiresAt) > now || Number(grant.data.expiredAt) > 0) continue
    await update(env, ownerId, 'access_grants', grant.recordId, { expiredAt: now })
    await audit(env, ownerId, 'system', 'grant.expired', { grantId: grant.recordId })
  }
}

async function notify(
  env: Env,
  actorId: string,
  recipientId: string,
  title: string,
  message: string,
  href = '',
): Promise<string> {
  return await create(env, actorId, 'vault_notifications', {
    recipientId,
    title,
    message,
    href,
    readAt: 0,
    createdAt: Date.now(),
  })
}

function ownerOnly<T extends Context<AppContext>>(
  c: T,
  auth: VerifyResult,
): boolean {
  return !!c.env.OWNER_USER_ID && auth.userId === c.env.OWNER_USER_ID
}

function requiredOwner<T extends Context<AppContext>>(c: T, auth: VerifyResult): Response | null {
  return ownerOnly(c, auth) ? null : c.json({ error: 'Owner access required' }, 403)
}

function jsonError(error: unknown): Response {
  // Internal SDK errors can include room details. Keep them out of responses
  // and logs; the worker's outer handler records the bounded exception.
  void error
  return Response.json({ error: 'The vault operation could not be completed' }, { status: 503 })
}

function getUserLabel(auth: VerifyResult): { name: string; email: string } {
  const email = typeof auth.claims.email === 'string' ? auth.claims.email.slice(0, 254) : ''
  const name = typeof auth.claims.name === 'string' ? auth.claims.name.slice(0, 120) : ''
  return { name: name || email.split('@')[0] || 'Visitor', email }
}

function grantStub(env: Env, grantId: string): DurableObjectStub {
  return env.VAULT_GRANTS.get(env.VAULT_GRANTS.idFromName(grantId))
}

async function callGrantRoom(
  env: Env,
  grantId: string,
  operation: 'create' | 'claim' | 'revoke' | 'decide' | 'undecide',
  body: Record<string, unknown>,
): Promise<{ ok?: boolean; grant?: GrantState; consumedAt?: number; alreadyRevoked?: boolean }> {
  const response = await grantStub(env, grantId).fetch(
    new Request(`https://vault-grant.internal/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string }
    throw Object.assign(new Error(error.error ?? 'Grant operation refused'), { status: response.status })
  }
  return (await response.json()) as {
    ok?: boolean
    grant?: GrantState
    consumedAt?: number
    alreadyRevoked?: boolean
  }
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

export function registerVaultRoutes(app: Hono<AppContext>, resolveAuth: ResolveAuth): void {
  const authenticate = async (c: Context<AppContext>) => resolveAuth(c.req.raw, c.env)

  app.get('/api/profile', async (c) => {
    try {
      const ownerId = c.env.OWNER_USER_ID
      if (!ownerId) return c.json({ facts: [], gatedLabels: [] })
      const rows = await query<Fact>(c.env, ownerId, 'vault_facts', { ownerId }, 500)
      const facts = rows
        .filter((row) => row.data.visibility === 'public')
        .map(({ recordId, data }) => ({
          id: recordId,
          key: data.key,
          category: data.category,
          value: data.value,
        }))
      const gatedLabels = rows
        .filter((row) => row.data.visibility === 'gated')
        .map(({ recordId, data }) => ({ id: recordId, key: data.key, category: data.category }))
      return c.json({ facts, gatedLabels })
    } catch (error) {
      return jsonError(error)
    }
  })

  app.get('/api/me', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    const label = getUserLabel(auth)
    return c.json({
      userId: auth.userId,
      name: label.name,
      email: label.email,
      isOwner: ownerOnly(c, auth),
    })
  })

  app.get('/api/facts', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    const denied = requiredOwner(c, auth)
    if (denied) return denied
    try {
      const rows = await query<Fact>(c.env, auth.userId, 'vault_facts', { ownerId: auth.userId })
      return c.json({ facts: rows.map(({ recordId, data }) => ({ id: recordId, ...data })) })
    } catch (error) {
      return jsonError(error)
    }
  })

  app.post('/api/facts', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    const denied = requiredOwner(c, auth)
    if (denied) return denied
    const parsed = factInput.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Invalid fact fields' }, 400)
    try {
      const duplicates = await query<Fact>(c.env, auth.userId, 'vault_facts', { ownerId: auth.userId })
      if (duplicates.some((row) => row.data.key.toLocaleLowerCase() === parsed.data.key.toLocaleLowerCase())) {
        return c.json({ error: 'A fact with this key already exists' }, 409)
      }
      const now = Date.now()
      const id = await create(c.env, auth.userId, 'vault_facts', {
        ownerId: auth.userId,
        ...parsed.data,
        createdAt: now,
        updatedAt: now,
      })
      await audit(c.env, auth.userId, auth.userId, 'fact.created', { factId: id })
      return c.json({ id }, 201)
    } catch (error) {
      return jsonError(error)
    }
  })

  app.put('/api/facts/:id', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    const denied = requiredOwner(c, auth)
    if (denied) return denied
    const parsed = factInput.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Invalid fact fields' }, 400)
    try {
      const id = c.req.param('id')
      const record = await getRecord<Fact>(c.env, auth.userId, 'vault_facts', id)
      if (!record || record.data.ownerId !== auth.userId) return c.notFound()
      const duplicates = await query<Fact>(c.env, auth.userId, 'vault_facts', { ownerId: auth.userId })
      if (duplicates.some((row) => row.recordId !== id && row.data.key.toLocaleLowerCase() === parsed.data.key.toLocaleLowerCase())) {
        return c.json({ error: 'A fact with this key already exists' }, 409)
      }
      await update(c.env, auth.userId, 'vault_facts', id, {
        ...parsed.data,
        updatedAt: Date.now(),
      })
      await audit(c.env, auth.userId, auth.userId, 'fact.updated', { factId: id })
      return c.json({ ok: true })
    } catch (error) {
      return jsonError(error)
    }
  })

  app.delete('/api/facts/:id', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    const denied = requiredOwner(c, auth)
    if (denied) return denied
    try {
      const id = c.req.param('id')
      const record = await getRecord<Fact>(c.env, auth.userId, 'vault_facts', id)
      if (!record || record.data.ownerId !== auth.userId) return c.notFound()
      await remove(c.env, auth.userId, 'vault_facts', id)
      await audit(c.env, auth.userId, auth.userId, 'fact.deleted', { factId: id })
      return c.json({ ok: true })
    } catch (error) {
      return jsonError(error)
    }
  })

  app.post('/api/requests', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    if (ownerOnly(c, auth)) return c.json({ error: 'The owner cannot request their own facts' }, 400)
    const parsed = requestInput.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Provide gated facts and a reason' }, 400)
    try {
      const ownerId = c.env.OWNER_USER_ID
      if (!ownerId) return c.json({ error: 'Vault owner is not configured' }, 503)
      const facts = await Promise.all(
        [...new Set(parsed.data.factIds)].map((id) =>
          getRecord<Fact>(c.env, ownerId, 'vault_facts', id),
        ),
      )
      if (
        facts.length !== new Set(parsed.data.factIds).size ||
        facts.some((row) => !row || row.data.ownerId !== ownerId || row.data.visibility !== 'gated')
      ) {
        return c.json({ error: 'One or more requested facts are unavailable' }, 400)
      }
      const identity = getUserLabel(auth)
      const now = Date.now()
      const id = await create(c.env, auth.userId, 'access_requests', {
        ownerId,
        visitorId: auth.userId,
        visitorName: identity.name,
        visitorEmail: identity.email,
        factIds: [...new Set(parsed.data.factIds)],
        reason: parsed.data.reason,
        status: 'pending',
        createdAt: now,
        decidedAt: 0,
        grantId: '',
      })
      await notify(c.env, auth.userId, ownerId, 'New access request', `${identity.name} requested gated profile information.`)
      await audit(c.env, ownerId, auth.userId, 'request.created', { requestId: id })
      return c.json({ id }, 201)
    } catch (error) {
      return jsonError(error)
    }
  })

  app.get('/api/requests', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    const denied = requiredOwner(c, auth)
    if (denied) return denied
    try {
      const rows = await query<Record<string, unknown>>(c.env, auth.userId, 'access_requests', { ownerId: auth.userId })
      return c.json({
        requests: rows
          .sort((a, b) => Number(b.data.createdAt) - Number(a.data.createdAt))
          .map(({ recordId, data }) => ({ id: recordId, ...data, factIds: parseJsonArray(data.factIds) })),
      })
    } catch (error) {
      return jsonError(error)
    }
  })

  app.get('/api/my/requests', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    try {
      const rows = await query<Record<string, unknown>>(c.env, auth.userId, 'access_requests', { visitorId: auth.userId })
      return c.json({
        requests: rows.map(({ recordId, data }) => ({
          id: recordId,
          status: data.status,
          createdAt: data.createdAt,
          factIds: parseJsonArray(data.factIds),
          reason: data.reason,
        })),
      })
    } catch (error) {
      return jsonError(error)
    }
  })

  app.post('/api/requests/:id/approve', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    const denied = requiredOwner(c, auth)
    if (denied) return denied
    const parsed = approvalInput.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Choose a supported grant duration' }, 400)
    try {
      const requestId = c.req.param('id')
      const request = await getRecord<Record<string, unknown>>(c.env, auth.userId, 'access_requests', requestId)
      if (!request || request.data.ownerId !== auth.userId) return c.notFound()
      if (request.data.status !== 'pending') return c.json({ error: 'Request is already decided' }, 409)
      const factIds = parseJsonArray(request.data.factIds)
      if (factIds.length === 0) return c.json({ error: 'Request scope is invalid' }, 409)
      const requestFacts = await Promise.all(
        factIds.map((id) => getRecord<Fact>(c.env, auth.userId, 'vault_facts', id)),
      )
      if (requestFacts.some((fact) => !fact || fact.data.ownerId !== auth.userId || fact.data.visibility !== 'gated')) {
        return c.json({ error: 'One or more requested facts are no longer available' }, 409)
      }
      const oneView = parsed.data.duration === 'one-view'
      let durationMinutes = parsed.data.duration === '15m' ? 15 : parsed.data.duration === '24h' || oneView ? 1440 : 0
      if (parsed.data.duration === 'default') {
        durationMinutes = Math.min(...requestFacts.map((fact) => fact!.data.defaultGrantMinutes))
      }
      const expiresAt = Date.now() + durationMinutes * 60_000
      const grantId = crypto.randomUUID()
      const visitorId = String(request.data.visitorId)
      const initialState: GrantState = {
        ownerId: auth.userId,
        visitorId,
        factIds,
        expiresAt,
        oneView,
        consumedAt: null,
        revokedAt: null,
      }
      const decisionRoomId = `request:${requestId}`
      let decisionReserved = false
      let requestCommitted = false
      try {
        await callGrantRoom(c.env, decisionRoomId, 'decide', {
          ownerId: auth.userId,
          requestId,
          decision: 'approved',
          grantId,
        })
        decisionReserved = true
        await callGrantRoom(c.env, grantId, 'create', initialState as unknown as Record<string, unknown>)
        await create(c.env, auth.userId, 'access_grants', {
          ownerId: auth.userId,
          visitorId,
          requestId,
          factIds,
          expiresAt,
          oneView: oneView ? 1 : 0,
          consumedAt: 0,
          revokedAt: 0,
          expiredAt: 0,
          createdAt: Date.now(),
        }, grantId)
        await update(c.env, auth.userId, 'access_requests', requestId, {
          status: 'approved',
          decidedAt: Date.now(),
          grantId,
        })
        requestCommitted = true
      } catch (error) {
        if (decisionReserved && !requestCommitted) {
          await callGrantRoom(c.env, grantId, 'revoke', { ownerId: auth.userId }).catch(() => undefined)
          await remove(c.env, auth.userId, 'access_grants', grantId).catch(() => undefined)
          await update(c.env, auth.userId, 'access_requests', requestId, {
            status: 'pending',
            decidedAt: 0,
            grantId: '',
          }).catch(() => undefined)
          await callGrantRoom(c.env, decisionRoomId, 'undecide', {
            ownerId: auth.userId,
            grantId,
          }).catch(() => undefined)
        }
        throw error
      }
      let notificationSent = true
      try {
        await notify(c.env, auth.userId, visitorId, 'Access approved', 'Your requested information is available for a limited time.', `/access/${grantId}`)
      } catch {
        notificationSent = false
      }
      let auditRecorded = true
      try {
        await audit(c.env, auth.userId, auth.userId, 'request.approved', { requestId, grantId })
      } catch {
        auditRecorded = false
      }
      return c.json({ ok: true, grantId, expiresAt, oneView, auditRecorded, notificationSent }, 201)
    } catch (error) {
      if ((error as { status?: number }).status === 409) {
        return c.json({ error: 'Request has already been decided' }, 409)
      }
      return jsonError(error)
    }
  })

  app.post('/api/requests/:id/deny', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    const denied = requiredOwner(c, auth)
    if (denied) return denied
    try {
      const requestId = c.req.param('id')
      const request = await getRecord<Record<string, unknown>>(c.env, auth.userId, 'access_requests', requestId)
      if (!request || request.data.ownerId !== auth.userId) return c.notFound()
      if (request.data.status !== 'pending') return c.json({ error: 'Request is already decided' }, 409)
      const decisionRoomId = `request:${requestId}`
      await callGrantRoom(c.env, decisionRoomId, 'decide', {
        ownerId: auth.userId,
        requestId,
        decision: 'denied',
        grantId: '',
      })
      let notificationId = ''
      try {
        notificationId = await notify(c.env, auth.userId, String(request.data.visitorId), 'Access request declined', 'The owner declined this request.')
        await update(c.env, auth.userId, 'access_requests', requestId, {
          status: 'denied',
          decidedAt: Date.now(),
        })
      } catch (error) {
        if (notificationId) await remove(c.env, auth.userId, 'vault_notifications', notificationId).catch(() => undefined)
        await callGrantRoom(c.env, decisionRoomId, 'undecide', {
          ownerId: auth.userId,
          grantId: '',
        }).catch(() => undefined)
        throw error
      }
      let auditRecorded = true
      try {
        await audit(c.env, auth.userId, auth.userId, 'request.denied', { requestId })
      } catch {
        auditRecorded = false
      }
      return c.json({ ok: true, auditRecorded })
    } catch (error) {
      if ((error as { status?: number }).status === 409) {
        return c.json({ error: 'Request has already been decided' }, 409)
      }
      return jsonError(error)
    }
  })

  app.get('/api/grants', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    const denied = requiredOwner(c, auth)
    if (denied) return denied
    try {
      const rows = await query<Record<string, unknown>>(c.env, auth.userId, 'access_grants', { ownerId: auth.userId })
      await recordExpiredGrants(c.env, auth.userId, rows)
      return c.json({
        grants: rows
          .sort((a, b) => Number(b.data.createdAt) - Number(a.data.createdAt))
          .map(({ recordId, data }) => ({ id: recordId, ...data, factIds: parseJsonArray(data.factIds) })),
      })
    } catch (error) {
      return jsonError(error)
    }
  })

  app.get('/api/my/grants', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    try {
      const rows = await query<Record<string, unknown>>(c.env, auth.userId, 'access_grants', { visitorId: auth.userId })
      await recordExpiredGrants(c.env, c.env.OWNER_USER_ID, rows)
      return c.json({
        grants: rows.map(({ recordId, data }) => ({
          id: recordId,
          expiresAt: data.expiresAt,
          oneView: Boolean(data.oneView),
          consumedAt: data.consumedAt,
          revokedAt: data.revokedAt,
          requestId: data.requestId,
          factIds: parseJsonArray(data.factIds),
        })),
      })
    } catch (error) {
      return jsonError(error)
    }
  })

  app.post('/api/grants/:id/revoke', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    const denied = requiredOwner(c, auth)
    if (denied) return denied
    try {
      const grantId = c.req.param('id')
      const grant = await getRecord<Record<string, unknown>>(c.env, auth.userId, 'access_grants', grantId)
      if (!grant || grant.data.ownerId !== auth.userId) return c.notFound()
      await callGrantRoom(c.env, grantId, 'revoke', { ownerId: auth.userId })
      await update(c.env, auth.userId, 'access_grants', grantId, { revokedAt: Date.now() })
      let auditRecorded = true
      let notificationSent = true
      try {
        await audit(c.env, auth.userId, auth.userId, 'grant.revoked', { requestId: String(grant.data.requestId), grantId })
      } catch {
        auditRecorded = false
      }
      try {
        await notify(c.env, auth.userId, String(grant.data.visitorId), 'Access revoked', 'The owner revoked this access grant.')
      } catch {
        notificationSent = false
      }
      return c.json({ ok: true, auditRecorded, notificationSent })
    } catch (error) {
      return jsonError(error)
    }
  })

  app.get('/api/access/:id', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    const grantId = c.req.param('id')
    try {
      const grantRecord = await getRecord<Record<string, unknown>>(c.env, c.env.OWNER_USER_ID, 'access_grants', grantId)
      if (!grantRecord || grantRecord.data.visitorId !== auth.userId) return c.notFound()
      const requestRecord = await getRecord<Record<string, unknown>>(
        c.env,
        c.env.OWNER_USER_ID,
        'access_requests',
        String(grantRecord.data.requestId),
      )
      if (!requestRecord || requestRecord.data.status !== 'approved') {
        return c.json({ error: 'Grant is not active' }, 410)
      }
      const ownerId = String(grantRecord.data.ownerId)
      const scopedFactIds = parseJsonArray(grantRecord.data.factIds)
      const rows = await Promise.all(
        scopedFactIds.map((id) => getRecord<Fact>(c.env, ownerId, 'vault_facts', id)),
      )
      if (scopedFactIds.length === 0 || rows.some((row) => !row || row.data.visibility !== 'gated' || row.data.ownerId !== ownerId)) {
        return c.json({ error: 'Granted information is no longer available' }, 410)
      }
      const claimed = await callGrantRoom(c.env, grantId, 'claim', { visitorId: auth.userId })
      const grant = claimed.grant
      if (!grant) return c.json({ error: 'Grant unavailable' }, 410)
      if (
        grant.ownerId !== ownerId ||
        grant.factIds.length !== scopedFactIds.length ||
        grant.factIds.some((id) => !scopedFactIds.includes(id))
      ) {
        return c.json({ error: 'Grant scope is invalid' }, 410)
      }
      const data = rows.map((row) => ({
        id: row!.recordId,
        key: row!.data.key,
        category: row!.data.category,
        value: row!.data.value,
      }))
      if (grant.oneView && claimed.consumedAt) {
        await update(c.env, grant.ownerId, 'access_grants', grantId, { consumedAt: claimed.consumedAt })
      }
      await audit(c.env, grant.ownerId, auth.userId, 'grant.read', { grantId })
      return c.json({ facts: data, expiresAt: grant.expiresAt, oneView: grant.oneView })
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status === 403) return c.json({ error: 'Forbidden' }, 403)
      if (status === 410) return c.json({ error: 'Grant expired, revoked, or already viewed' }, 410)
      return jsonError(error)
    }
  })

  app.get('/api/notifications', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    try {
      const rows = await query<Record<string, unknown>>(c.env, auth.userId, 'vault_notifications', { recipientId: auth.userId })
      return c.json({
        notifications: rows
          .sort((a, b) => Number(b.data.createdAt) - Number(a.data.createdAt))
          .map(({ recordId, data }) => ({ id: recordId, ...data })),
      })
    } catch (error) {
      return jsonError(error)
    }
  })

  app.post('/api/notifications/:id/read', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    try {
      const id = c.req.param('id')
      const notification = await getRecord<Record<string, unknown>>(c.env, auth.userId, 'vault_notifications', id)
      if (!notification || notification.data.recipientId !== auth.userId) return c.notFound()
      await update(c.env, auth.userId, 'vault_notifications', id, { readAt: Date.now() })
      return c.json({ ok: true })
    } catch (error) {
      return jsonError(error)
    }
  })

  app.get('/api/audit', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in required' }, 401)
    const denied = requiredOwner(c, auth)
    if (denied) return denied
    try {
      const rows = await query<Record<string, unknown>>(c.env, auth.userId, 'vault_audit_events', { ownerId: auth.userId }, 250)
      return c.json({
        events: rows
          .sort((a, b) => Number(b.data.createdAt) - Number(a.data.createdAt))
          .map(({ recordId, data }) => ({ id: recordId, ...data })),
      })
    } catch (error) {
      return jsonError(error)
    }
  })

  app.post('/api/chat', async (c) => {
    const auth = await authenticate(c)
    if (!auth) return c.json({ error: 'Sign in to chat' }, 401)
    if (!c.env.OPENROUTER_API_KEY) return c.json({ error: 'The owner has not configured the OpenRouter deployment secret yet.' }, 503)
    const parsed = chatInput.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Enter a message up to 10,000 characters.' }, 400)
    const isOwner = ownerOnly(c, auth)
    const ownerId = c.env.OWNER_USER_ID
    if (!ownerId) return c.json({ error: 'Vault owner is not configured' }, 503)
    try {
      const facts = await query<Fact>(c.env, ownerId, 'vault_facts', { ownerId }, 500)
      const visitorContext = buildVisitorAgentContext(facts)
      const ownerFacts = isOwner ? facts.map(({ recordId, data }) => ({ id: recordId, ...data })) : []
      const system = isOwner
        ? [
            'You are the owner-only assistant for a personal context vault.',
            'Use owner tools only for clear, validated fact operations. Never reveal secrets outside this authenticated owner session.',
            'For deletion, direct the owner to the explicit Delete control in the fact manager; you cannot delete facts.',
            `Vault facts for the owner: ${JSON.stringify(ownerFacts)}`,
          ].join('\n')
        : visitorContext.system
      const conversation = parsed.data.messages ?? [{ role: 'user' as const, content: parsed.data.content! }]
      const content = await askOpenRouter(c.env, auth, system, conversation, isOwner)
      return c.json({ content })
    } catch (error) {
      if (error instanceof OpenRouterError) return c.json({ error: error.message }, 502)
      return jsonError(error)
    }
  })
}

async function askOpenRouter(
  env: Env,
  auth: VerifyResult,
  system: string,
  conversation: Array<{ role: 'assistant' | 'user'; content: string }>,
  isOwner: boolean,
): Promise<string> {
  const model = env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free'
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: system },
    ...conversation,
  ]
  const tools = isOwner
    ? [
        {
          type: 'function',
          function: {
            name: 'create_fact',
            description: 'Create a new owner vault fact. Use only when the owner explicitly asks to save information.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['key', 'category', 'value', 'visibility'],
              properties: {
                key: { type: 'string' },
                category: { type: 'string' },
                value: { type: 'string' },
                visibility: { type: 'string', enum: ['public', 'gated'] },
                defaultGrantMinutes: { type: 'integer', minimum: 15, maximum: 43200 },
              },
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'update_fact',
            description: 'Edit an existing fact, only when the owner explicitly requests the change.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['factId'],
              properties: {
                factId: { type: 'string' },
                key: { type: 'string' },
                category: { type: 'string' },
                value: { type: 'string' },
                visibility: { type: 'string', enum: ['public', 'gated'] },
                defaultGrantMinutes: { type: 'integer', minimum: 15, maximum: 43200 },
              },
            },
          },
        },
      ]
    : undefined

  for (let turn = 0; turn < 4; turn += 1) {
    let response: Response
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'DeepSpace Context Vault',
      },
        body: JSON.stringify({
          model,
          messages,
          ...(tools ? { tools, tool_choice: 'auto' } : {}),
          temperature: 0.2,
        }),
      })
    } catch {
      throw new OpenRouterError('Could not reach OpenRouter. Please try again.')
    }
    if (!response.ok) {
      const detail = response.status === 401
        ? 'OpenRouter rejected the deployment API key.'
        : response.status === 404
          ? 'The configured OpenRouter model is unavailable.'
          : `OpenRouter could not complete the request (HTTP ${response.status}).`
      throw new OpenRouterError(detail)
    }
    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
        }
      }>
    }
    const message = payload.choices?.[0]?.message
    if (!message) throw new OpenRouterError('OpenRouter returned no assistant response.')
    const toolCalls = message.tool_calls ?? []
    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    })
    if (!toolCalls.length) return message.content ?? 'I could not produce a response.'

    for (const call of toolCalls) {
      const result = await runOwnerAgentTool(env, auth, call.function.name, call.function.arguments)
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  return 'I completed the allowed tool steps. Please check the facts panel for the latest values.'
}

async function runOwnerAgentTool(
  env: Env,
  auth: VerifyResult,
  name: string,
  rawArguments: string,
): Promise<Record<string, unknown>> {
  let args: unknown
  try {
    args = JSON.parse(rawArguments)
  } catch {
    return { error: 'Tool arguments were not valid JSON.' }
  }
  if (name === 'create_fact') {
    const parsed = factInput.safeParse({
      defaultGrantMinutes: 1440,
      ...(args as Record<string, unknown>),
    })
    if (!parsed.success) return { error: 'Fact input did not match the allowed schema.' }
    const existing = await query<Fact>(env, auth.userId, 'vault_facts', { ownerId: auth.userId })
    if (existing.some((row) => row.data.key.toLowerCase() === parsed.data.key.toLowerCase())) {
      return { error: 'A fact with this key already exists.' }
    }
    const now = Date.now()
    const id = await create(env, auth.userId, 'vault_facts', {
      ownerId: auth.userId,
      ...parsed.data,
      createdAt: now,
      updatedAt: now,
    })
    await audit(env, auth.userId, auth.userId, 'fact.created', { factId: id })
    return { ok: true, factId: id, key: parsed.data.key }
  }
  if (name === 'update_fact') {
    const parsed = updateAgentInput.safeParse(args)
    if (!parsed.success) return { error: 'Fact update did not match the allowed schema.' }
    const { factId, ...patch } = parsed.data
    if (Object.keys(patch).length === 0) return { error: 'No fact changes were supplied.' }
    const existing = await getRecord<Fact>(env, auth.userId, 'vault_facts', factId)
    if (!existing || existing.data.ownerId !== auth.userId) return { error: 'Fact not found.' }
    await update(env, auth.userId, 'vault_facts', factId, { ...patch, updatedAt: Date.now() })
    await audit(env, auth.userId, auth.userId, 'fact.updated', { factId })
    return { ok: true, factId, changed: Object.keys(patch) }
  }
  return { error: 'That tool is not available.' }
}
