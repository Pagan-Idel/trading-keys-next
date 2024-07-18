// pages/_app.tsx
import styled from 'styled-components';
import Account from '../components/Account';
import type { AppProps } from 'next/app';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: black;
`;
const MyApp = ({ Component, pageProps }: AppProps) => {
  return (
    <Container style={{height: '100vh'}}>
      <h1>Trading Keys</h1>
      <Account/>
    </Container>
  );
}

export default MyApp;
