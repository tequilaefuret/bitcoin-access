import React from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Check,
  Compass,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  MessageCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wallet,
} from 'lucide-react';
import DanausMark from '../layout/DanausMark';

const principles = [
  {
    icon: Fingerprint,
    title: 'Proof, not promises',
    text: 'Sign in with a wallet you control. Danaus builds your private, pseudonymous profile around that proof.',
  },
  {
    icon: Wallet,
    title: 'Your keys and stack stay yours',
    text: 'Danaus never asks for a deposit, a transaction, or access to your funds. Your keys stay yours. So does your bitcoins.',
  },
  {
    icon: Compass,
    title: 'Value with a purpose',
    text: 'Hold your Bitcoin reserve while unlocking shells to explore, publish, and create on Danaus.',
  },
];

const LandingPage = ({ onStart, onSignIn }) => (
  <div className="relative isolate min-h-screen overflow-hidden bg-[#07080c] text-white selection:bg-amber-300 selection:text-slate-950">
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute left-1/2 top-[-20rem] h-[48rem] w-[58rem] -translate-x-1/2 rounded-full bg-amber-500/20 blur-[130px]" />
      <div className="absolute right-[-16rem] top-[28rem] h-[34rem] w-[34rem] rounded-full bg-orange-600/10 blur-[120px]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:52px_52px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
    </div>

    <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
      <a href="#top" className="group flex items-center gap-2.5" aria-label="Danaus home">
        <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-amber-300 text-black shadow-[0_0_32px_rgba(252,211,77,0.28)]">
          <DanausMark className="h-6 w-6 transition-transform duration-500 group-hover:-translate-y-0.5" />
        </span>
        <span className="text-xl font-black tracking-[-0.07em]">danaus</span>
      </a>

      <nav className="hidden items-center gap-7 text-sm font-medium text-white/55 md:flex" aria-label="Navigation principale">
        <a href="#how-it-works" className="transition hover:text-white">How it works</a>
        <a href="#mission" className="transition hover:text-white">Mission</a>
        <a href="#possibilities" className="transition hover:text-white">Possibilities</a>
        <a href="#new-to-bitcoin" className="transition hover:text-white">New to Bitcoin?</a>
      </nav>

      <div className="flex items-center gap-3">
        <button type="button" onClick={onStart} className="inline-flex items-center gap-2 rounded-full bg-amber-300 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-amber-200 hover:shadow-[0_0_28px_rgba(252,211,77,0.25)] sm:px-5">
          Open Danaus <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </header>

    <main id="top">
      <section className="mx-auto max-w-7xl px-5 pb-16 pt-8 sm:px-8 sm:pb-20 sm:pt-12 lg:px-10 lg:pt-14">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mx-auto mt-5 max-w-4xl text-4xl font-black leading-[0.98] tracking-[-0.06em] text-white sm:text-6xl lg:text-7xl">
            Bitcoin opens the door.<br />
            <span className="text-amber-300">What happens next is yours.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/60 sm:text-lg">
            Danaus is a social space for sovereign bitcoin holders: share your ideas, exchange with peers, and put long-term value to good use.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button type="button" onClick={onStart} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-amber-300 px-6 py-3.5 text-base font-extrabold text-slate-950 transition hover:-translate-y-0.5 hover:bg-amber-200 hover:shadow-[0_10px_42px_rgba(252,211,77,0.24)] sm:w-auto">
              Open Danaus <ArrowRight className="h-4 w-4" />
            </button>
            <a href="#how-it-works" className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.035] px-6 py-3.5 text-base font-semibold text-white/85 transition hover:border-white/30 hover:bg-white/[0.07] sm:w-auto">
              How it works <ArrowDown className="h-4 w-4" />
            </a>
          </div>
        </div>

        <div className="relative mx-auto mt-12 max-w-5xl sm:mt-14">
          <div className="absolute -inset-8 -z-10 rounded-[3rem] bg-amber-400/20 blur-3xl" />
          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#11131a]/90 p-3 shadow-[0_32px_100px_-28px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:rounded-[2.4rem] sm:p-4">
            <div className="flex items-center justify-between rounded-[1.3rem] border border-white/[0.07] bg-white/[0.035] px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-300 text-black"><DanausMark className="h-5 w-5" /></span>
                <span className="text-sm font-bold tracking-tight">satseeker</span>
                <span className="hidden rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300 sm:block">VERIFIED</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-white/45"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Connected</div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1.06fr_0.94fr]">
              <div className="rounded-[1.4rem] border border-white/[0.07] bg-[#0b0d12] p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.19em] text-white/35">Your spending power</p>
                    <div className="mt-2 flex items-end gap-2"><span className="text-3xl font-black tracking-[-0.05em] sm:text-4xl">2 108</span><span className="mb-1 text-sm font-bold text-amber-300">shells</span></div>
                  </div>
                  <div className="rounded-xl border border-amber-200/15 bg-amber-300/10 p-2.5 text-amber-300"><Sparkles className="h-5 w-5" /></div>
                </div>
                <div className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                  <div className="flex items-center justify-between"><span className="text-xs font-bold text-white/75">Ownership proof</span><span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-300"><Check className="h-3.5 w-3.5" /> Verified</span></div>
                  <div className="mt-3 flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full w-[72%] rounded-full bg-gradient-to-r from-amber-400 to-orange-400" /></div><span className="text-[10px] font-semibold text-white/35">2108/2685</span></div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-lg bg-white/[0.055] px-2.5 py-1.5 text-[11px] font-semibold text-white/50">Explore</span>
                  <span className="rounded-lg bg-white/[0.055] px-2.5 py-1.5 text-[11px] font-semibold text-white/50">Publish</span>
                  <span className="rounded-lg bg-white/[0.055] px-2.5 py-1.5 text-[11px] font-semibold text-white/50">Create</span>
                </div>
              </div>

              <div className="rounded-[1.4rem] border border-white/[0.07] bg-[#0b0d12] p-5 sm:p-6">
                <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.19em] text-white/35">In your circle</p><h2 className="mt-1 text-base font-black">Conversations that matter</h2></div><button type="button" aria-label="Create a post" className="rounded-xl bg-white/10 p-2 text-white/70"><Plus className="h-4 w-4" /></button></div>
                <div className="mt-5 space-y-3">
                  <article className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3.5"><div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-fuchsia-300 to-violet-500 text-[9px] font-black text-slate-950">M</span><span className="text-xs font-bold">mira</span><span className="text-[10px] text-white/30">· 12 min</span></div><p className="mt-2 text-xs leading-5 text-white/60">The best coordination tool is still the one nobody controls.</p><div className="mt-2 flex gap-4 text-[10px] font-semibold text-white/35"><span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" /> 24</span><span>↗ 8</span></div></article>
                  <article className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3.5"><div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-amber-200 to-orange-500 text-[9px] font-black text-slate-950">S</span><span className="text-xs font-bold">satstacker</span><span className="text-[10px] text-white/30">· 38 min</span></div><p className="mt-2 text-xs leading-5 text-white/60">Which projects make the long term more useful?</p></article>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-4 text-center text-sm font-medium text-white/55">A Danaus experience preview.</p>
        </div>
      </section>

      <section id="principles" className="border-y border-white/[0.07] bg-white/[0.025]">
        <div className="mx-auto grid max-w-7xl divide-y divide-white/[0.07] px-5 sm:px-8 md:grid-cols-3 md:divide-x md:divide-y-0 lg:px-10">
          {principles.map(({ icon: Icon, title, text }) => (
            <article key={title} className="py-8 md:px-7 md:py-11 first:md:pl-0 last:md:pr-0">
              <Icon className="h-5 w-5 text-amber-300" />
              <h2 className="mt-5 text-lg font-black tracking-tight">{title}</h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-white/50">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="border-y border-white/[0.07] bg-[#0b0d12]">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10 lg:py-32">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-300">How does it work?</p>
            <h2 className="mt-4 text-4xl font-black leading-[0.98] tracking-[-0.055em] sm:text-5xl">Your bitcoin balance sets your starting power.</h2>
            <p className="mt-5 text-base leading-7 text-white/60">Danaus mirrors the bitcoin balance of the address you prove you control into an internal shell balance. Shells are used only inside Danaus; your bitcoin remains in your wallet.</p>
          </div>

          <figure className="mt-12 overflow-hidden rounded-[2rem] border border-white/[0.09] bg-[#080a0e] shadow-[0_24px_70px_-32px_rgba(0,0,0,0.9)]">
            <img
              src="/images/danaus-shells-flow.png"
              alt="Visual diagram: a secure wallet verifies ownership, a reservoir mirrors the balance as shells, then Danaus features use shells."
              className="block h-auto w-full"
            />
            <figcaption className="grid divide-y divide-white/[0.08] border-t border-white/[0.09] bg-white/[0.025] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <div className="px-5 py-5 sm:px-6"><span className="text-xs font-black tracking-[0.16em] text-amber-300">01 / PROVE</span><p className="mt-2 text-sm leading-6 text-white/65">Sign a login message with an address you control. No bitcoin moves.</p></div>
              <div className="px-5 py-5 sm:px-6"><span className="text-xs font-black tracking-[0.16em] text-amber-300">02 / MIRROR</span><p className="mt-2 text-sm leading-6 text-white/65">Danaus mirrors your verified balance as shells. A sync reflects bitcoin added or moved.</p></div>
              <div className="px-5 py-5 sm:px-6"><span className="text-xs font-black tracking-[0.16em] text-amber-300">03 / SPEND</span><p className="mt-2 text-sm leading-6 text-white/65">Reading, publishing, and creating spend shells, never on-chain bitcoin.</p></div>
            </figcaption>
          </figure>

          <p className="mt-5 text-center text-sm leading-6 text-white/70"><span className="font-bold text-white">Example:</span> 2,685 sats proved → 2,685 shells mirrored → 577 shells spent → <span className="font-bold text-amber-300">2,108 shells available.</span></p>
        </div>
      </section>

      <section id="mission" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10 lg:py-32">
        <div className="grid gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-20">
          <div className="lg:pt-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-300">Our mission</p>
            <h2 className="mt-4 text-4xl font-black leading-[0.98] tracking-[-0.055em] sm:text-5xl">Give Bitcoiners a place of their own.</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-6 sm:p-7">
              <UsersRound className="h-5 w-5 text-amber-300" />
              <h3 className="mt-8 text-lg font-black tracking-tight">A community built thanks to Bitcoin</h3>
              <p className="mt-3 text-sm leading-6 text-white/50">Being orange-pilled and sharing it around you can be tough. Danaus is being built to become the first 100% bitcoiner community: every user demonstrates Bitcoin ownership, creating a shared starting point for more meaningful exchanges.</p>
            </article>
            <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-6 sm:p-7">
              <KeyRound className="h-5 w-5 text-amber-300" />
              <h3 className="mt-8 text-lg font-black tracking-tight">Make sovereignty useful</h3>
              <p className="mt-3 text-sm leading-6 text-white/50">We promote self-custody and long-term accumulation: holding your own keys, building your stack, and finding practical reasons to keep going down the rabbit hole.</p>
            </article>
            <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-6 sm:p-7">
              <Compass className="h-5 w-5 text-amber-300" />
              <h3 className="mt-8 text-lg font-black tracking-tight">Keep the door open</h3>
              <p className="mt-3 text-sm leading-6 text-white/50">Bitcoiners can share what they know, while people who are new to Bitcoin can discover the tools and ideas at their own pace.</p>
            </article>
            <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-6 sm:p-7">
              <LockKeyhole className="h-5 w-5 text-amber-300" />
              <h3 className="mt-8 text-lg font-black tracking-tight">Privacy by default</h3>
              <p className="mt-3 text-sm leading-6 text-white/50">No names, email addresses, or phone numbers are required or stored. Your public presence is yours to shape, without giving up your identity.</p>
            </article>
          </div>
        </div>
      </section>

      <section id="possibilities" className="mx-auto grid max-w-7xl gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:px-10 lg:py-32">
        <div className="lg:pt-7">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-300">Beyond the feed</p>
          <h2 className="mt-4 text-4xl font-black leading-[0.98] tracking-[-0.055em] sm:text-5xl">Your reserve can become a place to express yourself, too.</h2>
          <p className="mt-6 max-w-md text-base leading-7 text-white/55">Danaus begins with thoughtful social exchange. Over time, its unique model will support new ways to contribute, learn, gather, and create.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[['01', 'Talk', 'Long or short ideas, away from the noise and closer to the people who matter.'], ['02', 'Discover', 'A circle of people to follow and subjects worth your attention.'], ['03', 'Contribute', 'Every interaction adds depth to the exchange and value to the network.'], ['04', 'Invent', 'New uses will come. They will belong to the people who make them useful.']].map(([number, title, text]) => (
            <article key={number} className="group rounded-3xl border border-white/10 bg-white/[0.035] p-6 transition duration-300 hover:-translate-y-1 hover:border-amber-200/30 hover:bg-amber-100/[0.06] sm:p-7">
              <div className="flex items-center justify-between text-xs font-black tracking-widest text-white/30"><span>{number}</span><ArrowUpRight className="h-4 w-4 opacity-0 transition group-hover:opacity-100" /></div>
              <h3 className="mt-12 text-xl font-black tracking-tight">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-white/50">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="new-to-bitcoin" className="border-y border-white/[0.07] bg-white/[0.025]">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10 lg:py-32">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-300">New to Bitcoin?</p>
            <h2 className="mt-4 text-4xl font-black leading-[0.98] tracking-[-0.055em] sm:text-5xl">Start from the beginning, don't rush it.</h2>
            <p className="mt-5 text-base leading-7 text-white/55">Take the time to understand what is Bitcoin before buying some, how self-custody works, and what responsibilities come with it. When you are ready, come back to Danaus to be a part of the community.</p>
          </div>
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              ['01', 'Learn the basics', 'Explore independent educational resources and decide whether Bitcoin makes sense for you. Be wary of promises of returns.'],
              ['02', 'Choose how to get bitcoin', 'If you decide to proceed, use a method available in your country that you understand. Start small, with money you can afford to lose.'],
              ['03', 'Move to self-custody, then sign in', 'Learn to secure a wallet you control. Once it holds bitcoin, sign a message to prove ownership and access Danaus.'],
            ].map(([number, title, text]) => (
              <li key={number} className="rounded-3xl border border-white/10 bg-[#0b0d12] p-6 sm:p-7">
                <span className="text-xs font-black tracking-widest text-amber-300">{number}</span>
                <h3 className="mt-10 text-xl font-black tracking-tight">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/50">{text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-white/35"><BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-white/45" /> Danaus does not offer trading services nor provide investment advice. DYOR.</p>
        </div>
      </section>

      <section id="access" className="mx-auto max-w-7xl px-5 pb-24 sm:px-8 lg:px-10 lg:pb-32">
        <div className="relative overflow-hidden rounded-[2rem] border border-amber-200/15 bg-gradient-to-br from-amber-300 via-amber-300 to-orange-400 px-6 py-12 text-slate-950 sm:px-12 sm:py-16">
          <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full border-[30px] border-white/20" />
          <div className="relative max-w-2xl">
            <ShieldCheck className="h-7 w-7" />
            <h2 className="mt-6 text-4xl font-black leading-[0.98] tracking-[-0.055em] sm:text-5xl">Prove those sats are yours. Nothing more.</h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-900/70">A wallet signature is all it takes to create your access. Danaus reflects your Bitcoin commitment in an internal spending balance, without moving a single satoshi.</p>
            <button type="button" onClick={onStart} className="mt-8 inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3.5 text-sm font-bold text-white transition hover:bg-slate-800">
              Open Danaus <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    </main>

    <footer className="border-t border-white/[0.07] px-5 py-7 sm:px-8 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 text-xs font-medium text-white/35 sm:flex-row sm:items-center">
        <span>© {new Date().getFullYear()} Danaus. Built for sovereign peers.</span>
        <span className="inline-flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5" /> Proof of ownership, private by design.</span>
      </div>
    </footer>
  </div>
);

const ArrowDown = ({ className }) => <ArrowRight className={`${className} rotate-90`} />;

export default LandingPage;
