/**
 * User model functions for interacting with Supabase Auth and the `profiles`
 * table. Each registered user has a record in Supabase's Auth system and
 * an associated row in the `profiles` table where additional metadata such
 * as role and expiry date are stored.
 */

async function registerUser(supabase, email, password, role = 'user', expiresAt = null) {
  // Sign up via Supabase Auth. Supabase will send a confirmation email if
  // email confirmation is enabled on the project.
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });
  if (authError) {
    throw new Error(authError.message || 'Failed to register user');
  }
  // Insert a row into profiles table containing role and expiration. We
  // include the user's id which is returned in authData.user.id
  const userId = authData?.user?.id;
  if (!userId) {
    throw new Error('Registration succeeded but user id is undefined');
  }
  const { error: profileError } = await supabase.from('profiles').insert({
    id: userId,
    role,
    expires_at: expiresAt,
  });
  if (profileError) {
    throw new Error(profileError.message || 'Failed to create profile');
  }
  return authData.user;
}

async function loginUser(supabase, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    throw new Error(error.message || 'Login failed');
  }
  return data.user;
}

async function getProfile(supabase, userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) {
    throw new Error(error.message || 'Failed to fetch profile');
  }
  return data;
}

/**
 * Checks whether a user has expired. Expired users cannot access the app.
 * The owner account does not expire (expires_at is null). Assumes
 * profile.expires_at is a timestamp string.
 */
function isUserExpired(profile) {
  if (!profile) return true;
  if (!profile.expires_at) return false; // no expiry means unlimited
  const expiry = new Date(profile.expires_at);
  return Date.now() > expiry.getTime();
}

module.exports = {
  registerUser,
  loginUser,
  getProfile,
  isUserExpired,
};