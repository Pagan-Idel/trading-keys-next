import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { handleOandaLogin } from '../../utils/oanda/api/login';

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
  justify-content: space-between;
`;

const BlueButton = styled(Button)`
  flex: 1;
  background-color: ${darkButtonColor};
  color: ${darkTextColor};
  margin-right: 10px;
`;

const InputLabel = styled.label`
  margin-bottom: 10px;
  color: ${darkTextColor};
`;

interface AccountProps {
  onLoginSuccess?: (platform: string, accountType: string) => void;
}

const Account: React.FC<AccountProps> = ({ onLoginSuccess }) => {
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
      handleOandaLogin(undefined, accountType as 'live' | 'demo').then((data) => {
        handleLoginResponse(data);
      });
    }
  };

  // Helper to handle login responses
  const handleLoginResponse = (data: any) => {
    if (!data.errorMessage) {
      setIsLoginSuccessful(true);
      setMessage("Logged In Successfully");
      if (onLoginSuccess && platform && accountType) {
        onLoginSuccess(platform, accountType);
      }
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
        <h2 style={{ color: 'white', marginBottom: 16 }}>
          OANDA {accountType ? accountType.toUpperCase() : ''}
        </h2>
        {isLoginSuccessful ? (
          <ButtonsContainer>
            <BlueButton onClick={handlePlatformChange}>Change Account</BlueButton>
          </ButtonsContainer>
        ) : (
          <>
            <InputLabel>Select Account</InputLabel>
            <ButtonsContainer>
              <BlueButton onClick={() => setAccountType('live')}>Live</BlueButton>
              <BlueButton onClick={() => setAccountType('demo')}>Demo</BlueButton>
            </ButtonsContainer>
            {accountType && (
              <ButtonsContainer>
                <BlueButton onClick={() => setAccountType(accountType === 'live' ? 'demo' : 'live')}>
                  Switch To {accountType === 'live' ? 'Demo' : 'Live'} Account
                </BlueButton>
              </ButtonsContainer>
            )}
            {accountType && !isLoginSuccessful && (
              <ButtonsContainer>
                <BlueButton onClick={handleLogin}>Login</BlueButton>
              </ButtonsContainer>
            )}
          </>
        )}

        {message && (
          <div
            style={{
              backgroundColor: message.includes('Error')
                ? (isLoginSuccessful ? '#333333' : 'red')
                : (isLoginSuccessful ? 'green' : '#333333'),
              color: 'white',
              padding: '10px',
              borderRadius: '5px',
              margin: '10px 0',
            }}>
            {message}
          </div>
        )}
      </Content>
    </Container>
  );
};
