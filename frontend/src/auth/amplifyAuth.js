// Everything that needs aws-amplify, behind one dynamic import (see session.js). Importing amplify.js configures Amplify first.
// Named re-exports (not a namespace) so unused auth functions stay tree-shaken out of the chunk.
import './amplify.js';

export { Hub } from 'aws-amplify/utils';
export {
  confirmResetPassword, confirmSignIn, confirmSignUp, fetchAuthSession, fetchMFAPreference, resendSignUpCode, resetPassword,
  setUpTOTP, signIn, signOut, signUp, updateMFAPreference, verifyTOTPSetup,
} from 'aws-amplify/auth';
