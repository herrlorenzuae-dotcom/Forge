import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'strict',
  fontFamily: "'Schibsted Grotesk', system-ui, sans-serif",
  themeVariables: {
    primaryColor: '#ffffff',
    primaryTextColor: '#1b1a18',
    primaryBorderColor: '#cabfb0',
    lineColor: '#6d6a63',
    fontSize: '14px',
  },
});

let counter = 0;

export function OrgChart({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `org-${++counter}`;
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="card p-5">
        <p className="mb-2 text-xs text-warn">Could not render the chart ({error}). The structure source:</p>
        <pre className="whitespace-pre-wrap font-mono text-[11px] text-fog">{code}</pre>
      </div>
    );
  }
  return <div ref={ref} className="org-chart flex justify-center overflow-x-auto" />;
}
