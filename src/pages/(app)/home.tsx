import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { AuthOverlay, useAuth } from 'deepspace'
import { ArrowUpRight, Bell, Check, Clock3, Eye, LockKeyhole, Plus, Send, ShieldCheck, Sparkles, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatDate, vaultApi } from '../../lib/vault-client'

type Fact = {
  id: string
  key: string
  category: string
  value: string
  visibility: 'public' | 'gated'
  defaultGrantMinutes: number
  updatedAt: number
}
type Label = { id: string; key: string; category: string }
type Profile = { facts: Array<Pick<Fact, 'id' | 'key' | 'category' | 'value'>>; gatedLabels: Label[] }
type Me = { userId: string; name: string; email: string; isOwner: boolean }
type RequestRow = {
  id: string
  visitorName?: string
  visitorEmail?: string
  visitorId?: string
  factIds: string[]
  reason?: string
  status: string
  createdAt: number
  grantId?: string
}
type Grant = {
  id: string
  visitorId?: string
  factIds: string[]
  expiresAt: number
  oneView: boolean
  consumedAt: number
  revokedAt: number
}
type Notice = { id: string; title: string; message: string; href: string; readAt: number; createdAt: number }
type AuditEvent = { id: string; actorId: string; action: string; factId: string; requestId: string; grantId: string; createdAt: number }
type Draft = Omit<Fact, 'id' | 'updatedAt'>

const emptyDraft: Draft = {
  key: '',
  category: 'Profile',
  value: '',
  visibility: 'public',
  defaultGrantMinutes: 1440,
}

const tabs = [
  { id: 'facts', label: 'Facts' },
  { id: 'requests', label: 'Requests' },
  { id: 'grants', label: 'Access' },
  { id: 'audit', label: 'Activity' },
] as const
type OwnerTab = (typeof tabs)[number]['id']

