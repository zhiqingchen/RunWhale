const { getDefaultConfig } = require('expo/metro-config')
const { withUniwindConfig } = require('uniwind/metro')

const config = getDefaultConfig(__dirname)

const appConfig = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './src/uniwind-types.d.ts',
})

// Workspace packages use NodeNext-compatible `.js` specifiers in TypeScript
// source. Metro does not retry those explicit specifiers against `.ts` files.
appConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform)
  } catch (error) {
    if ((moduleName.startsWith('./') || moduleName.startsWith('../')) && moduleName.endsWith('.js')) {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform)
    }
    throw error
  }
}

module.exports = appConfig
