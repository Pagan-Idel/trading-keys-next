import React, { useEffect, useState } from 'react';
import styled from 'styled-components';

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
`;

const Title = styled.h2`
  color: #fff;
  margin-bottom: 18px;
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: 1px;
  text-shadow: 0 2px 8px rgba(0,0,0,0.12);
`;

const EventRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0 12px 0;
  border-bottom: 1px solid #2a2d3e;
  font-weight: 600;
  background: rgba(255, 77, 79, 0.13);
  border-radius: 8px;
  margin-bottom: 8px;
  box-shadow: 0 2px 8px 0 rgba(255,77,79,0.08);
`;

const Currency = styled.span`
  font-weight: bold;
  color: #ffb300;
  font-size: 1.1em;
  margin: 0 10px;
`;

const Impact = styled.span`
  font-weight: bold;
  color: #ff4d4f;
  font-size: 1.1em;
  margin-left: 10px;
`;

interface ForexEvent {
  title: string;
  time: string;
  currency: string;
  impact: 'High' | 'Medium' | 'Low';
  date: string;
}

function getPairCurrencies(pair: string) {
  return pair.split('/');
}

interface ForexFactoryEventsProps {
  pair: string;
}

const ForexFactoryEvents: React.FC<ForexFactoryEventsProps> = ({ pair }) => {
  const [events, setEvents] = useState<ForexEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/forex-factory-events`)
      .then(res => res.json())
      .then(data => {
        setEvents(data.events || []);
        setLoading(false);
      })
      .catch(e => {
        setError('Failed to fetch events');
        setLoading(false);
      });
  }, []);

  const [base, quote] = getPairCurrencies(pair);
  // Only show high impact, for today, for selected pair
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-CA'); // YYYY-MM-DD
  const filteredEvents = events.filter(
    e =>
      (e.currency === base || e.currency === quote) &&
      e.impact === 'High' &&
      e.date === todayStr
  );

  // Format today's date for the title
  const todayFormatted = today.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <Card>
      <Title>High Impact News for {todayFormatted}</Title>
      {/* Pair input removed, pair comes from props */}
      {loading && <div>Loading events...</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {!loading && !error && filteredEvents.length === 0 && (
        <div style={{ color: '#aaa', padding: '18px 0', textAlign: 'center', fontWeight: 500, fontSize: '1.35rem' }}>
          No high impact news for this pair today.
        </div>
      )}
      {!loading && !error && filteredEvents.map((event, idx) => (
        <EventRow key={idx}>
          <span style={{ minWidth: 70, fontWeight: 700, color: '#fff' }}>{event.time}</span>
          <Currency>{event.currency}</Currency>
          <span style={{ flex: 1, margin: '0 12px', color: '#fff' }}>{event.title}</span>
          <Impact>{event.impact}</Impact>
          <span style={{ marginLeft: 16, color: '#bdbdbd', fontSize: '0.95em', minWidth: 110 }}>
            {new Date(event.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
          </span>
        </EventRow>
      ))}
    </Card>
  );
};

export default ForexFactoryEvents;