export default function HomePage() {
  const { isLoaded, isSignedIn } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const [profile, setProfile] = useState<Profile>({ facts: [], gatedLabels: [] })
  const [facts, setFacts] = useState<Fact[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [grants, setGrants] = useState<Grant[]>([])
  const [notifications, setNotifications] = useState<Notice[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [tab, setTab] = useState<OwnerTab>('facts')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedFactIds, setSelectedFactIds] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [authOpen, setAuthOpen] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const publicProfile = await vaultApi<Profile>('/api/profile')
      setProfile(publicProfile)
      if (!isSignedIn) {
        setMe(null)
        setLoading(false)
        return
      }
      const identity = await vaultApi<Me>('/api/me')
      setMe(identity)
      const [noticeResult] = await Promise.all([
        vaultApi<{ notifications: Notice[] }>('/api/notifications'),
      ])
      setNotifications(noticeResult.notifications)
      if (identity.isOwner) {
        const [factResult, requestResult, grantResult, auditResult] = await Promise.all([
          vaultApi<{ facts: Fact[] }>('/api/facts'),
          vaultApi<{ requests: RequestRow[] }>('/api/requests'),
          vaultApi<{ grants: Grant[] }>('/api/grants'),
          vaultApi<{ events: AuditEvent[] }>('/api/audit'),
        ])
        setFacts(factResult.facts)
        setRequests(requestResult.requests)
        setGrants(grantResult.grants)
        setAuditEvents(auditResult.events)
      } else {
        setFacts([])
        const [requestResult, grantResult] = await Promise.all([
          vaultApi<{ requests: RequestRow[] }>('/api/my/requests'),
          vaultApi<{ grants: Grant[] }>('/api/my/grants'),
        ])
        setRequests(requestResult.requests)
        setGrants(grantResult.grants)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load vault data.')
    } finally {
      setLoading(false)
    }
  }, [isSignedIn])

  useEffect(() => {
    if (isLoaded) void loadData()
  }, [isLoaded, loadData])

  const factNames = useMemo(() => new Map(facts.map((fact) => [fact.id, fact.key])), [facts])

  async function saveFact(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const payload = {
        ...draft,
        defaultGrantMinutes: Number(draft.defaultGrantMinutes),
      }
      if (editingId) {
        await vaultApi(`/api/facts/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
        setSuccess('Fact updated.')
      } else {
        await vaultApi('/api/facts', { method: 'POST', body: JSON.stringify(payload) })
        setSuccess('Fact added to your vault.')
      }
      setDraft(emptyDraft)
      setEditingId(null)
      await loadData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save fact.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteFact(fact: Fact) {
    if (!window.confirm(`Delete “${fact.key}”? This cannot be undone.`)) return
    try {
      await vaultApi(`/api/facts/${fact.id}`, { method: 'DELETE' })
      setSuccess('Fact deleted.')
      await loadData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete fact.')
    }
  }

  async function decideRequest(requestId: string, duration?: '15m' | '24h' | 'one-view' | 'default') {
    try {
      const endpoint = duration
        ? `/api/requests/${requestId}/approve`
        : `/api/requests/${requestId}/deny`
      await vaultApi(endpoint, {
        method: 'POST',
        body: JSON.stringify(duration ? { duration } : {}),
      })
      setSuccess(duration ? 'Access approved and notification sent.' : 'Request declined.')
      await loadData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update request.')
    }
  }

  async function revokeGrant(grantId: string) {
    try {
      await vaultApi(`/api/grants/${grantId}/revoke`, { method: 'POST' })
      setSuccess('Grant revoked.')
      await loadData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not revoke access.')
    }
  }

  async function submitRequest(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await vaultApi('/api/requests', {
        method: 'POST',
        body: JSON.stringify({ factIds: selectedFactIds, reason }),
      })
      setSelectedFactIds([])
      setReason('')
      setSuccess('Request sent. You will be notified here if it is approved.')
      await loadData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit request.')
    } finally {
      setBusy(false)
    }
  }

  async function markRead(notice: Notice) {
    if (notice.readAt) return
    try {
      await vaultApi(`/api/notifications/${notice.id}/read`, { method: 'POST' })
      setNotifications((current) => current.map((item) => item.id === notice.id ? { ...item, readAt: Date.now() } : item))
    } catch {
      // The next refresh will restore the server's notification state.
    }
  }

  function editFact(fact: Fact) {
    setEditingId(fact.id)
    setDraft({
      key: fact.key,
      category: fact.category,
      value: fact.value,
      visibility: fact.visibility,
      defaultGrantMinutes: fact.defaultGrantMinutes,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const unreadCount = notifications.filter((notice) => !notice.readAt).length

  if (!isLoaded || loading) {
    return <div className="mx-auto max-w-6xl px-6 py-24 text-center text-sm text-muted-foreground">Opening your context space…</div>
  }

  return (
    <div className="min-h-full bg-[radial-gradient(ellipse_at_top,_rgba(129,140,248,0.12),_transparent_44%)] px-4 py-8 text-foreground sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-9 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              PRIVATE BY DESIGN
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {me?.isOwner ? 'Your context vault' : 'A thoughtful introduction'}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {me?.isOwner
                ? 'Keep your profile in one place. You decide what is public and who can temporarily view the rest.'
                : 'Explore public profile details and ask for limited access to anything marked private.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/profile" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/70 px-3.5 py-2 text-sm hover:bg-accent">
              View public profile <ArrowUpRight size={15} />
            </Link>
            {isSignedIn && (
              <button onClick={loadData} className="rounded-lg border border-border bg-card/70 px-3.5 py-2 text-sm hover:bg-accent">
                Refresh
              </button>
            )}
          </div>
        </header>

        {error && <NoticeBanner tone="error" onDismiss={() => setError('')}>{error}</NoticeBanner>}
        {success && <NoticeBanner tone="success" onDismiss={() => setSuccess('')}>{success}</NoticeBanner>}

        {!isSignedIn ? (
          <section className="grid gap-8 lg:grid-cols-[1.05fr_.95fr]">
            <PublicPreview profile={profile} />
            <SignInCard onSignIn={() => setAuthOpen(true)} />
          </section>
        ) : me?.isOwner ? (
          <>
            <div className="mb-6 grid gap-3 sm:grid-cols-3">
              <StatCard label="Vault facts" value={facts.length} detail="public and gated" icon={<LockKeyhole size={17} />} />
              <StatCard label="Waiting for you" value={requests.filter((request) => request.status === 'pending').length} detail="access requests" icon={<Bell size={17} />} />
              <StatCard label="Active grants" value={grants.filter((grant) => !grant.revokedAt && Number(grant.expiresAt) > Date.now() && !(grant.oneView && grant.consumedAt)).length} detail="time-limited access" icon={<ShieldCheck size={17} />} />
            </div>
            <section className="overflow-hidden rounded-2xl border border-border bg-card/75 shadow-[0_16px_60px_rgba(0,0,0,.18)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <p className="text-sm font-semibold">Owner workspace</p>
                  <p className="mt-1 text-xs text-muted-foreground">Signed in as {me.name || me.email}</p>
                </div>
                <div className="flex gap-1 rounded-xl border border-border bg-background/70 p-1">
                  {tabs.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setTab(item.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${tab === item.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {item.label}{item.id === 'requests' && requests.some((request) => request.status === 'pending') ? ' ·' : ''}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-5 sm:p-7">
                {tab === 'facts' && (
                  <div className="grid gap-8 xl:grid-cols-[.84fr_1.16fr]">
                    <form onSubmit={saveFact} className="space-y-4 rounded-xl border border-border bg-background/45 p-4 sm:p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="font-semibold">{editingId ? 'Edit fact' : 'Add a fact'}</h2>
                          <p className="mt-1 text-xs text-muted-foreground">Set its visibility before saving.</p>
                        </div>
                        {editingId && <button type="button" onClick={() => { setEditingId(null); setDraft(emptyDraft) }} aria-label="Cancel edit" className="rounded p-1 text-muted-foreground hover:text-foreground"><X size={16} /></button>}
                      </div>
                      <Field label="Fact name"><input required maxLength={100} value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} placeholder="e.g. Current focus" className={inputClass} /></Field>
                      <Field label="Category"><input required maxLength={80} value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder="Work, interests, preferences…" className={inputClass} /></Field>
                      <Field label="Information"><textarea required maxLength={8000} rows={4} value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} placeholder="Write the detail you want to share." className={`${inputClass} resize-y`} /></Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Visibility">
                          <select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as Draft['visibility'] })} className={inputClass}>
                            <option value="public">Public profile</option>
                            <option value="gated">Owner approval required</option>
                          </select>
                        </Field>
                        <Field label="Default grant (minutes)">
                          <input type="number" min={15} max={43200} step={15} value={draft.defaultGrantMinutes} onChange={(event) => setDraft({ ...draft, defaultGrantMinutes: Number(event.target.value) })} className={inputClass} />
                        </Field>
                      </div>
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                        <LockKeyhole size={15} className="shrink-0 text-primary" />
                        Gated values are not sent to visitor chats. Approved access is account-bound and expires or can be revoked.
                      </div>
                      <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
                        {editingId ? <Check size={16} /> : <Plus size={16} />} {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add to vault'}
                      </button>
                    </form>

                    <div className="space-y-3">
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="font-semibold">Your facts <span className="ml-1 text-xs font-normal text-muted-foreground">({facts.length})</span></h2>
                        <span className="text-xs text-muted-foreground">Private values shown only to you</span>
                      </div>
                      {facts.length === 0 ? <EmptyState title="A clear page" detail="Add your first profile fact to begin." /> : facts.map((fact) => (
                        <article key={fact.id} className="rounded-xl border border-border bg-background/40 p-4 transition hover:border-primary/30">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold">{fact.key}</span>
                                <VisibilityBadge visibility={fact.visibility} />
                                <span className="text-xs text-muted-foreground">{fact.category}</span>
                              </div>
                              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{fact.value}</p>
                              {fact.visibility === 'gated' && <p className="mt-2 text-[11px] text-muted-foreground">Default duration · {formatDuration(fact.defaultGrantMinutes)}</p>}
                            </div>
                            <div className="flex shrink-0 gap-1">
                              <button onClick={() => editFact(fact)} className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent">Edit</button>
                              <button onClick={() => void deleteFact(fact)} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10">Delete</button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                )}
                {tab === 'requests' && (
                  <div className="space-y-3">
                    <div className="mb-4"><h2 className="font-semibold">Access requests</h2><p className="mt-1 text-xs text-muted-foreground">Approve only the specific facts requested. Each grant is limited and can be revoked.</p></div>
                    {requests.length === 0 ? <EmptyState title="No requests yet" detail="New requests from signed-in visitors will appear here." /> : requests.map((request) => (
                      <article key={request.id} className="rounded-xl border border-border bg-background/40 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{request.visitorName || 'Visitor'}</h3><span className="text-xs text-muted-foreground">{request.visitorEmail}</span><StatusBadge status={request.status} /></div>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">{request.reason}</p>
                            <p className="mt-2 text-xs text-muted-foreground">Requested: {request.factIds.map((id) => factNames.get(id) ?? 'Removed fact').join(', ')} · {formatDate(request.createdAt)}</p>
                          </div>
                          {request.status === 'pending' && (
                            <button onClick={() => void decideRequest(request.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Decline</button>
                          )}
                        </div>
                        {request.status === 'pending' && (
                          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                            <span className="mr-1 text-xs text-muted-foreground">Approve for</span>
                            <button onClick={() => void decideRequest(request.id, 'default')} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">Fact defaults</button>
                            <button onClick={() => void decideRequest(request.id, '15m')} className="rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25">15 minutes</button>
                            <button onClick={() => void decideRequest(request.id, '24h')} className="rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25">24 hours</button>
                            <button onClick={() => void decideRequest(request.id, 'one-view')} className="rounded-lg border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10">One view</button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                {tab === 'grants' && (
                  <div className="space-y-3">
                    <div className="mb-4"><h2 className="font-semibold">Granted access</h2><p className="mt-1 text-xs text-muted-foreground">Every read checks the visitor account, fact scope, expiry and revocation state on the server.</p></div>
                    {grants.length === 0 ? <EmptyState title="No grants" detail="Approved visitor access will be listed here." /> : grants.map((grant) => {
                      const expired = Number(grant.expiresAt) <= Date.now()
                      const consumed = Boolean(grant.oneView && grant.consumedAt)
                      const revoked = Boolean(grant.revokedAt)
                      return <article key={grant.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-background/40 p-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{grant.factIds.map((id) => factNames.get(id) ?? 'Removed fact').join(', ')}</span><StatusBadge status={revoked ? 'revoked' : consumed ? 'viewed' : expired ? 'expired' : 'active'} /></div>
                          <p className="mt-1 text-xs text-muted-foreground">Visitor account {grant.visitorId?.slice(0, 10)}… · expires {formatDate(grant.expiresAt)}{grant.oneView ? ' · one view' : ''}</p>
                        </div>
                        {!revoked && !expired && !consumed && <button onClick={() => void revokeGrant(grant.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Revoke</button>}
                      </article>
                    })}
                  </div>
                )}
                {tab === 'audit' && (
                  <div>
                    <div className="mb-4"><h2 className="font-semibold">Vault activity</h2><p className="mt-1 text-xs text-muted-foreground">Sensitive fact values are not copied into the audit trail.</p></div>
                    {auditEvents.length === 0 ? <EmptyState title="Nothing to report" detail="Requests, decisions, fact edits and access reads will appear here." /> : <div className="divide-y divide-border rounded-xl border border-border bg-background/35">
                      {auditEvents.map((event) => <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Clock3 size={15} /></span><div><p className="text-sm font-medium">{event.action.replaceAll('.', ' ')}</p><p className="text-xs text-muted-foreground">{event.factId ? `Fact ${event.factId.slice(0, 10)}…` : event.requestId ? `Request ${event.requestId.slice(0, 10)}…` : event.grantId ? `Grant ${event.grantId.slice(0, 10)}…` : 'Vault event'}</p></div></div>
                        <time className="text-xs text-muted-foreground">{formatDate(event.createdAt)}</time>
                      </div>)}
                    </div>}
                  </div>
                )}
              </div>
            </section>
            <Notifications notices={notifications} unread={unreadCount} onRead={markRead} />
          </>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
            <section className="space-y-5">
              <PublicPreview profile={profile} />
              <form onSubmit={submitRequest} className="rounded-2xl border border-border bg-card/75 p-5 shadow-[0_16px_60px_rgba(0,0,0,.16)] sm:p-6">
                <div className="mb-4 flex items-start gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><LockKeyhole size={17} /></div>
                  <div><h2 className="font-semibold">Request private details</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Your signed-in account is attached to the request. Approval creates a scoped link that only you can open.</p></div>
                </div>
                {profile.gatedLabels.length === 0 ? <p className="rounded-lg border border-border bg-background/50 p-3 text-sm text-muted-foreground">There are no gated facts to request right now.</p> : (
                  <div className="mb-4 space-y-2">
                    {profile.gatedLabels.map((label) => <label key={label.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background/45 px-3 py-2.5 text-sm hover:border-primary/40">
                      <input type="checkbox" checked={selectedFactIds.includes(label.id)} onChange={(event) => setSelectedFactIds((current) => event.target.checked ? [...current, label.id] : current.filter((id) => id !== label.id))} className="accent-primary" />
                      <span className="flex-1">{label.key}</span><span className="text-xs text-muted-foreground">{label.category}</span>
                    </label>)}
                  </div>
                )}
                <textarea required minLength={8} maxLength={1000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why would access be useful?" className={`${inputClass} resize-y`} />
                <button disabled={busy || selectedFactIds.length === 0} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-45">
                  <Send size={15} /> Send access request
                </button>
              </form>
              <VisitorRequests requests={requests} grants={grants} />
              <Notifications notices={notifications} unread={unreadCount} onRead={markRead} />
            </section>

            <section className="flex min-h-[360px] flex-col justify-center rounded-2xl border border-border bg-card/75 p-6 shadow-[0_16px_60px_rgba(0,0,0,.18)] sm:p-8">
              <div className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-primary/15 text-primary"><Sparkles size={19} /></div>
              <h2 className="text-xl font-semibold">Chat with the profile assistant</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Ask questions about public profile details in a dedicated conversation. Gated values stay out of visitor chat context.</p>
              <Link to="/chat" className="mt-6 inline-flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Open assistant <ArrowUpRight size={15} /></Link>
            </section>
          </div>
        )}
      </div>
      {authOpen && <AuthOverlay onClose={() => setAuthOpen(false)} />}
    </div>
  )
}

const inputClass = 'w-full rounded-lg border border-border bg-background/80 px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/10'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>
}

function NoticeBanner({ children, tone, onDismiss }: { children: ReactNode; tone: 'error' | 'success'; onDismiss: () => void }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`mb-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${tone === 'error' ? 'border-destructive/25 bg-destructive/10 text-destructive' : 'border-success/25 bg-success/10 text-success'}`}>
    <span>{children}</span><button aria-label="Dismiss" onClick={onDismiss}><X size={15} /></button>
  </div>
}

function StatCard({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: ReactNode }) {
  return <div className="flex items-center gap-3 rounded-xl border border-border bg-card/65 px-4 py-3.5">
    <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</div>
    <div className="min-w-0"><p className="text-xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label} <span className="text-muted-foreground/70">· {detail}</span></p></div>
  </div>
}

function PublicPreview({ profile }: { profile: Profile }) {
  return <section className="rounded-2xl border border-border bg-card/75 p-5 shadow-[0_16px_60px_rgba(0,0,0,.14)] sm:p-6">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div><p className="text-xs font-medium uppercase tracking-[.15em] text-primary">Shared profile</p><h2 className="mt-1 text-lg font-semibold">A little context</h2></div>
      <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[10px] text-muted-foreground"><Eye size={12} className="mr-1 inline" /> PUBLIC VIEW</span>
    </div>
    {profile.facts.length === 0 ? <p className="text-sm text-muted-foreground">No public facts have been shared yet.</p> : <div className="grid gap-2 sm:grid-cols-2">
      {profile.facts.map((fact) => <article key={fact.id} className="rounded-xl border border-border bg-background/40 p-3.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{fact.category}</p><h3 className="mt-1 text-sm font-semibold">{fact.key}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-muted-foreground">{fact.value}</p>
      </article>)}
    </div>}
    {profile.gatedLabels.length > 0 && <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Available by request</p>
      <div className="flex flex-wrap gap-2">{profile.gatedLabels.map((fact) => <span key={fact.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground"><LockKeyhole size={11} />{fact.key}</span>)}</div>
    </div>}
  </section>
}

function SignInCard({ onSignIn }: { onSignIn: () => void }) {
  return <section className="flex flex-col justify-center rounded-2xl border border-border bg-card/75 p-7 sm:p-9">
    <div className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-primary/12 text-primary"><ShieldCheck size={20} /></div>
    <h2 className="text-xl font-semibold">A verified account keeps access personal.</h2>
    <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">Sign in to chat with the public profile, request specific private facts, and receive owner-approved access links. Private values stay outside the visitor assistant.</p>
    <button onClick={onSignIn} className="mt-6 inline-flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Sign in securely <ArrowUpRight size={15} /></button>
    <p className="mt-4 text-[11px] text-muted-foreground">Authentication is managed by DeepSpace. No password is stored by this app.</p>
  </section>
}

function Notifications({ notices, unread, onRead }: { notices: Notice[]; unread: number; onRead: (notice: Notice) => void }) {
  if (notices.length === 0) return null
  return <section className="mt-6 rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
    <div className="mb-3 flex items-center gap-2"><Bell size={15} className="text-primary" /><h2 className="text-sm font-semibold">Notifications</h2>{unread > 0 && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">{unread} new</span>}</div>
    <div className="space-y-2">{notices.slice(0, 6).map((notice) => <article key={notice.id} onMouseEnter={() => void onRead(notice)} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${notice.readAt ? 'border-border bg-background/30' : 'border-primary/20 bg-primary/5'}`}>
      <div className="min-w-0"><p className="text-sm font-medium">{notice.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{notice.message}</p><p className="mt-1 text-[10px] text-muted-foreground">{formatDate(notice.createdAt)}</p></div>
      {notice.href && <Link onClick={() => onRead(notice)} to={notice.href} className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Open <ArrowUpRight size={12} className="ml-1 inline" /></Link>}
    </article>)}</div>
  </section>
}

