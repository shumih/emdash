import type { Configuration } from 'electron-builder';
import {
  APP_ID,
  ARTIFACT_PREFIX,
  PRODUCT_NAME,
  R2_BASE_URL,
  UPDATE_CHANNEL,
} from './src/shared/app-identity.canary';

// Notarize only when notary credentials are present in the environment.
// Preferred: APPLE_KEYCHAIN_PROFILE (stored via `xcrun notarytool store-credentials`) —
// needs no password or team id in env. Falls back to APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD
// + APPLE_TEAM_ID, or an App Store Connect API key. electron-builder reads them from env;
// a plain build without creds skips notarization (still produces an unsigned/ad-hoc dmg).
const notarize = Boolean(
  process.env.APPLE_KEYCHAIN_PROFILE || process.env.APPLE_TEAM_ID || process.env.APPLE_API_KEY
);

const config: Configuration = {
  appId: APP_ID,
  productName: PRODUCT_NAME,
  directories: { output: 'release' },
  artifactName: `${ARTIFACT_PREFIX}-\${arch}.\${ext}`,
  publish: [
    {
      provider: 'generic',
      url: R2_BASE_URL,
      channel: UPDATE_CHANNEL,
    },
  ],
  generateUpdatesFilesForAllChannels: false,
  files: ['out/**/*', 'node_modules/**/*', 'drizzle/**/*'],
  asarUnpack: [
    'node_modules/better-sqlite3/**',
    'node_modules/node-pty/**',
    'node_modules/@parcel/watcher/**',
    '**/*.node',
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
    icon: 'src/assets/images/emdash/emdash-canary.icns',
    notarize,
  },
  dmg: {
    icon: 'src/assets/images/emdash/emdash-canary.icns',
  },
  linux: {
    category: 'Development',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
      { target: 'rpm', arch: ['x64'] },
    ],
  },
  win: {
    icon: 'src/assets/images/emdash/app-icon-canary.png',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'msi', arch: ['x64'] },
    ],
    azureSignOptions: {
      publisherName: 'General Action, Inc.',
      endpoint: 'https://eus.codesigning.azure.net/',
      certificateProfileName: 'emdash-public',
      codeSigningAccountName: 'emdash',
    },
  },
  msi: {
    oneClick: false,
    perMachine: false,
  },
  nsis: {
    differentialPackage: true,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
  },
  npmRebuild: false,
};

export default config;
