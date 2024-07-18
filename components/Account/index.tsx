import { useState, useEffect, ChangeEvent } from 'react';
import styled from 'styled-components';
import Keyboard from '../Keyboard';
import { accountInfo } from '../../utils/oanda/api';
import { handleLogin } from '../../utils/dxtrade/api';

// Dark mode color variables
const darkBackgroundColor = '#333333';
const darkBorderColor = '#555555';
const darkTextColor = '#ffffff';
const darkButtonColor = '#007BFF';
const darkButtonHoverColor = '#0056b3';

const Container = styled.div`
  background-color: ${darkBackgroundColor};
  border: 1px solid ${darkBorderColor};
  border-radius: 8px;
  padding: 20px;
  margin: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const Content = styled.div`
`;

const Input = styled.input`
  margin-bottom: 5px;
  padding: 8px;
  font-size: 16px;
  border: 1px solid ${darkBorderColor};
  color: ${darkTextColor};
  background-color: ${darkBackgroundColor};
`;

const Select = styled.select`
  margin-bottom: 10px;
  padding: 8px;
  font-size: 16px;
  border: 1px solid ${darkBorderColor};
  color: ${darkTextColor};
  background-color: ${darkBackgroundColor};
  margin-right: 20px;
  height: 40px !important;
`;

const Button = styled.button`
  padding: 10px 20px;
  font-size: 16px;
  background-color: ${darkButtonColor};
  color: ${darkTextColor};
  border: none;
  cursor: pointer;
  &:hover {
    background-color: ${darkButtonHoverColor};
  }
`;

const ButtonsContainer = styled.div`
  display: flex;
  margin-top: 10px;
  justify-content: space-between; /* Add this line to distribute space equally */
`;

const BlueButton = styled(Button)`
  flex: 1; /* Add this line to make the buttons share the available space equally */
  background-color: ${darkButtonColor};
  color: ${darkTextColor};
  margin-right: 10px;
`;

const InputLabel = styled.label`
  margin-bottom: 10px;
  color: ${darkTextColor};
