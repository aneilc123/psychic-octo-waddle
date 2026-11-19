export interface Fact extends Record<string, unknown> {
  ownerId: string
  key: string
  category: string
  value: string
  visibility: 'public' | 'gated'
  defaultGrantMinutes: number
  createdAt: number
  updatedAt: number
}
