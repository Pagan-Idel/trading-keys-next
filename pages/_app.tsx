// pages/_app.tsx
import type { AppProps } from 'next/app';
import { createGlobalStyle } from 'styled-components';

const GlobalStyle = createGlobalStyle`
  html, body, #__next {
    background: #000 !important;
    margin: 0;
    padding: 0;
    min-height: 100vh;
    width: 100vw;
    box-sizing: border-box;
  }
`;

const MyApp = ({ Component, pageProps }: AppProps) => {
  return (
    <>
      <GlobalStyle />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <h1 style={{ color: '#fff' }}>Trading Keys</h1>
        <Component {...pageProps} />
      </div>
    </>
  );
};

export default MyApp;
