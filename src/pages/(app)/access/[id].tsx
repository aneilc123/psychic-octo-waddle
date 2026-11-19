import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Eye, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useAuth } from 'deepspace'
import { formatDate, vaultApi } from '../../../lib/vault-client'

type GrantedFact = { id: string; key: string; category: string; value: string }

export default function GrantedAccessPage() {
  const { id } = useParams()
  const { isLoaded, isSignedIn } = useAuth()
  const requested = useRef(false)
  const [facts, setFacts] = useState<GrantedFact[]>([])
  const [expiresAt, setExpiresAt] = useState(0)
  const [oneView, setOneView] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      setLoading(false)
      return
    }
    if (!id || requested.current) return
    requested.current = true
    void vaultApi<{ facts: GrantedFact[]; expiresAt: number; oneView: boolean }>(`/api/access/${encodeURIComponent(id)}`)
      .then((result) => {
        setFacts(result.facts)
        setExpiresAt(result.expiresAt)
        setOneView(result.oneView)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'This access link is unavailable.'))
      .finally(() => setLoading(false))
  }, [id, isLoaded, isSignedIn])

  return (
    <div className="min-h-full bg-[radial-gradient(ellipse_at_top,_rgba(129,140,248,0.12),_transparent_44%)] px-4 py-12 text-foreground sm:px-8">
      <main className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary"><LockKeyhole size={19} /></div>
          <div><p className="text-xs font-medium uppercase tracking-[.15em] text-primary">Limited access</p><h1 className="text-2xl font-semibold">Owner-approved details</h1></div>
        </div>
        <div className="rounded-2xl border border-border bg-card/80 p-5 shadow-[0_16px_60px_rgba(0,0,0,.18)] sm:p-8">
          {!isLoaded || loading ? <p className="py-10 text-center text-sm text-muted-foreground">Checking your account and grant…</p> : !isSignedIn ? (
            <div className="py-8 text-center"><p className="font-medium">Sign in with the account that received this link.</p><p className="mt-2 text-sm text-muted-foreground">Access links are bound to the approved visitor account.</p></div>
          ) : error ? (
            <div className="py-8 text-center"><div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-xl bg-muted text-muted-foreground"><ShieldCheck size={18} /></div><p className="font-medium">This grant is unavailable</p><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{error}</p></div>
          ) : (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                <div><p className="text-sm font-semibold">Granted information</p><p className="mt-1 text-xs text-muted-foreground">Scope and expiry are checked by the server on this read.</p></div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-[10px] font-medium text-success"><Eye size={12} /> {oneView ? 'ONE VIEW' : 'TIME LIMITED'}</span>
              </div>
              <div className="space-y-3">
                {facts.map((fact) => <article key={fact.id} className="rounded-xl border border-border bg-background/45 p-4">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{fact.category}</p><h2 className="mt-1 font-semibold">{fact.key}</h2><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">{fact.value}</p>
                </article>)}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/35 px-4 py-3 text-xs text-muted-foreground">
                <span>Expires {formatDate(expiresAt)}</span>
                <span>{oneView ? 'This one-view grant is consumed by this successful read.' : 'The owner may revoke this grant at any time.'}</span>
              </div>
              <p className="mt-4 text-[11px] leading-5 text-muted-foreground">Revocation and expiry block subsequent server access. They cannot remove information already copied, photographed, or otherwise captured.</p>
            </>
          )}
          <div className="mt-6 border-t border-border pt-4"><Link to="/home" className="text-sm font-medium text-primary hover:underline">Return to the vault</Link></div>
        </div>
      </main>
    </div>
  )
}
