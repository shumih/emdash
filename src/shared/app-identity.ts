type ImportMetaWithEnv = ImportMeta & { env?: { VITE_BUILD?: string } };

const isCanary = (import.meta as ImportMetaWithEnv).env?.VITE_BUILD === 'canary';

export const APP_ID = isCanary ? 'com.tondash.canary' : 'com.tondash.stable';
export const PRODUCT_NAME = isCanary ? 'Tondash Canary' : 'Tondash';
export const APP_NAME_LOWER = isCanary ? 'tondash-canary' : 'tondash';
export const UPDATE_CHANNEL = isCanary ? 'v1-canary' : 'v1-stable';
export const ARTIFACT_PREFIX = isCanary ? 'tondash-canary' : 'tondash';
// Auto-update feed stays on the upstream Emdash release server (harmless for local dev forks).
export const R2_BASE_URL = 'https://releases.emdash.sh';
