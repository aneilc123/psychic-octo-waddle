import type { Fact } from './vault-types.js'

type FactRecord = { recordId: string; data: Fact }

export function buildVisitorAgentContext(rows: FactRecord[]): {
  system: string
  publicFacts: Array<{ id: string; key: string; category: string; value: string }>
  gatedLabels: Array<{ id: string; key: string; category: string }>
} {
  const publicFacts = rows
    .filter(({ data }) => data.visibility === 'public')
    .map(({ recordId, data }) => ({
      id: recordId,
      key: data.key,
      category: data.category,
      value: data.value,
    }))
  const gatedLabels = rows
    .filter(({ data }) => data.visibility === 'gated')
    .map(({ recordId, data }) => ({
      id: recordId,
      key: data.key,
      category: data.category,
    }))

  return {
    publicFacts,
    gatedLabels,
    system: [
      'You are a public-profile assistant. You may discuss only the public facts below.',
      'Gated fact labels indicate that information exists; they are not permission to infer or disclose its value.',
      'Never claim to know a gated value. Suggest the signed-in visitor use the access request form.',
      `Public facts: ${JSON.stringify(publicFacts)}`,
      `Gated fact labels only: ${JSON.stringify(gatedLabels)}`,
    ].join('\n'),
  }
}
