// NumberPad.tsx
import { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { ACTION, TYPE, order, modifyTrade, closeTrade } from '../utils/oanda/api';
import { openPostionMT } from '../utils/match-trader/api/open';
import { closePositionMT } from '../utils/match-trader/api/close-position';
import { closePartiallyMT } from '../utils/match-trader/api/close-partially';
import { moveTPSLMT } from '../utils/match-trader/api/move-TPSL';
import { stopAtEntryMT } from '../utils/match-trader/api/stop-at-entry';
import { logToFileAsync } from '../utils/logger';

const riskPercentages = ['0.25', '0.5', '1.0', '1.5', '2.0', '3.0'];
const majorForexPairs = ['EURUSD', 'USDJPY', 'GBPUSD', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURJPY'];
const functionNames = [
  '7 - SL UP', '8 - TP UP', '9 - 50% CLOSE',
  '4 - SL DOWN', '5 - TP DOWN', '6 - 25% CLOSE',
  '1 - BUY', '2 - SELL', '3 - SL AT ENTRY', '0 - CLOSE'
];

interface KeyboardProps {
  platform: string;
}

const Button = styled.button`
  width: 80px;
  height: 80px;
  color: #ffffff;
  border: none;
  font-size: 18px;
  cursor: pointer;
  transition: background-color 0.3s ease, filter 0.1s ease;
  position: relative;
`;

const NumberPadContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
`;

const NumberButton = styled(Button)<{ pressed: boolean }>`
  background-color: ${(props) => (props.pressed ? '#e74c3c' : '#3498db')};
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background-color: #2980b9;
  }

  &:after {
    content: attr(data-function-name);
    font-size: 12px;
    color: #ffffff;
    position: absolute;
    bottom: 5px;
    left: 50%;
    transform: translateX(-50%);
  }
`;

const PercentageButton = styled(Button)<{ selected: boolean }>`
  background-color: ${(props) => (props.selected ? '#2ecc71' : '#3498db')};
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background-color: ${(props) => (props.selected ? '#27ae60' : '#2980b9')};
  }
`;

const PipContainer = styled.div`
  display: flex;
  align-items: center;
`;

const PipStopLossDisplay = styled.div`
  font-size: 18px;
  color: white;
  margin-right: 10px;
`;

const PipStopLoss = styled.input.attrs({ type: 'range', min: 1, max: 20, step: 1 })`
  width: 100%;
`;

const Dropdown = styled.select`
  margin: 10px 0;
  padding: 6px;
  font-size: 16px;
  background-color: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
