import { useEffect, useState } from 'react';
import { get, type Fund } from './api.js';
import { FundContext } from './fund-context.js';
import { Doodle } from './Doodle.js';
import { Helper } from './Helper.js';
import { Intro, shouldPlayIntro } from './Intro.js';
import { PrivacyButton, PrivacyPanel, WorkspaceSwitcher, EngineKeyBanner, StatusBadge } from './components.js';
import { Ontology } from './pages/Ontology.js';
import { Intake } from './pages/Intake.js';
import { Drafting } from './pages/Drafting.js';
import { Changes } from './pages/Changes.js';
import { Comments } from './pages/Comments.js';
import { SideLetters } from './pages/SideLetters.js';
import { Obligations } from './pages/Obligations.js';
import { Deadlines } from './pages/Deadlines.js';
import { Mfn } from './pages/Mfn.js';

// ordered as a fundraise actually runs: know your practice and your files,
// then raise (draft, negotiate, paper it), then live with what you promised
const NAV: { section: string; tabs: { key: string; label: string }[] }[] = [
  {
    section: 'Practice',
    tabs: [
      { key: 'ontology', label: 'Overview' },
      { key: 'intake', label: 'Documents' },
    ],
  },
  {
    section: 'Raise',
    tabs: [
      { key: 'drafting', label: 'Drafting' },
      { key: 'changes', label: 'Changes' },
      { key: 'comments', label: 'Comments' },
      { key: 'side-letters', label: 'Side Letters' },
    ],
  },
  {
    section: 'Obligations',
    tabs: [
      { key: 'obligations', label: 'Register' },
      { key: 'deadlines', label: 'Deadlines' },
      { key: 'mfn', label: 'MFN' },
    ],
  },
];

const TAB_TITLES: Record<string, string> = {
  ontology: 'Overview',
  intake: 'Documents',
  drafting: 'Drafting',
  changes: 'Changes',
  comments: 'Comments',
  'side-letters': 'Side Letters',
  obligations: 'Obligations Register',
  deadlines: 'Deadlines',
  mfn: 'MFN Compendium',
};

/** Minimal line icons, one per section family — currentColor inherits. */
function NavIcon({ tab }: { tab: string }) {
  const common = {
    className: 'nav-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (tab) {
    case 'ontology':
      return (
        <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
      );
    case 'intake':
      return (
        <svg {...common}><path d="M14 3v5h5" /><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /></svg>
      );
    case 'drafting':
      return (
        <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
      );
    case 'changes':
      return (
        <svg {...common}><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></svg>
      );
    case 'comments':
      return (
        <svg {...common}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-4.5A8.4 8.4 0 1 1 21 11.5z" /></svg>
      );
    case 'side-letters':
      return (
        <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
      );
    case 'obligations':
      return (
        <svg {...common}><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" /></svg>
      );
    case 'deadlines':
      return (
        <svg {...common}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
      );
    case 'mfn':
      return (
        <svg {...common}><path d="M3 6h18M3 12h18M3 18h12" /></svg>
      );
    default:
      return <svg {...common}><circle cx="12" cy="12" r="9" /></svg>;
  }
}

function Sidebar({ active, onSelect }: { active: string; onSelect: (key: string) => void }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-black/[0.07] bg-white">
      <div className="flex items-center gap-2 px-5 pb-5 pt-5">
        <span className="text-lg font-bold tracking-tight text-fog">YPOG</span>
        <span className="h-4 w-px bg-black/15" />
        <span className="text-lg font-bold tracking-tight text-bone">DraftBase</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Sections">
        {NAV.map((group) => (
          <div key={group.section} className="mb-1">
            <p className="nav-section">{group.section}</p>
            {group.tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => onSelect(t.key)}
                data-active={active === t.key}
                className="nav-item"
              >
                <NavIcon tab={t.key} />
                {t.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-black/[0.07] px-4 py-3">
        <StatusBadge />
      </div>
    </aside>
  );
}

export default function App() {
  const [tab, setTab] = useState<string>('ontology');
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [intro, setIntro] = useState(shouldPlayIntro);
  const [elevated, setElevated] = useState(false);

  // the one fund every page acts on, picked once in the top bar (or by
  // clicking a fund card on Overview)
  const [funds, setFunds] = useState<Fund[]>([]);
  const [fundId, setFundId] = useState('');
  const refreshFunds = async (): Promise<void> => {
    try {
      const all = await get<Fund[]>('/funds');
      setFunds(all);
      setFundId((cur) => (cur && all.some((f) => f.id === cur) ? cur : (all.find((f) => f.id === 'fund-3') ?? all[0])?.id ?? ''));
    } catch {
      /* server not up yet; the health banner covers it */
    }
  };
  useEffect(() => {
    void refreshFunds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onScroll = () => setElevated(window.scrollY > 6);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <FundContext.Provider value={{ fundId, setFundId, funds, refreshFunds }}>
    <div className="app-bg min-h-screen">
      {intro && <Intro onDone={() => setIntro(false)} />}
      <Sidebar active={tab} onSelect={setTab} />

      <div className="ml-60 flex min-h-screen flex-col">
        <header className={`glass hairline-b sticky top-0 z-10 transition-shadow duration-300 ${elevated ? 'header-elevated' : ''}`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-8 py-3">
            <h1 className="shrink-0 text-base font-semibold tracking-tight text-bone">{TAB_TITLES[tab]}</h1>
            <div className="ml-auto flex shrink-0 items-center gap-2.5">
              {funds.length > 0 && (
                <select
                  value={fundId}
                  onChange={(e) => setFundId(e.target.value)}
                  className="field max-w-72 py-2 text-[13px]"
                  title="The fund every page acts on. Pick it once; Drafting, Comments, Side Letters and the rest all follow."
                  aria-label="Active fund"
                >
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name.replace(', L.P.', '')}
                    </option>
                  ))}
                </select>
              )}
              <WorkspaceSwitcher />
              <PrivacyButton onClick={() => setPrivacyOpen(true)} />
            </div>
          </div>
        </header>
        <EngineKeyBanner />

        <main key={tab} className="animate-fade-up mx-auto w-full max-w-6xl flex-1 px-8 py-10">
          {tab === 'ontology' && <Ontology onNavigate={setTab} />}
          {tab === 'intake' && (
            <Intake
              onUseMatter={(id) => {
                setFundId(id);
                setTab('obligations');
              }}
            />
          )}
          {tab === 'drafting' && <Drafting />}
          {tab === 'changes' && <Changes />}
          {tab === 'comments' && <Comments />}
          {tab === 'side-letters' && <SideLetters />}
          {tab === 'obligations' && <Obligations />}
          {tab === 'deadlines' && <Deadlines />}
          {tab === 'mfn' && <Mfn />}
        </main>

        <footer className="mx-auto w-full max-w-6xl px-8 pb-10 pt-6 text-xs leading-relaxed text-fog/70">
          DraftBase, a fund formation engine. Fictional client: Vulcan Industrial Partners. Not legal advice; a homage built for fun.
        </footer>
      </div>

      <Helper onNavigate={setTab} />
      <Doodle />

      {privacyOpen && <PrivacyPanel onClose={() => setPrivacyOpen(false)} />}
    </div>
    </FundContext.Provider>
  );
}
