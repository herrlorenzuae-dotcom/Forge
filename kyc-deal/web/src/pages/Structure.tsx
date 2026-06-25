import { useEffect, useState } from 'react';
import { get, type OrgChart as OrgChartData, type Structure as StructureData } from '../api.js';
import { useClient } from '../App.js';
import { SectionTitle, Pill, ErrorNote } from '../components.js';
import { InteractiveOrgChart } from '../InteractiveOrgChart.js';
import { StructureImport } from './StructureImport.js';

const ROLE_TONE: Record<string, 'ember' | 'verdant' | 'neutral'> = {
  ubo: 'ember',
  acquisition_vehicle: 'ember',
  target: 'verdant',
};

export function Structure() {
  const { clientId } = useClient();
  const [structure, setStructure] = useState<StructureData | null>(null);
  const [chart, setChart] = useState<OrgChartData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!clientId) return;
    setError(null);
    Promise.all([get<StructureData>(`/clients/${clientId}/structure`), get<OrgChartData>(`/clients/${clientId}/orgchart`)])
      .then(([s, c]) => {
        setStructure(s);
        setChart(c);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const nameOf = (id: string) => structure?.entities.find((e) => e.id === id)?.name ?? '?';

  return (
    <div>
      <SectionTitle eyebrow="The result" sub="The client's corporate structure — the thing that barely changes between deals. Pulled from Quantium and YSolutions, this is the source of truth every questionnaire answer maps back to.">
        Structure &amp; beneficial owners
      </SectionTitle>
      <ErrorNote error={error} />

      <StructureImport clientId={clientId} onApplied={load} />

      {chart && (
        <div className="card-elevated mb-8 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-fog">Organisation chart</h2>
            <span className="text-[11px] text-fog">
              {chart.nodes.length} entities · {chart.edges.length} links
            </span>
          </div>
          <InteractiveOrgChart nodes={chart.nodes} edges={chart.edges} />
          <div className="mt-4 flex flex-wrap gap-4 border-t border-black/[0.06] pt-3 text-[11px] text-fog">
            <span className="flex items-center gap-1.5">
              <svg width="26" height="6">
                <line x1="0" y1="3" x2="26" y2="3" stroke="#6d6a63" strokeWidth="1.5" />
              </svg>
              Ownership (with %)
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="26" height="6">
                <line x1="0" y1="3" x2="26" y2="3" stroke="#7d2f3f" strokeWidth="1.5" strokeDasharray="5 4" />
              </svg>
              Control (voting / board / agreement)
            </span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-1 rounded bg-ember" /> UBO / BidCo</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-1 rounded bg-verdant" /> Target</span>
          </div>
        </div>
      )}

      {structure && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Beneficial owners */}
          <div className="card p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-fog">Ultimate beneficial owners</h2>
            <div className="space-y-3">
              {structure.ubos.map((u) => (
                <div key={u.id} className="flex items-start justify-between gap-3 border-b border-black/[0.05] pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="font-medium text-bone">{nameOf(u.entity_id)}</p>
                    <p className="text-xs text-fog">
                      {u.basis.replace(/_/g, ' ')} · {u.residence}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-mono text-sm tabular-nums text-bone">{u.pct}%</span>
                    <Pill tone={u.pep ? 'warn' : 'verdant'}>{u.pep ? 'PEP' : 'not PEP'}</Pill>
                  </div>
                </div>
              ))}
              {structure.ubos.length === 0 && <p className="text-sm text-fog">No beneficial owners recorded.</p>}
            </div>
          </div>

          {/* Entities */}
          <div className="card p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-fog">Entities</h2>
            <div className="space-y-3">
              {structure.entities
                .filter((e) => e.kind !== 'individual')
                .map((e) => (
                  <div key={e.id} className="border-b border-black/[0.05] pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-bone">{e.name}</p>
                      <Pill tone={ROLE_TONE[e.role] ?? 'neutral'}>{e.role.replace(/_/g, ' ')}</Pill>
                    </div>
                    <p className="mt-0.5 text-xs text-fog">
                      {e.jurisdiction} · {e.registration_no || 'no reg. no.'} {e.incorporation_date ? `· inc. ${e.incorporation_date}` : ''}
                    </p>
                  </div>
                ))}
            </div>
          </div>

          {/* Attributes */}
          <div className="card p-6 lg:col-span-2">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-fog">Facts on file</h2>
            <table className="w-full text-left text-sm">
              <thead className="text-fog">
                <tr className="border-b border-black/[0.07] text-[11px] uppercase tracking-wide">
                  <th className="py-2 pr-3 font-medium">Entity</th>
                  <th className="py-2 pr-3 font-medium">Attribute</th>
                  <th className="py-2 pr-3 font-medium">Value</th>
                  <th className="py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {structure.attributes.map((a) => (
                  <tr key={a.id} className="border-b border-black/[0.04] align-top last:border-0">
                    <td className="py-2 pr-3 text-fog">{nameOf(a.entity_id)}</td>
                    <td className="py-2 pr-3 font-medium text-bone">{a.key}</td>
                    <td className="py-2 pr-3 text-bone">{a.value}</td>
                    <td className="py-2">
                      <Pill tone={a.source === 'quantium' ? 'ember' : 'neutral'}>{a.source}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
