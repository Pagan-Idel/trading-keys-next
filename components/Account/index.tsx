import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { buildDomId, buildDataTestId } from '../../utils/dom';


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
      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair: undefined, mode: accountType })
      })
        .then(res => res.json())
        .then(data => handleLoginResponse(data));
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

  const containerId = buildDomId('account', platform ?? 'none', accountType || 'unset');
  const containerTestId = buildDataTestId('account', platform ?? 'none', accountType || 'unset');

  return (
    <Container id={containerId} data-test={containerTestId}>
      <Content id={`${containerId}-content`} data-test={buildDataTestId('account', 'content')}>
        <h2
          id={`${containerId}-title`}
          data-test={buildDataTestId('account', 'title')}
          style={{ color: 'white', marginBottom: 16 }}
        >
          OANDA {accountType ? accountType.toUpperCase() : ''}
        </h2>
        {isLoginSuccessful ? (
          <ButtonsContainer
            id={`${containerId}-actions-success`}
            data-test={buildDataTestId('account', 'actions-success')}
          >
            <BlueButton
              id={`${containerId}-change-account`}
              data-test={buildDataTestId('account', 'change-account')}
              onClick={handlePlatformChange}
            >
              Change Account
            </BlueButton>
          </ButtonsContainer>
        ) : (
          <>
            <InputLabel
              id={`${containerId}-select-label`}
              data-test={buildDataTestId('account', 'select-label')}
            >
              Select Account
            </InputLabel>
            <ButtonsContainer
              id={`${containerId}-account-buttons`}
              data-test={buildDataTestId('account', 'account-buttons')}
            >
              <BlueButton
                id={`${containerId}-select-live`}
                data-test={buildDataTestId('account', 'select-live')}
                onClick={() => setAccountType('live')}
              >
                Live
              </BlueButton>
              <BlueButton
                id={`${containerId}-select-demo`}
                data-test={buildDataTestId('account', 'select-demo')}
                onClick={() => setAccountType('demo')}
              >
                Demo
              </BlueButton>
            </ButtonsContainer>
            {accountType && (
              <ButtonsContainer
                id={`${containerId}-switch-buttons`}
                data-test={buildDataTestId('account', 'switch-buttons')}
              >
                <BlueButton
                  id={`${containerId}-switch-${accountType}`}
                  data-test={buildDataTestId('account', 'switch', accountType)}
                  onClick={() => setAccountType(accountType === 'live' ? 'demo' : 'live')}
                >
                  Switch To {accountType === 'live' ? 'Demo' : 'Live'} Account
                </BlueButton>
              </ButtonsContainer>
            )}
            {accountType && !isLoginSuccessful && (
              <ButtonsContainer
                id={`${containerId}-login-button`}
                data-test={buildDataTestId('account', 'login-button')}
              >
                <BlueButton
                  id={`${containerId}-login`}
                  data-test={buildDataTestId('account', 'login')}
                  onClick={handleLogin}
                >
                  Login
                </BlueButton>
              </ButtonsContainer>
            )}
          </>
        )}

        {message && (
          <div
            id={`${containerId}-message`}
            data-test={buildDataTestId('account', 'message')}
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

export default Account;
