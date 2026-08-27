/**
 * The OAuth App client_id device-flow sign-in uses. Public by design (device
 * flow has no client secret). Empty here means device flow is disabled and
 * onboarding falls back to a personal access token; set it (or override per
 * install via config.oauthClientId) to enable "Sign in with GitHub".
 */
export const DEFAULT_OAUTH_CLIENT_ID = 'Ov23lifWai93BwNJf5MA';
