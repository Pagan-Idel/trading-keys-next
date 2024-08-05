// authCookieStore.ts
let authCookieStore: { [key: string]: string } = {};

export const setAuthCookie = (key: string, value: string) => {
  authCookieStore[key] = value;
};

export const getAuthCookie = (key: string) => {
  return authCookieStore[key];
};

export default { setAuthCookie, getAuthCookie };
