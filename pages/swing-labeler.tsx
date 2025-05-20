'use client';

import { useState } from 'react';
import styled from 'styled-components';
import { Candle, determineSwingPoints, SwingResult } from '../utils/swingLabeler';

const Container = styled.main`
  padding: 2rem;
  font-family: 'Segoe UI', sans-serif;
  background-color: #f8fafc;
  color: #1f2937;
  min-height: 100vh;
  max-width: 800px;
  margin: 0 auto;
`;

const Heading = styled.h1`
  font-size: 2rem;
  margin-bottom: 1.5rem;
  text-align: center;
  color: #111827;
`;

const FormSection = styled.div`
  margin-bottom: 1.5rem;
`;

const Label = styled.label`
  display: block;
  margin-bottom: 0.25rem;
  font-weight: 500;
`;

const Select = styled.select`
  padding: 0.5rem;
  width: 200px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
`;

const Input = styled.input`
  padding: 0.5rem;
  width: 80px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
`;

const Button = styled.button`
  background-color: #2563eb;
  color: white;
  border: none;
  padding: 0.6rem 1.2rem;
  margin-top: 1rem;
  font-weight: bold;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  &:hover {
    background-color: #1d4ed8;
  }
`;

const Highlight = styled.span<{ label?: string }>`
  font-weight: bold;
  color: ${({ label }) =>
    label === 'HH' ? 'green' :
    label === 'LL' ? 'red' :
    label === 'HL' ? 'blue' :
    label === 'LH' ? 'orange' :
    'black'};
`;

const ResultList = styled.ul`
  list-style: none;
  padding-left: 0;
  margin-top: 2rem;
`;

const ResultItem = styled.li`
  margin-bottom: 0.75rem;
  font-size: 1rem;
`;

export default function Home() {
  const [symbol, setSymbol] = useState('EUR/USD');
  const [interval, setInterval] = useState('1h');
  const [outputSize, setOutputSize] = useState(20);
  const [swingResults, setSwingResults] = useState<SwingResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAndLabel = async () => {
    setLoading(true);
    setSwingResults([]);
    setError(null);

    try {
      const adjustedSize = outputSize + 1;
      const res = await fetch(
        `/api/oanda/fetch-candles?symbol=${symbol}&interval=${interval}&outputsize=${adjustedSize}`
      );
      const data = await res.json();

      if (!data.candles || !Array.isArray(data.candles)) {
        throw new Error('Missing candle data');
      }

      const candles: Candle[] = [...data.candles].slice(0, outputSize);
      const swingPoints: SwingResult[] = determineSwingPoints(candles).sort(
        (a, b) => a.candleIndex - b.candleIndex
      );
      setSwingResults(swingPoints);
    } catch (err: any) {
      setError('Failed to fetch or process swing data.');
    }

    setLoading(false);
  };

  const forexPairs = [
    'EUR/USD', 'USD/JPY', 'GBP/USD', 'AUD/USD', 'USD/CAD',
    'USD/CHF', 'NZD/USD', 'EUR/JPY', 'GBP/JPY', 'EUR/GBP',
    'AUD/JPY', 'GBP/CAD', 'EUR/CHF', 'NZD/JPY', 'USD/SGD'
  ];

  const intervals = ['1day', '4h', '1h', '15m', '5m'];

  return (
    <Container>
      <Heading>Structure & Swing Point Labeler</Heading>

      <FormSection>
        <Label>Symbol:</Label>
        <Select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          {forexPairs.map(pair => (
            <option key={pair} value={pair}>{pair}</option>
          ))}
        </Select>
      </FormSection>

      <FormSection>
        <Label>Interval:</Label>
        <Select value={interval} onChange={(e) => setInterval(e.target.value)}>
          {intervals.map(tf => (
            <option key={tf} value={tf}>{tf}</option>
          ))}
        </Select>
      </FormSection>

      <FormSection>
        <Label>Output Size (candles):</Label>
        <Input
          type="number"
          value={outputSize}
          onChange={(e) => setOutputSize(Number(e.target.value))}
          min={2}
        />
      </FormSection>

      <Button onClick={fetchAndLabel}>
        {loading ? 'Loading...' : 'Analyze Swings'}
      </Button>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {swingResults.length > 0 && (
        <ResultList>
          {swingResults.map((step, idx) => (
            <ResultItem key={idx}>
              [Candle {step.candleIndex}] →{' '}
              <Highlight label={step.swing}>{step.swing}</Highlight>{' '}
              at <strong>{step.price.toFixed(5)}</strong>
            </ResultItem>
          ))}
        </ResultList>
      )}
    </Container>
  );
}
