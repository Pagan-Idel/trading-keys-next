// pages/index.tsx

import Keyboard from '../components/Keyboard';
import TrendStatus from '../components/TrendStatus';
import ForexFactoryEvents from '../components/ForexFactoryEvents';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Notification from '../components/Notification';

const AutomationCandyLog = dynamic(() => import('../components/AutomationCandyLog'), {
  ssr: false,
  loading: () => <div style={{ color: '#737d8d', padding: 24, textAlign: 'center' }}>Loading automation telemetry…</div>,
});


export default function Home() {
  const [pair, setPair] = useState('EUR/USD');
  const [accountType, setAccountType] = useState('demo');
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' | 'warning' } | null>(null);
  const [loadCandyLog, setLoadCandyLog] = useState(false);
  const candyLogBoundaryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const boundary = candyLogBoundaryRef.current;
    if (!boundary || loadCandyLog) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setLoadCandyLog(true);
        observer.disconnect();
      }
    }, { rootMargin: '300px' });
    observer.observe(boundary);
    return () => observer.disconnect();
  }, [loadCandyLog]);

  // No login/account selection, always default to demo, allow switching to live

  const intervals = [
    { label: 'Weekly', value: 'W' },
    { label: 'Daily', value: 'D' },
    { label: '4H', value: 'H4' },
  ];

  // Always show trading UI

  return (
    <>
      {notification && (
        <Notification
          message={notification.message}
          type={notification.type}
          onClose={() => setNotification(null)}
        />
      )}
      <style>{`
        @media (max-width: 600px) {
          .main-flex {
            flex-direction: column !important;
            gap: 1rem !important;
            align-items: stretch !important;
          }
        }
      `}</style>
      <div
        id="home-page"
        data-test="home-page"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '2rem' }}
      >
        <div
          id="home-layout"
          data-test="home-layout"
          className="main-flex"
          style={{ display: 'flex', gap: '2rem', justifyContent: 'center', alignItems: 'flex-start' }}
        >
          <div id="keyboard-panel" data-test="keyboard-panel">
            <Keyboard
              platform="oanda"
              pair={pair}
              setPair={setPair}
              accountType={accountType}
              setAccountType={setAccountType}
            />
          </div>
          <div
            id="analysis-panel"
            data-test="analysis-panel"
            style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
          >
            {/* Trend cards below keyboard on mobile */}
            {intervals.map(({ label, value }) => (
              <TrendStatus key={value} symbol={pair} interval={value} />
            ))}
            {/* News card below trend cards */}
            <ForexFactoryEvents pair={pair} />
          </div>
        </div>
        <div ref={candyLogBoundaryRef} id="keyboard-automation-log" style={{ width: 'min(1100px, calc(100% - 32px))', minHeight: 120, marginTop: '28px' }}>
          {loadCandyLog ? <AutomationCandyLog /> : (
            <button type="button" onClick={() => setLoadCandyLog(true)} style={{ width: '100%', minHeight: 92, border: '1px solid #292e38', borderRadius: 18, background: '#111419', color: '#8d97a6', cursor: 'pointer' }}>
              Load automation candylog
            </button>
          )}
        </div>
      </div>
      {/* Example: trigger notification on mount (remove or customize as needed) */}
      {/*
      useEffect(() => {
        setNotification({ message: 'Welcome!', type: 'success' });
      }, []);
      */}
    </>
  );
}