function VisitorRequests({ requests, grants }: { requests: RequestRow[]; grants: Grant[] }) {
  if (!requests.length && !grants.length) return null
  return <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
    <h2 className="mb-3 text-sm font-semibold">Your requests</h2>
    <div className="space-y-2">
      {requests.map((request) => <div key={request.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/35 px-3 py-2.5">
        <div><p className="text-sm font-medium">{request.factIds.length} requested fact{request.factIds.length === 1 ? '' : 's'}</p><p className="text-xs text-muted-foreground">{formatDate(request.createdAt)}</p></div><StatusBadge status={request.status} />
      </div>)}
      {grants.map((grant) => {
        const available = !grant.revokedAt && !(grant.oneView && grant.consumedAt) && Number(grant.expiresAt) > Date.now()
        return <div key={grant.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/35 px-3 py-2.5">
          <div><p className="text-sm font-medium">{grant.factIds.length} granted fact{grant.factIds.length === 1 ? '' : 's'}</p><p className="text-xs text-muted-foreground">Expires {formatDate(grant.expiresAt)}{grant.oneView ? ' · one view' : ''}</p></div>
          <div className="flex items-center gap-2">{available && <Link to={`/access/${grant.id}`} className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent">Open</Link>}<StatusBadge status={grant.revokedAt ? 'revoked' : grant.oneView && grant.consumedAt ? 'viewed' : Number(grant.expiresAt) <= Date.now() ? 'expired' : 'active'} /></div>
        </div>
      })}
    </div>
  </section>
}

function VisibilityBadge({ visibility }: { visibility: Fact['visibility'] }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${visibility === 'public' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{visibility === 'public' ? 'Public' : 'Gated'}</span>
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'approved' || status === 'active' ? 'bg-success/10 text-success' : status === 'pending' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium capitalize ${color}`}>{status}</span>
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-xl border border-dashed border-border px-5 py-9 text-center"><div className="mx-auto mb-2 grid h-9 w-9 place-items-center rounded-xl bg-muted text-muted-foreground"><Eye size={15} /></div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>
}

function formatDuration(minutes: number): string {
  return minutes >= 1440 ? `${Math.floor(minutes / 1440)} day${minutes >= 2880 ? 's' : ''}` : `${minutes} minutes`
}
