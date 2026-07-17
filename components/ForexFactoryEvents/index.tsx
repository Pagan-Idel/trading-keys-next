import React, { useEffect, useState } from 'react';

import styled from 'styled-components';
import { buildDomId, buildDataTestId } from '../../utils/dom';

const Card = styled.div`
  background: #18181b;
  color: #fff;
  border-radius: 18px;
  padding: 36px 36px 32px 36px;
  min-width: 340px;
  max-width: 400px;
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

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.5rem;
`;

const Th = styled.th`
  background: #23232b;
  color: #fff;
  font-weight: 700;
  font-size: 1.1em;
  padding: 12px 0;
  border-bottom: 2px solid #23232b;
  text-align: left;
`;

const Td = styled.td`
  padding: 14px 0 10px 0;
  border-bottom: 1px solid #23232b;
  font-size: 1.08em;
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Currency = styled.span`
  font-weight: bold;
  color: #ffb300;
`;

const Impact = styled.span`
  font-weight: 600;
  color: #ff4d4f;
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

  const cardId = buildDomId('forex-events', pair);
  const cardTestId = buildDataTestId('forex-events', pair);

  return (
    <Card id={cardId} data-test={cardTestId}>
      <Title
        id={`${cardId}-title`}
        data-test={buildDataTestId('forex-events', pair, 'title')}
      >
        <span style={{ color: '#ff4d4f' }}>High</span> Impact News for {todayFormatted}
      </Title>
      {loading && (
        <div
          id={`${cardId}-loading`}
          data-test={buildDataTestId('forex-events', pair, 'loading')}
        >
          Loading events...
        </div>
      )}
      {error && (
        <div
          id={`${cardId}-error`}
          data-test={buildDataTestId('forex-events', pair, 'error')}
          style={{ color: 'red' }}
        >
          {error}
        </div>
      )}
      {!loading && !error && filteredEvents.length === 0 && (
        <div
          id={`${cardId}-empty`}
          data-test={buildDataTestId('forex-events', pair, 'empty')}
          style={{ color: '#aaa', padding: '18px 0', textAlign: 'center', fontWeight: 500, fontSize: '1.35rem' }}
        >
          No high impact news for this pair today.
        </div>
      )}
      {!loading && !error && filteredEvents.length > 0 && (
        <Table
          id={`${cardId}-table`}
          data-test={buildDataTestId('forex-events', pair, 'table')}
        >
          <thead
            id={`${cardId}-table-head`}
            data-test={buildDataTestId('forex-events', pair, 'table-head')}
          >
            <tr id={`${cardId}-header-row`} data-test={buildDataTestId('forex-events', pair, 'header-row')}>
              <Th
                id={`${cardId}-header-time`}
                data-test={buildDataTestId('forex-events', pair, 'header-time')}
                style={{ width: '90px' }}
              >
                Time
              </Th>
              <Th
                id={`${cardId}-header-currency`}
                data-test={buildDataTestId('forex-events', pair, 'header-currency')}
                style={{ width: '60px' }}
              >
                Currency
              </Th>
              <Th
                id={`${cardId}-header-title`}
                data-test={buildDataTestId('forex-events', pair, 'header-title')}
                style={{ width: '140px', textAlign: 'center' }}
              >
                Title
              </Th>
              <Th
                id={`${cardId}-header-impact`}
                data-test={buildDataTestId('forex-events', pair, 'header-impact')}
                style={{ width: '60px', color: '#ff4d4f' }}
              >
                Impact
              </Th>
            </tr>
          </thead>
          <tbody
            id={`${cardId}-table-body`}
            data-test={buildDataTestId('forex-events', pair, 'table-body')}
          >
            {filteredEvents.map((event, idx) => (
              <tr
                key={idx}
                id={buildDomId('forex-events', pair, 'row', idx)}
                data-test={buildDataTestId('forex-events', pair, 'row', idx)}
              >
                <Td
                  id={buildDomId('forex-events', pair, 'row', idx, 'time')}
                  data-test={buildDataTestId('forex-events', pair, 'row', idx, 'time')}
                  style={{ width: '90px', fontWeight: 700, color: '#fff' }}
                >
                  {event.time}
                </Td>
                <Td
                  id={buildDomId('forex-events', pair, 'row', idx, 'currency')}
                  data-test={buildDataTestId('forex-events', pair, 'row', idx, 'currency')}
                  style={{ width: '60px' }}
                >
                  <Currency>{event.currency}</Currency>
                </Td>
                <Td
                  id={buildDomId('forex-events', pair, 'row', idx, 'title')}
                  data-test={buildDataTestId('forex-events', pair, 'row', idx, 'title')}
                  style={{ width: '140px', maxWidth: '140px', textAlign: 'center' }}
                  title={event.title}
                >
                  {event.title}
                </Td>
                <Td
                  id={buildDomId('forex-events', pair, 'row', idx, 'impact')}
                  data-test={buildDataTestId('forex-events', pair, 'row', idx, 'impact')}
                  style={{ width: '60px' }}
                >
                  <Impact>{event.impact}</Impact>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
};

export default ForexFactoryEvents;