`;

const Keyboard = ({ platform }: KeyboardProps) => {
  const [riskPercentage, setRiskPercentage] = useState('1.0');
  const [pipStopLoss, setPipStopLoss] = useState<number>(6);
  const [buttonPressed, setButtonPressed] = useState<string | null>(null);
  const [pair, setPair] = useState<string>('EURUSD');
  const lastExecutionTimeRef = useRef<number>(0);

  useEffect(() => {
    const storedStopLoss = localStorage.getItem('stopLoss');
    if (storedStopLoss) {
      setPipStopLoss(Number(storedStopLoss));
    } else {
      localStorage.setItem('stopLoss', '6');
    }
  }, []);

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      const key = event.key;
      if (/^[0-9]$/.test(key)) {
        const functionName = functionNames.find(name => name.includes(`${key} - `));
        if (functionName) {
          handleButtonClick(functionName);
        }
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  const handlePipStopLossChange = (value: number) => {
    localStorage.setItem('stopLoss', value.toString());
    setPipStopLoss(value);
  };

  const createRateLimitedFunction = (callback: () => void) => {
    return () => {
      const currentTime = Date.now();
      if (currentTime - lastExecutionTimeRef.current >= 5000) {
        lastExecutionTimeRef.current = currentTime;
        callback();
      } else {
        logToFileAsync('Function is rate-limited. Try again later.');
      }
    };
  };

  const rateLimitedBuyOanda = createRateLimitedFunction(() =>
    order({ risk: Number(riskPercentage), orderType: TYPE.MARKET, action: ACTION.BUY, pair })
  );
  const rateLimitedSellOanda = createRateLimitedFunction(() =>
    order({ risk: Number(riskPercentage), orderType: TYPE.MARKET, action: ACTION.SELL, pair })
  );
  const rateLimitedBuyMT = createRateLimitedFunction(() =>
    openPostionMT(Number(riskPercentage), ACTION.BUY, pair)
  );
  const rateLimitedSellMT = createRateLimitedFunction(() =>
    openPostionMT(Number(riskPercentage), ACTION.SELL, pair)
  );

  const handleButtonClick = (functionName: string) => {
    setButtonPressed(functionName);
    switch (platform) {
      case 'oanda':
        switch (functionName) {
          case '0 - CLOSE': closeTrade({ action: ACTION.CLOSE, pair }); break;
          case '1 - BUY': rateLimitedBuyOanda(); break;
          case '2 - SELL': rateLimitedSellOanda(); break;
          case '3 - SL AT ENTRY': modifyTrade({ action: ACTION.SLatEntry, pair }); break;
          case '4 - SL DOWN': modifyTrade({ action: ACTION.MoveSL, action2: ACTION.DOWN, pair }); break;
          case '5 - TP DOWN': modifyTrade({ action: ACTION.MoveTP, action2: ACTION.DOWN, pair }); break;
          case '6 - 25% CLOSE': closeTrade({ action: ACTION.PartialClose25, pair }); break;
          case '7 - SL UP': modifyTrade({ action: ACTION.MoveSL, action2: ACTION.UP, pair }); break;
          case '8 - TP UP': modifyTrade({ action: ACTION.MoveTP, action2: ACTION.UP, pair }); break;
          case '9 - 50% CLOSE': closeTrade({ action: ACTION.PartialClose50, pair }); break;
        }
        break;

      case 'match-trader':
        switch (functionName) {
          case '0 - CLOSE': closePositionMT(pair); break;
          case '1 - BUY': rateLimitedBuyMT(); break;
          case '2 - SELL': rateLimitedSellMT(); break;
          case '3 - SL AT ENTRY': stopAtEntryMT(pair); break;
          case '4 - SL DOWN': moveTPSLMT(ACTION.MoveSL, ACTION.DOWN, pair); break;
          case '5 - TP DOWN': moveTPSLMT(ACTION.MoveTP, ACTION.DOWN, pair); break;
          case '6 - 25% CLOSE': closePartiallyMT(0.249999999999, pair); break;
          case '7 - SL UP': moveTPSLMT(ACTION.MoveSL, ACTION.UP, pair); break;
          case '8 - TP UP': moveTPSLMT(ACTION.MoveTP, ACTION.UP, pair); break;
          case '9 - 50% CLOSE': closePartiallyMT(0.499999999999, pair); break;
        }
        break;
    }
  };

  return (
    <>
      <div style={{ borderTop: '1px solid #ccc', margin: '10px 0' }} />

      <h2 style={{ color: 'white' }}>Forex Pair</h2>
      <Dropdown value={pair} onChange={(e) => setPair(e.target.value)}>
        {majorForexPairs.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </Dropdown>

      <h2 style={{ color: 'white' }}>Risk Percent</h2>
      <NumberPadContainer>
        {riskPercentages.map((percentage, idx) => (
          <PercentageButton
            key={idx}
            selected={riskPercentage === percentage}
            onClick={() => setRiskPercentage(percentage)}
          >
            {percentage}
          </PercentageButton>
        ))}
      </NumberPadContainer>

      <div style={{ borderTop: '1px solid #ccc', margin: '10px 0' }} />
      <h2 style={{ color: 'white' }}>Pip Stop Loss</h2>
      <PipContainer>
        <PipStopLossDisplay>{pipStopLoss}</PipStopLossDisplay>
        <PipStopLoss
          value={pipStopLoss}
          onChange={(e) => handlePipStopLossChange(Number(e.target.value))}
        />
      </PipContainer>

      <div style={{ borderTop: '1px solid #ccc', margin: '10px 0' }} />
      <h2 style={{ color: 'white' }}>Functions</h2>
      <NumberPadContainer>
        {functionNames.map((name, idx) => (
          <NumberButton
            key={idx}
            id={`numberButton-${idx}`}
            pressed={name === buttonPressed}
            onClick={() => handleButtonClick(name)}
          >
            {name}
          </NumberButton>
        ))}
      </NumberPadContainer>
    </>
  );
};

export default Keyboard;
