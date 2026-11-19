import type { CollectionSchema } from 'deepspace/schema'

const ownerOnly = {
  viewer: { read: false, create: false, update: false, delete: false },
  member: { read: false, create: false, update: false, delete: false },
  // Browsers are read-only even for the owner. Mutations go through the
  // Worker's verified API routes and internal RecordRoom action tools.
  admin: { read: 'own', create: false, update: false, delete: false },
} as const

export const vaultFactsSchema: CollectionSchema = {
  name: 'vault_facts',
  columns: [
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'key', storage: 'text', interpretation: 'plain', required: true },
    { name: 'category', storage: 'text', interpretation: 'plain', required: true },
    { name: 'value', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'visibility',
      storage: 'text',
      interpretation: { kind: 'select', options: ['public', 'gated'] },
      required: true,
    },
    { name: 'defaultGrantMinutes', storage: 'number', interpretation: 'plain', required: true },
    { name: 'createdAt', storage: 'number', interpretation: 'plain', required: true },
    { name: 'updatedAt', storage: 'number', interpretation: 'plain', required: true },
  ],
  ownerField: 'ownerId',
  uniqueOn: ['ownerId', 'key'],
  permissions: ownerOnly,
}

export const accessRequestsSchema: CollectionSchema = {
  name: 'access_requests',
  columns: [
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'visitorId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'visitorName', storage: 'text', interpretation: 'plain', required: true },
    { name: 'visitorEmail', storage: 'text', interpretation: 'plain', required: true },
    { name: 'factIds', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'reason', storage: 'text', interpretation: 'plain', required: true },
    { name: 'status', storage: 'text', interpretation: 'plain', required: true },
    { name: 'createdAt', storage: 'number', interpretation: 'plain', required: true },
    { name: 'decidedAt', storage: 'number', interpretation: 'plain' },
    { name: 'grantId', storage: 'text', interpretation: 'plain' },
  ],
  ownerField: 'ownerId',
  permissions: ownerOnly,
}

export const accessGrantsSchema: CollectionSchema = {
  name: 'access_grants',
  columns: [
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'visitorId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'requestId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'factIds', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'expiresAt', storage: 'number', interpretation: 'plain', required: true },
    { name: 'oneView', storage: 'number', interpretation: 'plain', required: true },
    { name: 'consumedAt', storage: 'number', interpretation: 'plain' },
    { name: 'revokedAt', storage: 'number', interpretation: 'plain' },
    { name: 'expiredAt', storage: 'number', interpretation: 'plain' },
    { name: 'createdAt', storage: 'number', interpretation: 'plain', required: true },
  ],
  ownerField: 'ownerId',
  permissions: ownerOnly,
}

export const notificationsSchema: CollectionSchema = {
  name: 'vault_notifications',
  columns: [
    { name: 'recipientId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true },
    { name: 'message', storage: 'text', interpretation: 'plain', required: true },
    { name: 'href', storage: 'text', interpretation: 'plain' },
    { name: 'readAt', storage: 'number', interpretation: 'plain' },
    { name: 'createdAt', storage: 'number', interpretation: 'plain', required: true },
  ],
  ownerField: 'recipientId',
  permissions: ownerOnly,
}

export const auditEventsSchema: CollectionSchema = {
  name: 'vault_audit_events',
  columns: [
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'actorId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'action', storage: 'text', interpretation: 'plain', required: true },
    { name: 'factId', storage: 'text', interpretation: 'plain' },
    { name: 'requestId', storage: 'text', interpretation: 'plain' },
    { name: 'grantId', storage: 'text', interpretation: 'plain' },
    { name: 'createdAt', storage: 'number', interpretation: 'plain', required: true },
    { name: 'details', storage: 'text', interpretation: { kind: 'json' } },
  ],
  ownerField: 'ownerId',
  permissions: ownerOnly,
}
