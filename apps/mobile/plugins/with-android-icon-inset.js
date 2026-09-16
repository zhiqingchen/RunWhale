const path = require('node:path')
const { withFinalizedMod, XML } = require('@expo/config-plugins')

module.exports = function withAndroidIconInset(config) {
  return withFinalizedMod(config, ['android', async (project) => {
    const resourceDirectory = path.join(project.modRequest.platformProjectRoot, 'app/src/main/res/mipmap-anydpi-v26')
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const file = path.join(resourceDirectory, name)
      const icon = await XML.readXMLAsync({ path: file })
      // Android masks the central 72dp of a 108dp layer. Keep the artwork at
      // 64.8dp so the face, hand, and code mark have room inside that viewport.
      icon['adaptive-icon'].foreground = [{
        inset: [{ $: {
          'android:drawable': '@mipmap/ic_launcher_foreground',
          'android:inset': '20%',
        } }],
      }]
      await XML.writeXMLAsync({ path: file, xml: icon })
    }
    return project
  }])
}
