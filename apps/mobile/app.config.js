module.exports = ({ config }) => {
  const bundleId = process.env.BUNDLE_ID || config.ios.bundleIdentifier

  return {
    ...config,
    ios: {
      ...config.ios,
      bundleIdentifier: bundleId,
      entitlements: {
        ...config.ios.entitlements,
        'keychain-access-groups': [`$(AppIdentifierPrefix)${bundleId}`],
      },
      infoPlist: {
        ...config.ios.infoPlist,
        BGTaskSchedulerPermittedIdentifiers: [`${bundleId}.agent.*`],
      },
    },
    android: {
      ...config.android,
      package: bundleId,
    },
  }
}