`;

const Account: React.FC = () => {
  const [platform, setPlatform] = useState('');
  const [token, setToken] = useState<string>('');
  const [accountType, setAccountType] = useState<string>('demo');
  const [isTokenSet, setIsTokenSet] = useState<boolean>(false);
  const [isAccountSet, setIsAccountSet] = useState<boolean>(false);
  const [tokenError, setTokenError] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);

  useEffect(() => {
    // Check if token is present in localStorage
    const storedToken = localStorage.getItem('token');
    if (storedToken) {
      setToken(storedToken);
      setIsTokenSet(true);
    }

    // Check if accountEnv and accountId are present in localStorage
    const storedAccountEnv = localStorage.getItem('accountEnv');
    const storedAccountId = localStorage.getItem('accountId');
    if (storedAccountEnv && storedAccountId && platform == 'oanda') {
      setAccountType(storedAccountEnv === 'https://api-fxtrade.oanda.com' ? 'live' : 'demo');
      setIsAccountSet(true);
    } else if (platform == 'dxtrade') {
     // TODO: what do we do with the local variables
    }
  }, []);

  useEffect(() => {
    // Check and set connected based on accountInfo data
    if (platform == 'oanda' && isAccountSet && isTokenSet) {
      accountInfo().then((data) => {
        if (!data.errorMessage) {
          setConnected(true);
        } else {
          setIsTokenSet(false);
        }
      });
    } else if (platform == 'dxtrade' && isAccountSet ){ 
      console.log("We made it here");
      handleLogin(accountType);
    }
  }, [isAccountSet]);

  const handlePlatformChange = () => {
    setPlatform('');
    resetTokenInLocalStorage();
    resetAccountInLocalStorage();
  };
  
  const handleTokenChange = (event: ChangeEvent<HTMLInputElement>) => {
    setToken(event.target.value);
    setTokenError(false);
  };

  const setTokenToLocalStorage = () => {
    if (token.trim() === '') {
      setTokenError(true);
      return;
    }

    localStorage.setItem('token', token.trim());
    setIsTokenSet(true);
  };

  const resetTokenInLocalStorage = () => {
    localStorage.removeItem('token');
    setToken('');
    setIsTokenSet(false);
  };

  const handleConnected = () => {
    localStorage.removeItem('token');
    setToken('');
    setIsTokenSet(false);
  };

  const setAccountToLocalStorage = () => {
    let env: string;
    let accountId: string;

    if (platform === 'oanda') {

      env = accountType === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
      localStorage.setItem('accountEnv', env);
      accountId = accountType === 'live' ? '[redacted]' : '[redacted]';
      localStorage.setItem('accountId', accountId);
      setIsAccountSet(true);
    } else if (platform === 'dxtrade') {

      env = accountType === 'live' ? 'https://dx.trade' : 'https://demo.dx.trade';
      localStorage.setItem('accountEnv', env);
      accountId = accountType === 'live' ? '[redacted]' : '[redacted]';
      localStorage.setItem('accountId', accountId);
      setIsAccountSet(true);
    }

  };

  const resetAccountInLocalStorage = () => {
    localStorage.removeItem('accountEnv');
    localStorage.removeItem('accountId');
    setAccountType('live');
    setIsAccountSet(false);
  };

  return (
    <Container>
      <Content>
        <h2 style={{ color: 'white' }}>
          {platform ? `Platform - ${platform.toUpperCase()} - ${accountType.toUpperCase()}` : `Select Platform`}
        </h2>
        {!platform ? (
          <>
            <InputLabel htmlFor="platformSelect">Select Platform</InputLabel>
            <ButtonsContainer>
              <BlueButton onClick={() => setPlatform('oanda')}>Oanda</BlueButton>
              <BlueButton onClick={() => setPlatform('dxtrade')}>DxTrade</BlueButton>
            </ButtonsContainer>
          </>
        ) : (
          <ButtonsContainer>
            <BlueButton onClick={handlePlatformChange}>Change Platform</BlueButton>
          </ButtonsContainer>
        )}
  
        {platform && (
          <>
            {platform === 'oanda' && !isTokenSet && (
              <>
                <InputLabel htmlFor="tokenInput">Token = </InputLabel>
                <Input
                  type="text"
                  id="tokenInput"
                  placeholder="Enter token"
                  value={token}
                  onChange={handleTokenChange}
                  style={{ border: tokenError ? '1px solid red' : '1px solid #e0e0e0' }}
                />
                <ButtonsContainer>
                  <BlueButton onClick={setTokenToLocalStorage}>Set Token</BlueButton>
                </ButtonsContainer>
              </>
            )}
            {platform === 'oanda' && isTokenSet && (
              <>
                <ButtonsContainer>
                  <BlueButton onClick={resetTokenInLocalStorage}>Reset Token</BlueButton>
                </ButtonsContainer>
              </>
            )}
  
            {!isAccountSet && (
              <>
                <InputLabel htmlFor="accountType">Select Account Type</InputLabel>
                <ButtonsContainer>
                  <Select
                    style={{ height: '40px' }}
                    id="accountType"
                    value={accountType}
                    onChange={(e) => setAccountType(e.target.value)}
                  >
                    <option value="live">Live</option>
                    <option value="demo">Demo</option>
                  </Select>
                  <BlueButton onClick={setAccountToLocalStorage}>Login</BlueButton>
                </ButtonsContainer>
              </>
            )}
            {isAccountSet && (
              <>
                <ButtonsContainer>
                  <BlueButton onClick={resetAccountInLocalStorage}>
                    Switch To {accountType === 'live' ? 'Demo' : 'Live'} Account
                  </BlueButton>
                </ButtonsContainer>
              </>
            )}
            {isAccountSet && isTokenSet && connected ? (
              <>
                <Keyboard platform={platform} />
              </>
            ) : null}
          </>
        )}
      </Content>
    </Container>
  );
};

export default Account;
