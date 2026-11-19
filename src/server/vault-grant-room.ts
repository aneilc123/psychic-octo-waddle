export interface GrantState {
  ownerId: string
  visitorId: string
  factIds: string[]
  expiresAt: number
  oneView: boolean
  consumedAt: number | null
  revokedAt: number | null
}

interface DecisionState {
  ownerId: string
  requestId: string
  decision: 'approved' | 'denied'
  grantId: string
}

/**
 * Serializes access to a grant. The storage transaction is the authority for
 * expiry, revocation, visitor scope, and one-view consumption; a second
 * request cannot successfully consume the same one-view grant.
 */
export class VaultGrantRoom {
  constructor(
    private readonly state: DurableObjectState,
    _env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }

    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    const operation = new URL(request.url).pathname
    const now = Date.now()

    if (operation === '/create') {
      const state = parseGrant(body)
      if (!state) return Response.json({ error: 'Invalid grant' }, { status: 400 })
      const created = await this.state.storage.transaction(async (txn) => {
        if (await txn.get<GrantState>('grant')) return false
        await txn.put('grant', state)
        return true
      })
      return Response.json(created ? { ok: true } : { error: 'Grant already exists' }, {
        status: created ? 201 : 409,
      })
    }

    if (operation === '/decide') {
      const ownerId = stringValue(body.ownerId)
      const requestId = stringValue(body.requestId)
      const grantId = typeof body.grantId === 'string' ? body.grantId : ''
      const decision = body.decision
      if (!ownerId || !requestId || (decision !== 'approved' && decision !== 'denied')) {
        return Response.json({ error: 'Invalid decision' }, { status: 400 })
      }
      const reserved = await this.state.storage.transaction(async (txn) => {
        if (await txn.get<DecisionState>('decision')) return false
        await txn.put('decision', { ownerId, requestId, decision, grantId } satisfies DecisionState)
        return true
      })
      return Response.json(reserved ? { ok: true } : { error: 'Request already decided' }, {
        status: reserved ? 201 : 409,
      })
    }

    if (operation === '/undecide') {
      const ownerId = stringValue(body.ownerId)
      const grantId = typeof body.grantId === 'string' ? body.grantId : ''
      const released = await this.state.storage.transaction(async (txn) => {
        const decision = await txn.get<DecisionState>('decision')
        if (!decision || decision.ownerId !== ownerId || decision.grantId !== grantId) return false
        await txn.delete('decision')
        return true
      })
      return Response.json({ ok: released }, { status: released ? 200 : 409 })
    }

    if (operation === '/revoke') {
      const ownerId = stringValue(body.ownerId)
      if (!ownerId) return Response.json({ error: 'Invalid owner' }, { status: 400 })
      const result = await this.state.storage.transaction(async (txn) => {
        const grant = await txn.get<GrantState>('grant')
        if (!grant) return 'missing'
        if (grant.ownerId !== ownerId) return 'forbidden'
        if (grant.revokedAt !== null) return 'revoked'
        await txn.put('grant', { ...grant, revokedAt: now })
        return 'ok'
      })
      if (result === 'missing') return Response.json({ error: 'Grant not found' }, { status: 404 })
      if (result === 'forbidden') return Response.json({ error: 'Forbidden' }, { status: 403 })
      return Response.json({ ok: true, alreadyRevoked: result === 'revoked' })
    }

    if (operation === '/claim') {
      const visitorId = stringValue(body.visitorId)
      if (!visitorId) return Response.json({ error: 'Invalid visitor' }, { status: 400 })
      const result = await this.state.storage.transaction(async (txn) => {
        const grant = await txn.get<GrantState>('grant')
        if (!grant) return { status: 404 as const }
        if (grant.visitorId !== visitorId) return { status: 403 as const }
        if (grant.revokedAt !== null) return { status: 410 as const }
        if (grant.expiresAt <= now) return { status: 410 as const }
        if (grant.oneView && grant.consumedAt !== null) return { status: 410 as const }
        if (grant.oneView) {
          await txn.put('grant', { ...grant, consumedAt: now })
        }
        return { status: 200 as const, grant, consumedAt: grant.oneView ? now : grant.consumedAt }
      })
      if (result.status !== 200) {
        return Response.json(
          { error: result.status === 403 ? 'Forbidden' : 'Grant unavailable' },
          { status: result.status },
        )
      }
      return Response.json({
        ok: true,
        grant: result.grant,
        consumedAt: result.consumedAt,
      })
    }

    return new Response('Not found', { status: 404 })
  }
}

function parseGrant(value: Record<string, unknown>): GrantState | null {
  const ownerId = stringValue(value.ownerId)
  const visitorId = stringValue(value.visitorId)
  const factIds = value.factIds
  const expiresAt = value.expiresAt
  if (
    !ownerId ||
    !visitorId ||
    !Array.isArray(factIds) ||
    factIds.length === 0 ||
    !factIds.every((id) => typeof id === 'string') ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt) ||
    typeof value.oneView !== 'boolean'
  ) {
    return null
  }
  return {
    ownerId,
    visitorId,
    factIds: [...new Set(factIds as string[])],
    expiresAt,
    oneView: value.oneView,
    consumedAt: null,
    revokedAt: null,
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
