export function roleFromGroups(groups) {
  return Array.isArray(groups) && groups.includes('admin') ? 'admin' : 'player';
}

export function userFromSession(session) {
  const payload = session?.tokens?.idToken?.payload;
  return payload ? { email: payload.email ?? '', role: roleFromGroups(payload['cognito:groups']) } : null;
}

export function signInPath(step) {
  switch (step?.signInStep) {
    case 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP': return '/mfa-setup';
    case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE': return '/mfa';
    case 'CONFIRM_SIGN_UP': return '/confirm';
    default: return '/login';
  }
}

export function returnPath(location) {
  const path = location?.pathname;
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')
    ? `${path}${location.search ?? ''}${location.hash ?? ''}` : '/';
}

export function authMessage(error) {
  const messages = {
    NotAuthorizedException: 'The email or password is incorrect, or your sign-in has expired. Please try logging in again.',
    UserNotFoundException: 'The email or password is incorrect.',
    UserNotConfirmedException: 'Confirm your email before logging in. Enter your email code or request a new one.',
    CodeMismatchException: 'That code is incorrect. Check the latest code and try again.',
    ExpiredCodeException: 'That code has expired. Request a new email code, or use the latest code in your authenticator app.',
    EnableSoftwareTokenMFAException: 'That authenticator code could not be verified. Check your phone’s automatic time and try the latest code.',
    LimitExceededException: 'Too many attempts. Please wait a few minutes before trying again.',
    TooManyRequestsException: 'Too many attempts. Please wait a few minutes before trying again.',
    TooManyFailedAttemptsException: 'Too many attempts. Please wait a few minutes before trying again.',
    UsernameExistsException: 'An account with this email already exists. Log in or confirm your email.',
    InvalidPasswordException: 'Use a stronger password that meets the user pool’s password policy.',
    NetworkError: 'Unable to connect. Check your connection and try again.',
    SignInException: 'Your sign-in has expired. Please start again from Login.',
    UnexpectedSignInStep: 'This account needs a sign-in method this app does not support. Contact the arena administrator.',
  };
  return messages[error?.name] ?? 'Unable to complete this request. Please try again.';
}

export function missingAuthVariables(env) {
  return ['VITE_COGNITO_REGION', 'VITE_COGNITO_USER_POOL_ID', 'VITE_COGNITO_CLIENT_ID']
    .filter((name) => typeof env[name] !== 'string' || !env[name].trim());
}
