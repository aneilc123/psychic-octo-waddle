import { useEffect, useState } from 'react'
import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { vaultApi } from '../../lib/vault-client'

type PublicProfile = {
  facts: Array<{ id: string; key: string; category: string; value: string }>
  gatedLabels: Array<{ id: string; key: string; category: string }>
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<PublicProfile>({ facts: [], gatedLabels: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void vaultApi<PublicProfile>('/api/profile')
      .then(setProfile)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Profile is unavailable.'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-full bg-[radial-gradient(ellipse_at_top,_rgba(129,140,248,0.12),_transparent_44%)] px-4 py-10 text-foreground sm:px-8">
      <main className="mx-auto max-w-5xl">
        <header className="mb-9 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[.16em] text-primary">A shareable introduction</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Public profile</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Only details marked public are shown here. Private facts remain behind owner approval.</p>
          </div>
          <Link to="/home" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Chat or request access <ArrowRight size={15} /></Link>
        </header>

        {error ? <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : loading ? (
          <div className="rounded-2xl border border-border bg-card/60 px-6 py-14 text-center text-sm text-muted-foreground">Loading public profile…</div>
        ) : profile.facts.length === 0 && profile.gatedLabels.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card/60 px-6 py-14 text-center"><p className="font-medium">Nothing has been shared yet</p><p className="mt-2 text-sm text-muted-foreground">The profile owner can add details in their vault.</p></div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {profile.facts.map((fact, index) => <article key={fact.id} className="rounded-2xl border border-border bg-card/70 p-5 shadow-[0_12px_42px_rgba(0,0,0,.12)]">
                <div className="mb-4 flex items-center justify-between"><span className="text-[11px] font-medium uppercase tracking-[.12em] text-muted-foreground">{fact.category}</span><span className="text-xs text-primary">{String(index + 1).padStart(2, '0')}</span></div>
                <h2 className="text-lg font-semibold">{fact.key}</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{fact.value}</p>
              </article>)}
            </div>
            {profile.gatedLabels.length > 0 && <section className="mt-8 rounded-2xl border border-border bg-card/60 p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><LockKeyhole size={16} /></div><div><h2 className="font-semibold">More, by request</h2><p className="mt-1 text-xs text-muted-foreground">These labels reveal no private values.</p></div></div>
              <div className="flex flex-wrap gap-2">{profile.gatedLabels.map((fact) => <span key={fact.id} className="rounded-full border border-border bg-background/50 px-3 py-1.5 text-xs text-muted-foreground">{fact.key} <span className="ml-1 text-muted-foreground/60">· {fact.category}</span></span>)}</div>
            </section>}
            <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
              <div className="flex items-start gap-3"><div className="mt-0.5 text-primary"><Sparkles size={18} /></div><div><h2 className="text-sm font-semibold">Have a question?</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">The visitor assistant answers from public facts only. It cannot access private values.</p></div></div>
              <Link to="/home" className="rounded-lg border border-border bg-background/60 px-3.5 py-2 text-sm hover:bg-accent">Open assistant</Link>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
