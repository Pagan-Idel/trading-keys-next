import React, { useEffect, useState } from 'react';
// Helper to format ISO time to readable string
function formatTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}
import styled from 'styled-components';

const Card = styled.div`
  background: #18181b;
  color: #fff;
  border-radius: 10px;
  padding: 0.9rem 1.1rem;
  min-width: 180px;
  max-width: 260px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.13);
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.98rem;
`;

const Status = styled.div<{ up?: boolean }>`
  font-size: 1.1rem;
  font-weight: bold;
  color: ${({ up }) => (up ? '#22c55e' : '#ef4444')};
  margin-bottom: 0.2rem;
`;


const PercentNumber = styled.span<{ percent: number; trend: 'up' | 'down' }>`
  font-size: 1.1rem;
  font-weight: bold;
  color: ${({ percent, trend }) => {
    // For uptrend: high percent is green, low is red. For downtrend: low percent is green, high is red.
    if (trend === 'up') {
      if (percent > 66) return '#22c55e'; // green
      if (percent > 33) return '#facc15'; // yellow
      return '#ef4444'; // red
    } else {
      if (percent < 33) return '#22c55e'; // green
      if (percent < 66) return '#facc15'; // yellow
      return '#ef4444'; // red
    }
  }};
  margin-left: 0.3rem;
`;

const StructurePoints = styled.div`
  margin-top: 0.2rem;
  display: flex;
  gap: 0.7rem;
`;

const StructurePoint = styled.span<{ type: string }>`
  font-weight: bold;
  color: ${({ type }) =>
    type === 'HH' ? '#22c55e' :
    type === 'LL' ? '#ef4444' :
    type === 'HL' ? '#3b82f6' :
    type === 'LH' ? '#facc15' : '#a1a1aa'};
  background: #23232b;
  border-radius: 6px;
  padding: 0.15rem 0.5rem;
  font-size: 0.98rem;
`;

const Label = styled.div`
  font-size: 0.95rem;
  color: #a1a1aa;
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
          const pct = ((lastCurrentPrice - min) / (max - min)) * 100;
          setPercent(pct);
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

    // Set up interval to update percent every minute
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
            const pct = ((lastCurrentPrice - min) / (max - min)) * 100;
            setPercent(pct);
          }
        } catch {}
      }
    }, 60000);

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
          <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', marginBottom: 4 }}>
            <Status up={trend === 'up'}>{trend === 'up' ? 'Uptrend' : 'Downtrend'}</Status>
            <span style={{ color: '#a1a1aa', fontSize: '0.95rem' }}>{interval.toUpperCase()}</span>
          </div>
          <div style={{ marginBottom: 6 }}>
            <span style={{ color: '#a1a1aa', fontSize: '0.95rem' }}>Current Price:</span>
            <PercentNumber percent={percent!} trend={trend!}>{percent!.toFixed(1)}%</PercentNumber>
          </div>
          <StructurePoints>
            {lastPoints.length === 2 && (
              <>
                <StructurePoint type={lastPoints[0].swing}>
                  {lastPoints[0].swing} {lastPoints[0].price}
                  <span style={{ display: 'block', color: '#a1a1aa', fontWeight: 400, fontSize: '0.85em' }}>{formatTime(lastPoints[0].time)}</span>
                </StructurePoint>
                <span style={{ color: '#a1a1aa', fontSize: '1.2rem', margin: '0 0.3rem' }}>→</span>
                <StructurePoint type={lastPoints[1].swing}>
                  {lastPoints[1].swing} {lastPoints[1].price}
                  <span style={{ display: 'block', color: '#a1a1aa', fontWeight: 400, fontSize: '0.85em' }}>{formatTime(lastPoints[1].time)}</span>
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
