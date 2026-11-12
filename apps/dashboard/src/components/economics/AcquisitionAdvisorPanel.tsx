import { useMemo, useState } from 'react';
import { computeAdvisory, projectMonthlySpendUsd, type AdvisoryAction } from './acquisitionAdvisor';

interface AcquisitionAdvisorPanelProps {
  observedCostUsd: number;
}

const MULTIPLIERS = [1, 10, 100, 1000];

const ACTION_META: Record<AdvisoryAction, { label: string; color: string }> = {
  keep_flexible: { label: 'KEEP SPOT / SERVERLESS / MaaS', color: '#38bdf8' },
  reserve: { label: 'COMMIT RESERVED CAPACITY', color: '#fbbf24' },
  acquire_hardware: { label: 'ACQUIRE HARDWARE', color: '#34d399' },
};

const fmtUsd = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 4 : 0 })}`;

export function AcquisitionAdvisorPanel({ observedCostUsd }: AcquisitionAdvisorPanelProps) {
  const [multiplier, setMultiplier] = useState(100);
  const [override, setOverride] = useState(0);

  const spend = projectMonthlySpendUsd(observedCostUsd, multiplier, override);
  const advisory = useMemo(() => computeAdvisory(spend), [spend]);
  const meta = ACTION_META[advisory.action];

  const th = { padding: '8px 12px', color: '#94a3b8', fontWeight: 600 } as const;
  const td = { padding: '8px 12px', color: '#e2e8f0' } as const;

  return (
    <div style={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e293b' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
          Hardware Acquisition &amp; Reserved Capacity Advisor
        </h3>
        <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
          Estimated planning model: ledger spend is treated as 1 day and projected to a month. Prices and discounts are assumptions, not provider quotes.
        </p>
      </div>

      <div style={{ padding: '14px 20px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>Volume scale:</span>
        {MULTIPLIERS.map((m) => (
          <button
            key={m}
            onClick={() => { setMultiplier(m); setOverride(0); }}
            style={{
              padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${multiplier === m && !override ? '#6366f1' : '#334155'}`,
              backgroundColor: multiplier === m && !override ? '#6366f1' : '#1e293b',
              color: multiplier === m && !override ? '#fff' : '#94a3b8',
            }}
          >
            {m}×
          </button>
        ))}
        <label style={{ fontSize: '12px', color: '#94a3b8', marginLeft: 'auto' }}>
          Monthly spend override ($):{' '}
          <input
            type="number"
            min={0}
            value={override || ''}
            placeholder="auto"
            onChange={(e) => setOverride(Number(e.target.value))}
            style={{ width: '90px', backgroundColor: '#1e293b', color: '#f8fafc', border: '1px solid #334155', borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }}
          />
        </label>
      </div>

      <div style={{ margin: '0 20px 14px', padding: '12px 14px', borderRadius: '8px', border: `1px solid ${meta.color}`, backgroundColor: `${meta.color}12` }}>
        <div style={{ fontSize: '12px', color: '#94a3b8' }}>
          Projected cloud spend: <strong style={{ color: '#f8fafc' }}>{fmtUsd(advisory.monthlySpendUsd)}/mo</strong>
        </div>
        <div style={{ fontSize: '14px', fontWeight: 800, color: meta.color, marginTop: '4px' }}>{meta.label}</div>
        <div style={{ fontSize: '12px', color: '#cbd5e1', marginTop: '2px' }}>{advisory.rationale}</div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
          <thead>
            <tr style={{ backgroundColor: '#1e293b' }}>
              <th style={th}>Acquire hardware</th><th style={th}>Cards</th><th style={th}>Util.</th>
              <th style={th}>CapEx</th><th style={th}>Power/mo</th><th style={th}>Break-even</th><th style={th}>12-mo net</th>
            </tr>
          </thead>
          <tbody>
            {advisory.acquisitions.map((a) => (
              <tr key={a.option.id} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ ...td, fontWeight: 600 }}>{a.option.name}</td>
                <td style={td}>{a.cardsNeeded}</td>
                <td style={td}>{a.utilizationPct.toFixed(0)}%</td>
                <td style={td}>{fmtUsd(a.capexTotalUsd)}</td>
                <td style={td}>{fmtUsd(a.monthlyPowerUsd)}</td>
                <td style={{ ...td, color: a.breakEvenMonths !== null && a.breakEvenMonths <= 12 ? '#34d399' : '#94a3b8', fontWeight: 700 }}>
                  {a.breakEvenMonths === null ? 'never' : `${a.breakEvenMonths.toFixed(1)} mo`}
                </td>
                <td style={{ ...td, color: a.twelveMonthNetUsd >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>{fmtUsd(a.twelveMonthNetUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px', marginTop: '10px' }}>
          <thead>
            <tr style={{ backgroundColor: '#1e293b' }}>
              <th style={th}>Reserved commitment</th><th style={th}>Discount</th><th style={th}>Monthly cost</th>
              <th style={th}>Monthly savings</th><th style={th}>12-mo savings</th>
            </tr>
          </thead>
          <tbody>
            {advisory.reservations.map((r) => (
              <tr key={r.term.id} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ ...td, fontWeight: 600 }}>{r.term.label}</td>
                <td style={td}>{r.term.discountPct}%</td>
                <td style={td}>{fmtUsd(r.monthlyCostUsd)}</td>
                <td style={{ ...td, color: '#34d399' }}>{fmtUsd(r.monthlySavingsUsd)}</td>
                <td style={{ ...td, color: '#34d399', fontWeight: 600 }}>{fmtUsd(r.twelveMonthNetUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
