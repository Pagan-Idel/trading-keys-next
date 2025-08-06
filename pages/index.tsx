// pages/index.tsx

import Keyboard from '../components/Keyboard';
import TrendStatus from '../components/TrendStatus';
import ForexFactoryEvents from '../components/ForexFactoryEvents';
import { useState } from 'react';


export default function Home() {
  const [pair, setPair] = useState('EUR/USD');
  const [accountType, setAccountType] = useState('demo');

  // No login/account selection, always default to demo, allow switching to live

  const intervals = [
    { label: '1D', value: '1d' },
    { label: '4H', value: '4h' },
    { label: '1H', value: '1h' },
    { label: '30M', value: '30m' },
  ];

  // Always show trading UI

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '2rem' }}>
      <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', alignItems: 'flex-start' }}>
        <div>
          <Keyboard
            platform="oanda"
            pair={pair}
            setPair={setPair}
            accountType={accountType}
            setAccountType={setAccountType}
          />
        </div>
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {intervals.map(({ label, value }) => (
              <TrendStatus key={value} symbol={pair} interval={value} />
            ))}
          </div>
        </div>
      </div>
      <ForexFactoryEvents pair={pair} />
    </div>
  );
}
