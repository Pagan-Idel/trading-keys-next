import { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { ACTION, TYPE } from '../../utils/oanda/api/order';
import { forexPairs } from '../../utils/constants'
import Notification from '../Notification';

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
  width: 90px;
  height: 90px;
  color: #fff;
  background: linear-gradient(145deg, #23272f 60%, #1a1d22 100%);
  border: none;
  border-radius: 18px;
  font-size: 1.25rem;
  font-weight: 600;
  box-shadow: 0 4px 18px 0 rgba(0,0,0,0.25), 0 1.5px 0 #2d2f36 inset;
  cursor: pointer;
  transition: background 0.18s, box-shadow 0.18s, transform 0.08s;
  position: relative;
  outline: none;
  letter-spacing: 0.5px;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
  &:active {
    background: linear-gradient(145deg, #181a1f 60%, #23272f 100%);
    box-shadow: 0 2px 8px 0 rgba(0,0,0,0.18), 0 1.5px 0 #23272f inset;
    transform: scale(0.97);
  }
`;

const NumberPadContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
`;

const NumberButton = styled(Button)<{ pressed: boolean }>`
  background: ${(props) =>
    props.pressed
      ? 'linear-gradient(145deg, #ff4d4f 60%, #b71c1c 100%)'
      : 'linear-gradient(145deg, #23272f 60%, #1a1d22 100%)'};
  box-shadow: ${(props) =>
    props.pressed
      ? '0 4px 18px 0 rgba(255,77,79,0.18), 0 1.5px 0 #b71c1c inset'
      : '0 4px 18px 0 rgba(0,0,0,0.25), 0 1.5px 0 #2d2f36 inset'};
  border: ${(props) => (props.pressed ? '2px solid #ff4d4f' : '2px solid transparent')};
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  &:hover {
    background: linear-gradient(145deg, #31343b 60%, #23272f 100%);
    box-shadow: 0 6px 24px 0 rgba(0,0,0,0.32), 0 1.5px 0 #23272f inset;
  }
  &:after {
    content: attr(data-function-name);
    font-size: 12px;
    color: #bdbdbd;
    position: absolute;
    bottom: 7px;
    left: 50%;
    transform: translateX(-50%);
    pointer-events: none;
  }
`;

const PercentageButton = styled(Button)<{ selected: boolean }>`
  background: ${(props) =>
    props.selected
      ? 'linear-gradient(145deg, #00c853 60%, #009624 100%)'
      : 'linear-gradient(145deg, #23272f 60%, #1a1d22 100%)'};
  color: #fff;
  border: ${(props) => (props.selected ? '2px solid #00c853' : '2px solid transparent')};
  box-shadow: ${(props) =>
    props.selected
      ? '0 4px 18px 0 rgba(0,200,83,0.18), 0 1.5px 0 #009624 inset'
      : '0 4px 18px 0 rgba(0,0,0,0.25), 0 1.5px 0 #2d2f36 inset'};
  font-weight: 700;
  &:hover {
    background: linear-gradient(145deg, #009624 60%, #00c853 100%);
    box-shadow: 0 6px 24px 0 rgba(0,200,83,0.22), 0 1.5px 0 #009624 inset;
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



type NotificationType = 'success' | 'error' | 'warning';
interface NotificationState {
  message: string;
  type: NotificationType;
}

const Keyboard = ({ platform, pair, setPair, accountType, setAccountType }: KeyboardProps) => {
  const [riskPercentage, setRiskPercentage] = useState('1.0');
  const [pipStopLoss, setPipStopLoss] = useState<number>(6);
  const [buttonPressed, setButtonPressed] = useState<string | null>(null);
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const lastExecutionTimeRef = useRef<number>(0);
  const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const storedStopLoss = localStorage.getItem('stopLoss');
    if (storedStopLoss) {
      setPipStopLoss(Number(storedStopLoss));
    } else {
      localStorage.setItem('stopLoss', '10');
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

  // --- Notification Helper ---
  const showNotification = (message: string, type: NotificationType) => {
    setNotification({ message, type });
    if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current);
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  // --- API CALL HELPERS ---
  const callOrderApi = async (orderType: any, mode: string) => {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderType, mode })
    });
    const data = await res.json();
    if (data.success) {
      showNotification('Order placed successfully', 'success');
    } else {
      showNotification(data.error || 'Order failed', 'error');
    }
    return data;
  };
  const callCloseTradeApi = async (orderType: any, pair: string, unitsOverride: any, mode: string) => {
    const res = await fetch('/api/closeTrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderType, pair, unitsOverride, mode })
    });
    const data = await res.json();
    if (data.success) {
      showNotification('Trade closed successfully', 'success');
    } else {
      showNotification(data.error || 'Close trade failed', 'error');
    }
    return data;
  };
  const callModifyTradeApi = async (orderType: any, pairOrTradeId: string, mode: string) => {
    const res = await fetch('/api/modifyTrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderType, pairOrTradeId, mode })
    });
    const data = await res.json();
    if (data.success) {
      showNotification('Trade modified successfully', 'success');
    } else {
      showNotification(data.error || 'Modify trade failed', 'error');
    }
    return data;
  };

  const rateLimitedBuyOanda = createRateLimitedFunction(() =>
    callOrderApi({ risk: Number(riskPercentage), orderType: TYPE.MARKET, action: ACTION.BUY, pair, stopLoss: pipStopLoss.toString() }, accountType)
  );
  const rateLimitedSellOanda = createRateLimitedFunction(() =>
    callOrderApi({ risk: Number(riskPercentage), orderType: TYPE.MARKET, action: ACTION.SELL, pair, stopLoss: pipStopLoss.toString() }, accountType)
  );

  const handleButtonClick = (functionName: string) => {
    setButtonPressed(functionName);
    switch (platform) {
      case 'oanda':
        switch (functionName) {
          case '0 - CLOSE': callCloseTradeApi({ action: ACTION.CLOSE, pair }, pair, undefined, accountType); break;
          case '1 - BUY': rateLimitedBuyOanda(); showNotification('Buy order submitted', 'warning'); break;
          case '2 - SELL': rateLimitedSellOanda(); showNotification('Sell order submitted', 'warning'); break;
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
      {notification && (
        <Notification
          message={notification.message}
          type={notification.type}
          onClose={() => setNotification(null)}
          duration={5000}
        />
      )}
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
