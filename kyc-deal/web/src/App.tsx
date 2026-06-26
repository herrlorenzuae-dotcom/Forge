import { Fragment, useEffect, useLayoutEffect, useRef, useState, createContext, useContext } from 'react';
import { get, type Client } from './api.js';
import { PrivacyButton, PrivacyPanel, StatusBadge } from './components.js';
import { Structure } from './pages/Structure.js';
import { Sources } from './pages/Sources.js';
import { Questionnaires } from './pages/Questionnaires.js';
import { Brain } from './pages/Brain.js';

const TABS = [
  { key: 'structure', label: 'Structure' },
  { key: 'sources', label: 'Sources' },
  { key: 'questionnaires', label: 'Questionnaires' },
  { key: 'brain', label: 'KYC Brain' },
] as const;

interface ClientCtx {
  clientId: string;
  clients: Client[];
}
export const ClientContext = createContext<ClientCtx>({ clientId: '', clients: [] });
export const useClient = () => useContext(ClientContext);

function SegmentedNav({ active, onSelect }: { active: string; onSelect: (key: string) => void }) {
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const trackRef = useRef<HTMLElement | null>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  const measure = () => {
    const el = btnRefs.current[active];
    if (el && el.offsetWidth > 0) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  };
  useLayoutEffect(() => {
    measure();
    const id = window.setTimeout(measure, 30);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => window.removeEventListener('resize', measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className="relative mx-auto w-max min-w-0 max-w-full">
      <nav ref={(el) => { trackRef.current = el; }} className="seg-track" aria-label="Sections">
        {indicator && <span className="seg-indicator" style={{ left: indicator.left, width: indicator.width }} />}
        {TABS.map((t) => (
          <Fragment key={t.key}>
            <button ref={(el) => { btnRefs.current[t.key] = el; }} onClick={() => onSelect(t.key)} data-active={active === t.key} className="seg-btn">
              {t.label}
            </button>
          </Fragment>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<string>('structure');
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [elevated, setElevated] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState('');

  useEffect(() => {
    get<Client[]>('/clients')
      .then((all) => {
        setClients(all);
        setClientId((cur) => (cur && all.some((c) => c.id === cur) ? cur : all[0]?.id ?? ''));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onScroll = () => setElevated(window.scrollY > 6);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const active = clients.find((c) => c.id === clientId);

  return (
    <ClientContext.Provider value={{ clientId, clients }}>
      <div className="app-bg min-h-screen overflow-x-hidden">
        <header className={`glass hairline-b sticky top-0 z-20 transition-shadow duration-300 ${elevated ? 'header-elevated' : ''}`}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-6 pb-2 pt-3">
            <div className="flex shrink-0 items-center gap-2.5" title="AGDL KYC · Ab geht die Lutzi 🚀">
              <img src="/armira-logo.svg" alt="Armira" className="h-6 w-auto" />
              <span className="h-5 w-px bg-black/15" />
              <span className="font-display text-xl font-bold tracking-tight text-navy">DealProof</span>
            </div>
            {active && <span className="hidden text-xs text-fog sm:inline">· {active.deal_name || active.name}</span>}
            <div className="ml-auto flex shrink-0 items-center gap-2.5">
              {clients.length > 1 && (
                <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="field max-w-64 py-2 text-[13px]" aria-label="Active client">
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.deal_name || c.name}
                    </option>
                  ))}
                </select>
              )}
              <StatusBadge />
              <PrivacyButton onClick={() => setPrivacyOpen(true)} />
            </div>
          </div>
          <div className="mx-auto max-w-6xl px-4 pb-3 sm:px-6">
            <SegmentedNav active={tab} onSelect={setTab} />
          </div>
        </header>

        <main key={tab} className="animate-fade-up mx-auto max-w-6xl px-6 py-12">
          {!clientId ? (
            <div className="card p-8 text-center text-sm text-fog">
              No client yet. Run <code className="font-mono text-bone">npm run seed</code> to load the Project Halcyon demo, then refresh.
            </div>
          ) : (
            <>
              {tab === 'structure' && <Structure />}
              {tab === 'sources' && <Sources />}
              {tab === 'questionnaires' && <Questionnaires />}
              {tab === 'brain' && <Brain />}
            </>
          )}
        </main>

        <footer className="mx-auto max-w-6xl px-6 pb-10 pt-6 text-xs leading-relaxed text-fog/70">
          DealProof — map a client's structure to any KYC questionnaire and answer it with verified citations. Fictional client: Project Halcyon. Not legal advice.
        </footer>

        {privacyOpen && <PrivacyPanel onClose={() => setPrivacyOpen(false)} />}
      </div>
    </ClientContext.Provider>
  );
}
