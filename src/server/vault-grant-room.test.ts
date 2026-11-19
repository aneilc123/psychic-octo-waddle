import { describe, expect, it } from 'vitest'
import { VaultGrantRoom } from './vault-grant-room'

function makeRoom() {
  let stored: unknown
  let pending = Promise.resolve()
  const storage = {
    transaction: async <T>(run: (txn: { get: <V>(key: string) => Promise<V | undefined>; put: (key: string, value: unknown) => Promise<void> }) => Promise<T>) => {
      const current = pending.then(async () => {
        let next = structuredClone(stored)
        const txn = {
          get: async <V>(_key: string) => structuredClone(next) as V | undefined,
          put: async (_key: string, value: unknown) => { next = structuredClone(value) },
        }
        const result = await run(txn)
        stored = next
        return result
      })
      pending = current.then(() => undefined, () => undefined)
      return current
    },
  }
  const room = new VaultGrantRoom({ storage } as unknown as DurableObjectState, {})
  return {
    room,
    call: (path: string, body: Record<string, unknown>) =>
      room.fetch(new Request(`https://test/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })),
  }
}

describe('VaultGrantRoom', () => {
  it('atomically permits only one successful one-view claim', async () => {
    const { call } = makeRoom()
    const grant = {
      ownerId: 'owner-1',
      visitorId: 'visitor-1',
      factIds: ['fact-a', 'fact-b'],
      expiresAt: Date.now() + 60_000,
      oneView: true,
    }
    expect((await call('create', grant)).status).toBe(201)

    const claims = await Promise.all([
      call('claim', { visitorId: 'visitor-1' }),
      call('claim', { visitorId: 'visitor-1' }),
    ])
    expect(claims.map((response) => response.status).sort()).toEqual([200, 410])
    const successful = claims.find((response) => response.status === 200)!
    const payload = await successful.json() as { grant: { factIds: string[] }; consumedAt: number }
    expect(payload.grant.factIds).toEqual(['fact-a', 'fact-b'])
    expect(payload.consumedAt).toBeGreaterThan(0)
  })

  it('rejects another visitor and blocks access after owner revocation', async () => {
    const { call } = makeRoom()
    await call('create', {
      ownerId: 'owner-1',
      visitorId: 'visitor-1',
      factIds: ['fact-a'],
      expiresAt: Date.now() + 60_000,
      oneView: false,
    })
    expect((await call('claim', { visitorId: 'visitor-2' })).status).toBe(403)
    expect((await call('revoke', { ownerId: 'not-owner' })).status).toBe(403)
    expect((await call('revoke', { ownerId: 'owner-1' })).status).toBe(200)
    expect((await call('claim', { visitorId: 'visitor-1' })).status).toBe(410)
  })

  it('rejects expired grants', async () => {
    const { call } = makeRoom()
    await call('create', {
      ownerId: 'owner-1',
      visitorId: 'visitor-1',
      factIds: ['fact-a'],
      expiresAt: Date.now() - 1,
      oneView: false,
    })
    expect((await call('claim', { visitorId: 'visitor-1' })).status).toBe(410)
  })

  it('serializes competing decisions for one access request', async () => {
    const { call } = makeRoom()
    const decisions = await Promise.all([
      call('decide', { ownerId: 'owner-1', requestId: 'request-1', decision: 'approved', grantId: 'grant-1' }),
      call('decide', { ownerId: 'owner-1', requestId: 'request-1', decision: 'denied', grantId: '' }),
    ])
    expect(decisions.map((response) => response.status).sort()).toEqual([201, 409])
  })
})
