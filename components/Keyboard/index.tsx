// NumberPad.tsx
import { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { ACTION, TYPE, order, modifyTrade, closeTrade } from '../../utils/oanda/api';
import { openMT } from '../../utils/match-trader/api/open';

const riskPercentages = ['0.25', '0.5', '1.0', '1.5', '2.0', '3.0'];
const functionNames = [
  '7 - SL UP',       // Case 7
  '8 - TP UP',       // Case 8
  '9 - Close',       // Case 9
  '4 - SL DOWN',     // Case 4
  '5 - TP DOWN',     // Case 5
  '6 - 25% Close',   // Case 6
  '1 - Buy',         // Case 1
  '2 - Sell',        // Case 2
  '3 - SL at Entry', // Case 3
  '0'             // Case 0
];

// Define the type for the props
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

const NumberButton = styled(Button) <{ pressed: boolean }>`
  background-color: ${(props) => (props.pressed ? '#e74c3c' : '#3498db')};
  height: 80px; /* Ensure consistent height */
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
  height: 80px; /* Ensure consistent height */
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background-color: ${(props) => (props.selected ? '#27ae60' : '#2980b9')};
  }
`;

const PipContainer = styled.div`
  position: relative;
  display: flex;
  align-items: center;
`;

const PipStopLossDisplay = styled.div`
  font-size: 18px;
  color: white;
  margin-right: 10px; /* Adjust the margin as needed */
`;

const PipStopLoss = styled.input.attrs({ type: 'range', min: 1, max: 20, step: 1 })`
  width: 100%;
  -webkit-appearance: none;
  height: 10px;
  background: #dcdcdc;
  outline: none;
  opacity: 0.7;
  -webkit-transition: .2s;
  transition: opacity .2s;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    background: #3498db;
    border-radius: 50%;
    cursor: pointer;
    margin-top: -5px;
    position: relative;
  }

  &::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: #3498db;
    border-radius: 50%;
    cursor: pointer;
    position: relative;
  }

  &::-webkit-slider-runnable-track {
    width: 100%;
    height: 10px;
    background: #dcdcdc;
    border-radius: 3px;
  }

  &::-moz-range-track {
    width: 100%;
    height: 10px;
    background: #dcdcdc;
    border-radius: 3px;
  }

  &::-webkit-slider-thumb::before,
  &::-moz-range-thumb::before {
    content: attr(value);
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #fff;
    font-size: 12px;
  }
`;

export interface OrderParameters {
  orderType?: TYPE;
  price?: string;
  action?: ACTION;
  action2?: ACTION;
  risk?: number;
  orderId?: string;
}

const Keyboard = ({ platform }: KeyboardProps) => {
  const [riskPercentage, setRiskPercentage] = useState('1.0');
  const [pipStopLoss, setPipStopLoss] = useState<number>(6); // Initial value set to 6
  const [buttonPressed, setButtonPressed] = useState<string | null>(null);


  const handleKeyPress = (event: KeyboardEvent) => {
    const key = event.key;

    // Check if key is a valid string representation of a number
    if (/^[0-9]$/.test(key)) {
      const functionName = functionNames.find(name => name.includes(key));
      if (functionName) {
        handleButtonClick(functionName);
      }
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, []); // Empty dependency array to ensure the effect runs only once on mount

  useEffect(() => {
    // Set initial value of Pip Stop Loss in local storage on component mount
    const storedStopLoss = localStorage.getItem('stopLoss');
    if (storedStopLoss) {
      setPipStopLoss(Number(storedStopLoss));
    } else {
      localStorage.setItem('stopLoss', '6');
    }
  }, []);

  const handlePipStopLossChange = (value: number) => {
    // Update Pip Stop Loss value in local storage
    localStorage.setItem('stopLoss', value.toString());
    setPipStopLoss(value);
  };

  const handlePercentageButtonClick = (percentage: string) => {
    setRiskPercentage(percentage);
  };

  function createRateLimitedFunction(callback: () => void) {
    return function () {
      const currentTime = Date.now();

      if (currentTime - lastExecutionTimeRef.current >= 5000) {
        lastExecutionTimeRef.current = currentTime;
        callback();
      } else {
        console.log('Function is rate-limited. Try again later.');
      }
    };
  }
  const lastExecutionTimeRef = useRef<number>(0);
  const rateLimitedBuyOanda = createRateLimitedFunction(() => order({ risk: Number(riskPercentage), orderType: TYPE.MARKET, action: ACTION.BUY }));
  const rateLimitedSellOanda = createRateLimitedFunction(() => order({ risk: Number(riskPercentage), orderType: TYPE.MARKET, action: ACTION.SELL }));
  const rateLimitedBuyMT = createRateLimitedFunction(() => openMT(Number(riskPercentage), ACTION.BUY));
  const rateLimitedSellMT = createRateLimitedFunction(() => openMT(Number(riskPercentage), ACTION.SELL));
  const handleButtonClick = (functionName: string) => {
    setButtonPressed(functionName);
    // const functionNames = [
    //   '7 - SL UP',       // Case 7
    //   '8 - TP UP',       // Case 8
    //   '9 - Close',       // Case 9
    //   '4 - SL DOWN',     // Case 4
    //   '5 - TP DOWN',     // Case 5
    //   '6 - 25% Close',   // Case 6
    //   '1 - BUY',         // Case 1
    //   '2- Sell',        // Case 2
    //   '3 - SL at Entry', // Case 3
    //   '0'             // Case 0
    // ];
    switch (platform) {
      case 'oanda':
        switch (functionName) {
          case '0':
            // Handle the case when button 0 is clicked for Oanda
            break;
          case '1 - Buy':
            rateLimitedBuyOanda();
            console.log(`Button 1 clicked with ${riskPercentage}`);
            break;
          case '2 - Sell':
            rateLimitedSellOanda();
            console.log(`Button 2 clicked with ${riskPercentage}`);
            break;
          case '3 - SL at Entry':
            modifyTrade({ action: ACTION.SLatEntry });
            console.log(`Button 3 clicked with ${riskPercentage}`);
            break;
          case '4 - SL DOWN':
            modifyTrade({ action: ACTION.MoveSL, action2: ACTION.DOWN });
            console.log(`Button 4 clicked with ${riskPercentage}`);
            break;
          case '5 - TP DOWN':
            modifyTrade({ action: ACTION.MoveTP, action2: ACTION.DOWN });
            console.log(`Button 5 clicked with ${riskPercentage}`);
            break;
          case '6 - 25% Close':
            closeTrade({ action: ACTION.PartialClose });
            console.log(`Button 6 clicked with ${riskPercentage}`);
            break;
          case '7 - SL UP':
            modifyTrade({ action: ACTION.MoveSL, action2: ACTION.UP });
            console.log(`Button 7 clicked with ${riskPercentage}`);
            break;
          case '8 - TP UP':
            modifyTrade({ action: ACTION.MoveTP, action2: ACTION.UP });
            console.log(`Button 8 clicked with ${riskPercentage}`);
            break;
          case '9 - Close':
            closeTrade({ action: ACTION.CLOSE });
            console.log(`Button 9 clicked with ${riskPercentage}`);
            break;
          default:
            // Handle default case
            break;
        }
        break;
    
      case 'dxtrade':
        switch (functionName) {
          case '0':
            // Handle the case when button 0 is clicked for dxtrade
            break;
          case '1 - Buy':
            // rateLimitedBuyOanda();
            console.log(`Button 1 clicked with ${riskPercentage}`);
            break;
          case '2 - Sell':
            // rateLimitedSellOanda();
            console.log(`Button 2 clicked with ${riskPercentage}`);
            break;
          case '3 - SL at Entry':
            // modifyTrade({ action: ACTION.SLatEntry });
            console.log(`Button 3 clicked with ${riskPercentage}`);
            break;
          case '4 - SL DOWN':
            // modifyTrade({ action: ACTION.MoveSL, action2: ACTION.DOWN });
            console.log(`Button 4 clicked with ${riskPercentage}`);
            break;
          case '5 - TP DOWN':
            // modifyTrade({ action: ACTION.MoveTP, action2: ACTION.DOWN });
            console.log(`Button 5 clicked with ${riskPercentage}`);
            break;
          case '6 - 25% Close':
            // closeTrade({ action: ACTION.PartialClose });
            console.log(`Button 6 clicked with ${riskPercentage}`);
            break;
          case '7 - SL UP':
            // modifyTrade({ action: ACTION.MoveSL, action2: ACTION.UP });
            console.log(`Button 7 clicked with ${riskPercentage}`);
            break;
          case '8 - TP UP':
            // modifyTrade({ action: ACTION.MoveTP, action2: ACTION.UP });
            console.log(`Button 8 clicked with ${riskPercentage}`);
            break;
          case '9 - Close':
            // closeTrade({ action: ACTION.CLOSE });
            console.log(`Button 9 clicked with ${riskPercentage}`);
            break;
          default:
            // Handle default case
            break;
        }
        break;
    
      case 'match-trader':
        switch (functionName) {
          case '0':
            // Handle the case when button 0 is clicked for match-trader
            break;
          case '1 - Buy':
            rateLimitedBuyMT();
            console.log(`Button 1 clicked with ${riskPercentage}`);
            break;
          case '2 - Sell':
            rateLimitedSellMT();
            console.log(`Button 2 clicked with ${riskPercentage}`);
            break;
          case '3 - SL at Entry':
            
            console.log(`Button 3 clicked with ${riskPercentage}`);
            break;
          case '4 - SL DOWN':
            
            console.log(`Button 4 clicked with ${riskPercentage}`);
            break;
          case '5 - TP DOWN':
           
            console.log(`Button 5 clicked with ${riskPercentage}`);
            break;
          case '6 - 25% Close':
            
            console.log(`Button 6 clicked with ${riskPercentage}`);
            break;
          case '7 - SL UP':
            
            console.log(`Button 7 clicked with ${riskPercentage}`);
            break;
          case '8 - TP UP':
            
            console.log(`Button 8 clicked with ${riskPercentage}`);
            break;
          case '9 - Close':
            
            console.log(`Button 9 clicked with ${riskPercentage}`);
            break;
          default:
            // Handle default case
            break;
        }
        break;
    
      default:
        // Handle default case for unknown platform
        break;
    }    
  };

  return (
    <>
      <div style={{ borderTop: '1px solid #ccc', margin: '10px 0' }} />
      <h2 style={{ color: 'white' }}>Risk Percent</h2>
      <NumberPadContainer>
        {riskPercentages.map((percentage, idx) => (
          <PercentageButton
            key={idx}
            selected={riskPercentage === percentage}
            onClick={() => handlePercentageButtonClick(percentage)}
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
            pressed={name == buttonPressed}
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
