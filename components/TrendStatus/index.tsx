import React, { useEffect, useState } from 'react';
import styled from 'styled-components';

// Helper to format ISO time to readable string
function formatTime(iso?: string, options?: { showTime?: boolean }) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(options && options.showTime ? {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    } : {})
  });
}

const Card = styled.div`
  background: #18181b;
  color: #fff;
  border-radius: 18px;
  padding: 32px 0 24px 0;
  min-width: 400px;
  max-width: 600px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.13);
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 1.25rem;
`;

const Status = styled.div<{ up?: boolean }>`
  font-size: 1.45rem;
  font-weight: bold;
  color: ${({ up }) => (up ? '#22c55e' : '#ef4444')};
  margin-bottom: 0.2rem;
  text-align: center;
`;


const AboveBelow = styled.span<{ green: boolean }>`
  font-size: 1.25rem;
  font-weight: bold;
  color: ${({ green }) => (green ? '#22c55e' : '#ef4444')};
  margin-left: 0.5rem;
  text-align: center;
`;

const StructurePoints = styled.div`
  margin-top: 0.2rem;
  display: flex;
  gap: 0.7rem;
  justify-content: center;
  width: 100%;
`;

const StructurePoint = styled.div<{ type: string }>`
  color: ${({ type }) =>
    type === 'HH' ? '#22c55e' :
    type === 'LL' ? '#ef4444' :
    type === 'HL' ? '#3b82f6' :
    type === 'LH' ? '#facc15' : '#a1a1aa'};
  background: #23232b;
  border-radius: 6px;
  padding: 0.25rem 0.8rem;
  font-size: 1.15rem;
  text-align: center;
`;

const Label = styled.div`
  font-size: 1.1rem;
  color: #a1a1aa;
  text-align: center;
`;

interface TrendStatusProps {
  symbol: string;
  interval: string;
}

interface SwingPoint {
  candleIndex: number;
  swing: string;
  price: number;
  time?: string;
}

const TrendStatus: React.FC<TrendStatusProps> = ({ symbol, interval }) => {
  const [trend, setTrend] = useState<'up' | 'down' | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [lastPoints, setLastPoints] = useState<SwingPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch trend and percent, and set up interval to update percent every minute
  useEffect(() => {
    let lastTwoPoints: SwingPoint[] = [];
    let trendDir: 'up' | 'down' | null = null;
    let lastCurrentPrice: number | null = null;
    let min = 0, max = 0;
    let intervalId: NodeJS.Timeout;

    const fetchTrend = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/determine-swing-label?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`);
        const data = await res.json();
        if (!data || !data.swingPoints || data.swingPoints.length < 2) {
          setError('Not enough data to determine trend.');
          setLoading(false);
          return;
        }
        const swings: SwingPoint[] = data.swingPoints;
        // Find last two structure points (LL/HH/HL/LH)
        const structureLabels = ['LL', 'HH', 'HL', 'LH'];
        const structurePoints = swings.filter(s => structureLabels.includes(s.swing));
        lastTwoPoints = structurePoints.slice(-2);
        setLastPoints(lastTwoPoints);
        if (lastTwoPoints.length === 2) {
          const [prev, last] = lastTwoPoints;
          trendDir = last.price > prev.price ? 'up' : 'down';
          setTrend(trendDir);
          min = Math.min(last.price, prev.price);
          max = Math.max(last.price, prev.price);
          lastCurrentPrice = data.currentPrice;
          if (lastCurrentPrice !== null) {
            const pct = ((lastCurrentPrice - min) / (max - min)) * 100;
            setPercent(pct);
          } else {
            setPercent(null);
          }
        } else {
          setTrend(null);
          setPercent(null);
        }
      } catch (err) {
        setError('Failed to fetch trend status.');
      }
      setLoading(false);
    };

    fetchTrend();

    // Set up interval to update percent every 15 minutes
    intervalId = setInterval(async () => {
      if (lastTwoPoints.length === 2) {
        try {
          // Only fetch current price, not all swing points
          const res = await fetch(`/api/determine-swing-label?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`);
          const data = await res.json();
          if (data && typeof data.currentPrice === 'number') {
            lastCurrentPrice = data.currentPrice;
            const [prev, last] = lastTwoPoints;
            min = Math.min(last.price, prev.price);
            max = Math.max(last.price, prev.price);
            if (lastCurrentPrice !== null) {
              const pct = ((lastCurrentPrice - min) / (max - min)) * 100;
              setPercent(pct);
            } else {
              setPercent(null);
            }
          }
        } catch {}
      }
    }, 900000);

    return () => clearInterval(intervalId);
  }, [symbol, interval]);

  return (
    <Card>
      {loading ? (
        <Label>Loading...</Label>
      ) : error ? (
        <Label>{error}</Label>
      ) : trend && percent !== null && lastPoints.length === 2 ? (
        <>
          <div style={{ display: 'flex', width: '100%', justifyContent: 'center', alignItems: 'center', marginBottom: 8 }}>
            <Status up={trend === 'up'}>{trend === 'up' ? 'Uptrend' : 'Downtrend'}</Status>
            <span style={{ color: '#a1a1aa', fontSize: '1.1rem', marginLeft: 16 }}>{interval.toUpperCase()}</span>
          </div>
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            <span style={{ color: '#a1a1aa', fontSize: '1.1rem' }}>Current Price:</span>
            {/* Above/below 50% logic and color */}
            {(() => {
              const isAbove = percent! >= 50;
              let green = false;
              if (trend === 'up') {
                green = !isAbove;
              } else {
                green = isAbove;
              }
              return (
                <AboveBelow green={green}>
                  {isAbove ? 'Above 50%' : 'Below 50%'}
                </AboveBelow>
              );
            })()}
          </div>
          <StructurePoints>
            {lastPoints.length === 2 && (
              <>
                <StructurePoint type={lastPoints[0].swing}>
                  {lastPoints[0].swing} {lastPoints[0].price}
                  <span style={{ display: 'block', color: '#a1a1aa', fontWeight: 400, fontSize: '0.85em' }}>
                    {formatTime(lastPoints[0].time, { showTime: interval === 'H4' })}
                  </span>
                </StructurePoint>
                <span style={{ color: '#a1a1aa', fontSize: '1.2rem', margin: '0 0.3rem' }}>→</span>
                <StructurePoint type={lastPoints[1].swing}>
                  {lastPoints[1].swing} {lastPoints[1].price}
                  <span style={{ display: 'block', color: '#a1a1aa', fontWeight: 400, fontSize: '0.85em' }}>
                    {formatTime(lastPoints[1].time, { showTime: interval === 'H4' })}
                  </span>
                </StructurePoint>
              </>
            )}
          </StructurePoints>
        </>
      ) : (
        <Label>No trend data.</Label>
      )}
    </Card>
  );
};

export default TrendStatus;
