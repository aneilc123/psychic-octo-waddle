import { describe, expect, it } from 'vitest'
import { buildVisitorAgentContext } from './vault-context'

describe('visitor agent context', () => {
  it('projects gated facts to labels only and includes only public values', () => {
    const context = buildVisitorAgentContext([
      {
        recordId: 'public-id',
        data: {
          ownerId: 'owner',
          key: 'Favorite color',
          category: 'Profile',
          value: 'Blue',
          visibility: 'public',
          defaultGrantMinutes: 1440,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      {
        recordId: 'private-id',
        data: {
          ownerId: 'owner',
          key: 'Private note',
          category: 'Personal',
          value: 'NEVER_SEND_THIS_GATED_VALUE',
          visibility: 'gated',
          defaultGrantMinutes: 1440,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    ])

    expect(context.system).toContain('Blue')
    expect(context.system).toContain('Private note')
    expect(context.system).not.toContain('NEVER_SEND_THIS_GATED_VALUE')
    expect(context.gatedLabels).toEqual([{ id: 'private-id', key: 'Private note', category: 'Personal' }])
    expect(context.publicFacts).toEqual([{ id: 'public-id', key: 'Favorite color', category: 'Profile', value: 'Blue' }])
  })
})
