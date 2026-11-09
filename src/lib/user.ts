// We identify the person by the Google account signed in to Chrome. This needs no OAuth, but it
// only works when someone is signed in to Chrome itself.

/**
 * Email of the Google account signed in to Chrome, or an empty string when nobody is signed in.
 */
export async function getEmail() {
  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: chrome.identity.AccountStatus.ANY });
    return info.email;
  } catch (error) {
    console.warn('Could not read the Chrome profile email', error);
    return '';
  }
}

/**
 * The key that entries are stored under: the email, or "local" when Chrome is not signed in.
 */
export async function getKey() {
  const email = await getEmail();
  return email || 'local';
}
