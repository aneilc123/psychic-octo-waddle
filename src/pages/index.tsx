import { ArrowRight, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const principles = [
  { icon: <EyeIcon />, title: 'Share intentionally', detail: 'Keep a public profile separate from details that need your approval.' },
  { icon: <LockKeyhole size={17} />, title: 'Grant narrow access', detail: 'Choose the exact facts and a short duration—or allow one successful view.' },
  { icon: <ShieldCheck size={17} />, title: 'Stay in control', detail: 'Account-bound access is checked server-side and can be revoked.' },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <main className="relative flex min-h-screen flex-col overflow-hidden bg-background px-5 text-foreground sm:px-8">
        <div aria-hidden className="pointer-events-none absolute -top-56 left-1/2 h-[34rem] w-[48rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
        <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between border-b border-border/70 py-5">
          <Link to="/" className="flex items-center gap-2.5 text-sm font-semibold"><span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/15 text-primary"><LockKeyhole size={16} /></span>{APP_NAME}</Link>
          <Link to="/profile" className="text-sm text-muted-foreground transition hover:text-foreground">Public profile <ArrowRight size={14} className="ml-1 inline" /></Link>
        </header>
        <section className="relative mx-auto grid w-full max-w-6xl flex-1 items-center gap-14 py-16 lg:grid-cols-[1.05fr_.95fr] lg:py-24">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-[11px] font-medium tracking-wide text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />YOUR INFORMATION, ON YOUR TERMS</div>
            <h1 className="max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">Personal context.<br /><span className="text-primary">Shared with care.</span></h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">Build a profile that says what you want to share. Keep other facts gated until you approve a specific, time-limited request.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/home" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[0_8px_24px_rgba(129,140,248,.18)] transition hover:opacity-90">Open your vault <ArrowRight size={15} /></Link>
              <Link to="/profile" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/60 px-5 py-3 text-sm font-medium hover:bg-accent">View shared profile</Link>
            </div>
            <div className="mt-10 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck size={14} className="text-success" /> Authentication and storage are handled by DeepSpace.</div>
          </div>
          <div className="relative">
            <div className="rounded-2xl border border-border bg-card/80 p-5 shadow-[0_24px_90px_rgba(0,0,0,.24)] sm:p-7">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div><p className="text-[11px] font-medium uppercase tracking-[.15em] text-muted-foreground">YOUR VAULT</p><h2 className="mt-1 text-lg font-semibold">A simple way to share</h2></div>
                <span className="rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-[10px] font-medium text-success">OWNER CONTROLLED</span>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-4"><span className="grid h-9 w-9 place-items-center rounded-lg bg-success/10 text-success"><Sparkles size={16} /></span><div className="flex-1"><p className="text-sm font-medium">Public profile</p><p className="mt-1 text-xs text-muted-foreground">Visible to visitors</p></div><span className="rounded-full bg-success/10 px-2 py-1 text-[10px] text-success">SHARED</span></div>
                <div className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-4"><span className="grid h-9 w-9 place-items-center rounded-lg bg-warning/10 text-warning"><LockKeyhole size={16} /></span><div className="flex-1"><p className="text-sm font-medium">Private context</p><p className="mt-1 text-xs text-muted-foreground">Only shared after approval</p></div><span className="rounded-full bg-warning/10 px-2 py-1 text-[10px] text-warning">GATED</span></div>
              </div>
              <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-primary"><ShieldCheck size={14} /> A grant is limited and revocable</div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">The visitor assistant only receives public details. Approved facts are shown separately in an account-checked view.</p>
              </div>
            </div>
            <div className="absolute -bottom-5 -left-3 hidden rounded-xl border border-border bg-card px-4 py-3 shadow-lg sm:block"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">ACCESS HISTORY</p><p className="mt-1 text-sm font-medium">A clear record of decisions</p></div>
          </div>
        </section>
        <section className="relative mx-auto grid w-full max-w-6xl gap-3 border-t border-border/70 py-6 sm:grid-cols-3">
          {principles.map((item) => <article key={item.title} className="flex gap-3 rounded-xl px-2 py-3"><span className="mt-0.5 text-primary">{item.icon}</span><div><h2 className="text-sm font-semibold">{item.title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p></div></article>)}
        </section>
        <footer className="relative border-t border-border/70 py-4 text-center text-[11px] text-muted-foreground">A safer way to share personal context · Powered by DeepSpace</footer>
      </main>
    </>
  )
}

function EyeIcon() {
  return <LockKeyhole size={17} />
}
