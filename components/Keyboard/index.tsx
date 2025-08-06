import { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { ACTION, TYPE } from '../../utils/oanda/api/order';
import { forexPairs } from '../../utils/constants'
const riskPercentages = ['0.25', '0.5', '1.0', '1.5', '2.0', '3.0'];
const functionNames = [
  '7 - SL UP', '8 - TP UP', '9 - 50% CLOSE',
  '4 - SL DOWN', '5 - TP DOWN', '6 - 25% CLOSE',
  '1 - BUY', '2 - SELL', '3 - SL AT ENTRY', '0 - CLOSE'
];

interface KeyboardProps {
  platform: string;
  pair: string;
  setPair: (pair: string) => void;
  accountType: string;
  setAccountType: (type: string) => void;
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

const NumberButton = styled(Button) <{ pressed: boolean }>`
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

const PercentageButton = styled(Button) <{ selected: boolean }>`
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
  min-width: 160px;
  height: 38px;
`;

const SwitchButton = styled.button`
  margin-left: 10px;
  padding: 6px;
  font-size: 16px;
  background-color: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.3s ease;
  min-width: 160px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover {
    background-color: #2980b9;
  }
`;



const Keyboard = ({ platform, pair, setPair, accountType, setAccountType }: KeyboardProps) => {
  const [riskPercentage, setRiskPercentage] = useState('1.0');
  const [pipStopLoss, setPipStopLoss] = useState<number>(6);
  const [buttonPressed, setButtonPressed] = useState<string | null>(null);
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
        console.log('Function is rate-limited. Try again later.');
      }
    };
  };


  // --- API CALL HELPERS ---
  const callOrderApi = async (orderType: any, mode: string) => {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderType, mode })
    });
    return res.json();
  };
  const callCloseTradeApi = async (orderType: any, pair: string, unitsOverride: any, mode: string) => {
    const res = await fetch('/api/closeTrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderType, pair, unitsOverride, mode })
    });
    return res.json();
  };
  const callModifyTradeApi = async (orderType: any, pairOrTradeId: string, mode: string) => {
    const res = await fetch('/api/modifyTrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderType, pairOrTradeId, mode })
    });
    return res.json();
  };

  const rateLimitedBuyOanda = createRateLimitedFunction(() =>
    callOrderApi({ risk: Number(riskPercentage), orderType: TYPE.MARKET, action: ACTION.BUY, pair }, accountType)
  );
  const rateLimitedSellOanda = createRateLimitedFunction(() =>
    callOrderApi({ risk: Number(riskPercentage), orderType: TYPE.MARKET, action: ACTION.SELL, pair }, accountType)
  );

  const handleButtonClick = (functionName: string) => {
    setButtonPressed(functionName);
    switch (platform) {
      case 'oanda':
        switch (functionName) {
          case '0 - CLOSE': callCloseTradeApi({ action: ACTION.CLOSE, pair }, pair, undefined, accountType); break;
          case '1 - BUY': rateLimitedBuyOanda(); break;
          case '2 - SELL': rateLimitedSellOanda(); break;
          case '3 - SL AT ENTRY': callModifyTradeApi({ action: ACTION.SLatEntry, pair }, pair, accountType); break;
          case '4 - SL DOWN': callModifyTradeApi({ action: ACTION.MoveSL, action2: ACTION.DOWN, pair }, pair, accountType); break;
          case '5 - TP DOWN': callModifyTradeApi({ action: ACTION.MoveTP, action2: ACTION.DOWN, pair }, pair, accountType); break;
          case '6 - 25% CLOSE': callCloseTradeApi({ action: ACTION.PartialClose25, pair }, pair, undefined, accountType); break;
          case '7 - SL UP': callModifyTradeApi({ action: ACTION.MoveSL, action2: ACTION.UP, pair }, pair, accountType); break;
          case '8 - TP UP': callModifyTradeApi({ action: ACTION.MoveTP, action2: ACTION.UP, pair }, pair, accountType); break;
          case '9 - 50% CLOSE': callCloseTradeApi({ action: ACTION.PartialClose50, pair }, pair, undefined, accountType); break;
        }
        break;
    }
  };

  return (
    <>
      <div style={{ borderTop: '1px solid #ccc', margin: '10px 0' }} />


      <h2 style={{ color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
        OANDA Keyboard ({accountType.toUpperCase()})
      </h2>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Dropdown value={pair} onChange={(e) => setPair(e.target.value)}>
          {(Array.isArray(forexPairs) ? forexPairs : []).map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </Dropdown>
        <SwitchButton
          onClick={async () => {
            const newType = accountType === 'live' ? 'demo' : 'live';
            setAccountType(newType);

            if (typeof window !== 'undefined') {
              localStorage.setItem('accountType', newType);
            }

            try {
              const res = await fetch('/api/set-login-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: newType }),
              });

              const result = await res.json();
              if (!res.ok) throw new Error(result.error || 'Unknown error');
              console.log(`✅ Login mode updated to ${newType}`);
            } catch (err) {
              console.error('❌ Failed to update login mode on server:', err);
            }
          }}
        >
          Switch to {accountType === 'live' ? 'Demo' : 'Live'}
        </SwitchButton>
      </div>

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
