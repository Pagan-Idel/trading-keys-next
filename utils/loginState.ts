// utils/loginState.ts

let loginMode: 'live' | 'demo' = 'demo';

export function setLoginMode(mode: 'live' | 'demo') {
  loginMode = mode;
}

export function getLoginMode(): 'live' | 'demo' {
  return loginMode;
}

export function isLiveMode(): boolean {
    return loginMode === 'live';
}
