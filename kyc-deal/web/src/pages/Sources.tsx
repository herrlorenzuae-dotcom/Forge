import { useEffect, useState } from 'react';
import { get, post, type CurrencyReport, type SyncRow } from '../api.js';
import { useClient } from '../App.js';
import { SectionTitle, Button, GhostButton, Pill, ErrorNote } from '../components.js';

export function Sources() {
  const { clientId } = useClient();
  const [syncs, setSyncs] = useState<SyncRow[]>([]);
  const [currency, setCurrency] = useState<CurrencyReport | null>(null);
  const [busy, setBusy] = useState<'refresh' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSyncs = () => get<SyncRow[]>(`/clients/${clientId}/syncs`).then(setSyncs).catch(() => {});
  useEffect(() => {
    if (clientId) loadSyncs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const refresh = async () => {
    setBusy('refresh');
    setError(null);
    try {
      await post(`/clients/${clientId}/refresh`);
      await loadSyncs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    setBusy('verify');
    setError(null);
    try {
      setCurrency(await post<CurrencyReport>(`/clients/${clientId}/verify-currency`));
      await loadSyncs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <SectionTitle eyebrow="Systems of record" sub="The client's data lives in Quantium (the corporate structure) and YSolutions (the softer KYC layer). KYC Deal reaches both through MCP connectors — pull the structure, and verify how current it is before you rely on it.">
        Data sources &amp; currency
      </SectionTitle>
      <ErrorNote error={error} />

      <div className="mb-8 grid gap-5 sm:grid-cols-2">
        <div className="card p-6">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-display text-xl text-bone">Quantium</h2>
            <Pill tone="ember">structure + currency</Pill>
          </div>
          <p className="mb-4 text-sm leading-relaxed text-fog">
            Corporate registry: entities, ownership, beneficial owners and registry facts. Also answers the “is this still current?” question.
          </p>
          <div className="flex gap-2">
            <Button onClick={refresh} busy={busy === 'refresh'}>
              Pull structure
            </Button>
            <GhostButton onClick={verify} busy={busy === 'verify'}>
              Verify currency
            </GhostButton>
          </div>
        </div>
        <div className="card p-6">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-display text-xl text-bone">YSolutions</h2>
            <Pill>supplemental data</Pill>
          </div>
          <p className="mb-4 text-sm leading-relaxed text-fog">
            The softer KYC layer: primary contacts, source of funds and wealth, FATCA/CRS and tax classifications. Imported alongside the Quantium pull.
          </p>
          <p className="text-[11px] text-fog">MCP server: <code className="font-mono">npm run mcp:ysolutions</code></p>
        </div>
      </div>

      {currency && (
        <div className="card-elevated mb-8 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-fog">Currency check · {currency.checkedAt}</h2>
            <Pill tone={currency.staleCount === 0 ? 'verdant' : 'warn'}>
              {currency.staleCount === 0 ? 'All current' : `${currency.staleCount} stale (> ${currency.staleDays}d)`}
            </Pill>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-fog">
              <tr className="border-b border-black/[0.07] text-[11px] uppercase tracking-wide">
                <th className="py-2 pr-3 font-medium">Entity</th>
                <th className="py-2 pr-3 font-medium">As of</th>
                <th className="py-2 pr-3 font-medium">Age</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {currency.items.map((i) => (
                <tr key={i.ref} className="border-b border-black/[0.04] last:border-0">
                  <td className="py-2 pr-3 font-medium text-bone">{i.name}</td>
                  <td className="py-2 pr-3 font-mono text-fog">{i.as_of}</td>
                  <td className="py-2 pr-3 font-mono tabular-nums text-fog">{i.ageDays}d</td>
                  <td className="py-2">
                    <Pill tone={i.stale ? 'warn' : 'verdant'}>{i.stale ? 'stale' : 'current'}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-fog">Connector activity</h2>
        <div className="space-y-2.5">
          {syncs.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-3 border-b border-black/[0.04] pb-2.5 text-sm last:border-0 last:pb-0">
              <div>
                <p className="text-bone">
                  <span className="font-mono text-xs text-fog">{s.connector}</span> · {s.op}
                </p>
                <p className="text-xs text-fog">{s.message}</p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-fog">{s.checked_at}</span>
            </div>
          ))}
          {syncs.length === 0 && <p className="text-sm text-fog">No pulls yet — hit “Pull structure”.</p>}
        </div>
      </div>
    </div>
  );
}
