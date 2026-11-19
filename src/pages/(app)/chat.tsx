import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AuthOverlay, useAuth } from 'deepspace'
import { ArrowLeft, RotateCcw, Send, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { vaultApi } from '../../lib/vault-client'

type ChatMessage = { role: 'assistant' | 'user'; content: string }
type Identity = { isOwner: boolean }

const greeting: ChatMessage = {
  role: 'assistant',
  content: 'Hi! Ask me about the profile. I can discuss public details, but gated values are never included in visitor chat.',
}

export default function ChatPage() {
  const { isLoaded, isSignedIn } = useAuth()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([greeting])
  const [draft, setDraft] = useState('')
  const [loadingIdentity, setLoadingIdentity] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      setIdentity(null)
      setLoadingIdentity(false)
      return
    }

    let active = true
    setLoadingIdentity(true)
    void vaultApi<Identity>('/api/me')
      .then((result) => {
        if (active) setIdentity(result)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load your account.')
      })
      .finally(() => {
        if (active) setLoadingIdentity(false)
      })
    return () => {
      active = false
    }
  }, [isLoaded, isSignedIn])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || sending || !isSignedIn) return

    const fullConversation = [...messages, { role: 'user' as const, content }]
    let totalCharacters = 0
    const conversation: ChatMessage[] = []
    for (const message of fullConversation.slice(-16).reverse()) {
      if (totalCharacters + message.content.length > 20_000) break
      conversation.unshift(message)
      totalCharacters += message.content.length
    }

    setMessages(conversation)
    setDraft('')
    setSending(true)
    setError('')
    try {
      const result = await vaultApi<{ content: string }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: conversation }),
      })
      setMessages((current) => [...current, { role: 'assistant', content: result.content }])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The assistant could not respond.')
    } finally {
      setSending(false)
    }
  }

  function startNewChat() {
    setMessages([greeting])
    setError('')
  }

  return (
    <div className="flex min-h-full flex-col bg-[radial-gradient(ellipse_at_top,_rgba(129,140,248,0.12),_transparent_44%)] px-4 py-6 text-foreground sm:px-8">
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card/75 shadow-[0_16px_60px_rgba(0,0,0,.18)]">
        <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-4 sm:px-6">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary"><Sparkles size={18} /></div>
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold">Vault assistant</h1>
            <p className="text-xs text-muted-foreground">
              {identity?.isOwner ? 'Owner mode · Your vault facts' : 'Visitor mode · Public profile only'}
            </p>
          </div>
          <button type="button" onClick={startNewChat} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent">
            <RotateCcw size={14} /> New chat
          </button>
          <Link to="/profile" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent">
            <ArrowLeft size={14} /> Profile
          </Link>
        </header>

        <section aria-label="Conversation" aria-live="polite" className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {messages.map((message, index) => (
            <div key={`${index}-${message.role}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <p className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border border-border bg-background/70 text-foreground'}`}>
                {message.content}
              </p>
            </div>
          ))}
          {sending && <p role="status" className="text-sm text-muted-foreground">Thinking…</p>}
          <div ref={bottomRef} />
        </section>

        {error && <p role="alert" className="mx-4 mb-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-6">{error}</p>}

        {!isLoaded || loadingIdentity ? (
          <p className="border-t border-border p-4 text-center text-sm text-muted-foreground">Checking your sign-in…</p>
        ) : !isSignedIn ? (
          <div className="border-t border-border p-4 text-center sm:p-6">
            <p className="text-sm text-muted-foreground">Sign in to chat with the assistant.</p>
            <button type="button" onClick={() => setAuthOpen(true)} className="mt-3 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
              Sign in to start chatting
            </button>
          </div>
        ) : (
          <form onSubmit={sendMessage} className="border-t border-border p-4 sm:p-5">
            <div className="flex items-end gap-2 rounded-xl border border-border bg-background/80 p-1.5 focus-within:border-primary/50">
              <textarea
                aria-label="Message the assistant"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                maxLength={10_000}
                rows={1}
                placeholder={identity?.isOwner ? 'Ask about or update your vault…' : 'Ask about the public profile…'}
                className="max-h-40 min-h-10 min-w-0 flex-1 resize-y bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button type="submit" disabled={sending || !draft.trim()} aria-label="Send message" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-45">
                <Send size={15} />
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] leading-4 text-muted-foreground">
              {identity?.isOwner
                ? 'Owner requests are checked and validated on the server.'
                : 'Gated fact values are not provided to the visitor assistant.'}
              {' '}AI responses can still be mistaken.
            </p>
          </form>
        )}
      </main>
      {authOpen && <AuthOverlay onClose={() => setAuthOpen(false)} title="Sign in to chat" description="Your conversation stays on this assistant page after sign-in." />}
    </div>
  )
}
