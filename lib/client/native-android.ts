// UX detection only: this user-agent marker never grants server-side authority.
export function isNativeAndroidWebView(userAgent?: string): boolean {
  const value = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return /\bBurgerBrothers-Android\/(?:main|driver|schnell)(?=\s|$)/.test(value);
}
