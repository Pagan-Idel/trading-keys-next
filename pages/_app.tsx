// pages/_app.tsx
import type { AppProps } from 'next/app';
import { createGlobalStyle } from 'styled-components';
import Link from 'next/link';

const GlobalStyle = createGlobalStyle`
  html, body, #__next {
    background: #000 !important;
    margin: 0;
    padding: 0;
    min-height: 100vh;
    width: 100vw;
    box-sizing: border-box;
  }
  * { box-sizing: border-box; }
  button, input, select { font: inherit; }
`;

const MyApp = ({ Component, pageProps }: AppProps) => {
  return (
    <>
      <GlobalStyle />
      <div
        id="app-shell"
        data-test="app-shell"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
        <div style={{ width: 'min(1420px, calc(100% - 32px))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, margin: '18px auto 26px' }}>
          <h1 id="app-title" data-test="app-title" style={{ color: '#fff', margin: 0, fontSize: '1.15rem' }}>Trading Keys</h1>
          <nav style={{ display: 'flex', gap: 8 }}>
            <Link href="/" style={{ color: '#b8c0cc', textDecoration: 'none', border: '1px solid #2d323c', background: '#15181e', borderRadius: 10, padding: '8px 12px', fontSize: 13 }}>Keyboard</Link>
            <Link href="/automation" prefetch={false} style={{ color: '#80ffa9', textDecoration: 'none', border: '1px solid #275138', background: '#102719', borderRadius: 10, padding: '8px 12px', fontSize: 13 }}>Automation</Link>
            <Link href="/strategy-lab" prefetch={false} style={{ color: '#ddb0ff', textDecoration: 'none', border: '1px solid #56316f', background: '#25132f', borderRadius: 10, padding: '8px 12px', fontSize: 13 }}>Strategy Lab</Link>
            <Link href="/backtesting" prefetch={false} style={{ color: '#ffb6f7', textDecoration: 'none', border: '1px solid #743865', background: '#301526', borderRadius: 10, padding: '8px 12px', fontSize: 13 }}>Backtesting</Link>
          </nav>
        </div>
        <main id="page-content" data-test="page-content" style={{ width: '100%' }}>
          <Component {...pageProps} />
        </main>
      </div>
    </>
  );
};

export default MyApp;
