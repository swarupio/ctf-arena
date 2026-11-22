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
    // Cognito uses one code for a wrong password and for an expired sign-in, so one text covers both and never says whether the account exists.
    NotAuthorizedException: 'We could not sign you in with those details. Check your email and password and try again, or use Forgot password. If you waited a while, start again from Login.',
    UserNotFoundException: 'We could not sign you in with those details. Check your email and password and try again, or use Forgot password. If you waited a while, start again from Login.',
    UserNotConfirmedException: 'Confirm your email before logging in. Enter your email code or request a new one.',
    CodeMismatchException: 'That code is incorrect. Check the latest code and try again.',
    ExpiredCodeException: 'That code has expired. Request a new email code, or use the latest code in your authenticator app.',
    EnableSoftwareTokenMFAException: 'That authenticator code could not be verified. Check your phone’s automatic time and try the latest code.',
    LimitExceededException: 'Too many attempts. Please wait a few minutes before trying again.',
    TooManyRequestsException: 'Too many attempts. Please wait a few minutes before trying again.',
    TooManyFailedAttemptsException: 'Too many attempts. Please wait a few minutes before trying again.',
    UsernameExistsException: 'An account with this email already exists. Log in or confirm your email.',
    InvalidPasswordException: 'That password is not strong enough for this account. Try a longer one (a few random words work well) and avoid common words or your email.',
    NetworkError: 'Unable to connect. Check your connection and try again.',
    SignInException: 'Your sign-in has expired. Please start again from Login.',
    UnexpectedSignInStep: 'This account needs a sign-in step this app does not support yet. Start again from Login, and if it keeps happening, ask the event organiser who invited you.',
  };
  return messages[error?.name] ?? 'Unable to complete this request. Please try again.';
}

export function missingAuthVariables(env) {
  return ['VITE_COGNITO_REGION', 'VITE_COGNITO_USER_POOL_ID', 'VITE_COGNITO_CLIENT_ID']
    .filter((name) => typeof env[name] !== 'string' || !env[name].trim());
}

// Copies a setup key. Resolves 'copied' or 'failed' (the page then selects the text so the user can copy by hand). Never logs the value.
export async function copyText(text, clipboard) {
  if (typeof text !== 'string' || !text || typeof clipboard?.writeText !== 'function') return 'failed';
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export function copyStatusText(result) {
  if (result === 'copied') return 'Copied';
  if (result === 'failed') return 'Could not copy. The key is selected: press Ctrl+C (or tap and hold) to copy it.';
  return '';
}
