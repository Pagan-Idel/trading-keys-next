import { useState, useEffect, ChangeEvent } from 'react';
import styled from 'styled-components';
import Keyboard from '../Keyboard';
import { handleOandaLogin } from '../../utils/oanda/api';
import { handleDXLogin } from '../../utils/dxtrade/api';
import { handleMTLogin } from '../../utils/match-trader/api';

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

const Account = () => {
  const [platform, setPlatform] = useState('');
  const [token, setToken] = useState<string>('');
  const [accountType, setAccountType] = useState<string>('');
  const [isLoginSuccessful, setIsLoginSuccessful] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  const handlePlatformChange = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('platform');
    localStorage.removeItem('accountType');
    localStorage.removeItem('accountId');
    setPlatform('');
    setAccountType('');
    setToken('');
    setIsLoginSuccessful(false);
  };
  
  const handleTokenInput = (event: ChangeEvent<HTMLInputElement>) => {
    setToken(event.target.value);
  };

  const handleLogin = () => {
    localStorage.setItem('platform', platform);
    localStorage.setItem('accountType', accountType);
    if (platform === 'oanda') {
      localStorage.setItem('token', token);
    }
    if (platform == 'oanda' && accountType !== '' && token !== '') {
      handleOandaLogin().then((data) => {
        if (!data.errorMessage) {
          setIsLoginSuccessful(true);
          setMessage("Logged In Succesful");
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
      });
    } else if (platform == 'dxtrade' && accountType !== '' ){ 
      // Support for DX API still needed.
      // handleDXLogin(accountType).then((data) => {
      //   if (!data.errorMessage) {
      //     setIsLoginSuccessful(true);
      //     setMessage("Logged In Succesful");
      //     setTimeout(() => {
      //       setMessage(null);
      //     }, 3000);
      //   } else {
      //     setIsLoginSuccessful(false);
      //     setMessage("Error Logging In");
      //     setTimeout(() => {
      //       setMessage(null);
      //     }, 3000);
      //   }
      // });
    } else if (platform == 'match-trader' && accountType !== ''){ 
      handleMTLogin(accountType).then((data) => {
        if ('token' in data) {
          setIsLoginSuccessful(true);
          setMessage("Logged In Successfully");
          setTimeout(() => {
            setMessage(null);
          }, 3000);
        } else {
          setIsLoginSuccessful(false);
          setMessage("Error Logging In: " + data.errorMessage);
          setTimeout(() => {
            setMessage(null);
          }, 3000);
        }
      });
    }
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
              <BlueButton disabled={true} onClick={() => setPlatform('dxtrade')}>DxTrade</BlueButton>
              <BlueButton onClick={() => setPlatform('match-trader')}>Match Trader</BlueButton>
            </ButtonsContainer>
          </>
        ) : (
          <ButtonsContainer>
            <BlueButton onClick={handlePlatformChange}>Change Platform</BlueButton>
          </ButtonsContainer>
        )}
  
        {platform == 'oanda' && !isLoginSuccessful &&(
              <>
                <br />
                <InputLabel htmlFor="tokenInput">Token </InputLabel>
                <Input
                  type="text"
                  id="tokenInput"
                  placeholder="Type token"
                  value={token}
                  onChange={handleTokenInput}
                  style={{ border: '1px solid #e0e0e0' }}
                />
              </>
            )}
  
            {platform !== '' && accountType == '' && !isLoginSuccessful  && (
              <>
              <br />
              <InputLabel htmlFor="login">Select Account</InputLabel>
              <ButtonsContainer>
                <BlueButton onClick={() => setAccountType('live')}>Live</BlueButton>
                <BlueButton onClick={() => setAccountType('demo')}>Demo</BlueButton>
              </ButtonsContainer>
            </>
            )}
            {accountType !== '' && isLoginSuccessful == false && (
              <>
                <ButtonsContainer>
                  <BlueButton onClick={() => setAccountType(accountType === 'live' ? 'demo' : 'live')}>
                    Switch To {accountType === 'live' ? 'Demo' : 'Live'} Account
                  </BlueButton>
                </ButtonsContainer>
              </>
            )}
            {platform !== '' && accountType !== '' && !isLoginSuccessful && (
              <>
                <ButtonsContainer>
                  <BlueButton onClick={() => handleLogin()}>Login</BlueButton>
                </ButtonsContainer>
              </>
            )}

            {isLoginSuccessful ? (
              <>              
                {message && (<div style={{ 
                  backgroundColor: message?.includes('Error') ? '#333333' : 'green', 
                  color: 'white', 
                  padding: '10px', 
                  borderRadius: '5px', 
                  margin: '10px 0' 
                }}>{message}</div>)}
                <Keyboard platform={platform} />
              </>
            ) : (<>              
               {message && (<div style={{ 
                  backgroundColor: message?.includes('Error') ? 'red' : '#333333', 
                  color: 'white', 
                  padding: '10px', 
                  borderRadius: '5px', 
                  margin: '10px 0' 
                }}>{message}</div>)}
          </> )}
      </Content>
    </Container>
  );
};

export default Account;
