import { useState, useEffect } from 'react';
import styled from 'styled-components';
import Keyboard from '../Keyboard';
import { handleOandaLogin } from '../../utils/oanda/api';
import { handleMTLogin } from '../../utils/match-trader/api/login';
import { marketWatchMT } from '../../utils/match-trader/api/market-watch';

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

const Content = styled.div``;

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

const Account = () => {
  const [platform, setPlatform] = useState<string | null>(null);
  const [accountType, setAccountType] = useState<string>('');
  const [isLoginSuccessful, setIsLoginSuccessful] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  // Handle resetting platform
  const handlePlatformChange = () => {
    if (typeof window !== 'undefined') {
      localStorage.clear();
    }
    setPlatform(null);
    setAccountType('');
    setIsLoginSuccessful(false);
  };

  // Handle login for different platforms
  const handleLogin = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('platform', platform!);
      localStorage.setItem('accountType', accountType);
    }

    if (platform === 'oanda' && accountType !== '') {
      handleOandaLogin().then((data) => {
        handleLoginResponse(data);
      });
    } else if (platform === 'match-trader' && accountType !== '') {
      handleMTLogin(accountType).then((data) => {
        if ('token' in data) {
          setIsLoginSuccessful(true);
          setMessage("Logged In Successfully");
          setTimeout(() => {
            setMessage(null);
          }, 3000);
          marketWatchMT().then(() => {});
        } else {
          setIsLoginSuccessful(false);
          setMessage(`Error Logging In: ${data.errorMessage}`);
          setTimeout(() => {
            setMessage(null);
          }, 3000);
        }
      });
    }
  };

  // Helper to handle login responses
  const handleLoginResponse = (data: any) => {
    if (!data.errorMessage) {
      setIsLoginSuccessful(true);
      setMessage("Logged In Successfully");
      setTimeout(() => {
        setMessage(null);
      }, 3000);
    } else {
      setIsLoginSuccessful(false);
      setMessage("Error Logging In");
      setTimeout(() => {
        setMessage(null);
      }, 3000);
    }
  };

  // Load platform and accountType from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedPlatform = localStorage.getItem('platform');
      const storedAccountType = localStorage.getItem('accountType');
      if (storedPlatform) setPlatform(storedPlatform);
      if (storedAccountType) setAccountType(storedAccountType);
    }
  }, []);

  return (
    <Container>
      <Content>
        <h2 style={{ color: 'white' }}>
          {platform ? `${platform.toUpperCase()} ${accountType.toUpperCase()}` : `Select Platform`}
        </h2>
        {!platform ? (
          <>
            <InputLabel>Select Platform</InputLabel>
            <ButtonsContainer>
              <BlueButton onClick={() => setPlatform('oanda')}>Oanda</BlueButton>
              <BlueButton onClick={() => setPlatform('match-trader')}>Match Trader</BlueButton>
            </ButtonsContainer>
          </>
        ) : (
          <ButtonsContainer>
            <BlueButton onClick={handlePlatformChange}>Change Platform</BlueButton>
          </ButtonsContainer>
        )}

        {platform && accountType === '' && !isLoginSuccessful && (
          <>
            <br />
            <InputLabel>Select Account</InputLabel>
            <ButtonsContainer>
              <BlueButton onClick={() => setAccountType('live')}>Live</BlueButton>
              <BlueButton onClick={() => setAccountType('demo')}>Demo</BlueButton>
            </ButtonsContainer>
          </>
        )}

        {accountType && !isLoginSuccessful && (
          <ButtonsContainer>
            <BlueButton onClick={() => setAccountType(accountType === 'live' ? 'demo' : 'live')}>
              Switch To {accountType === 'live' ? 'Demo' : 'Live'} Account
            </BlueButton>
          </ButtonsContainer>
        )}

        {platform && accountType && !isLoginSuccessful && (
          <ButtonsContainer>
            <BlueButton onClick={handleLogin}>Login</BlueButton>
          </ButtonsContainer>
        )}

        {isLoginSuccessful ? (
          <>
            {message && (
              <div
                style={{
                  backgroundColor: message.includes('Error') ? '#333333' : 'green',
                  color: 'white',
                  padding: '10px',
                  borderRadius: '5px',
                  margin: '10px 0',
                }}>
                {message}
              </div>
            )}
            <Keyboard platform={platform!} />
          </>
        ) : (
          <>
            {message && (
              <div
                style={{
                  backgroundColor: message.includes('Error') ? 'red' : '#333333',
                  color: 'white',
                  padding: '10px',
                  borderRadius: '5px',
                  margin: '10px 0',
                }}>
                {message}
              </div>
            )}
          </>
        )}
      </Content>
    </Container>
  );
};

export default Account;
