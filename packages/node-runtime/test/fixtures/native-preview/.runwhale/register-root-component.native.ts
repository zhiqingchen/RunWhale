import { AppRegistry } from 'react-native'
export default function registerRootComponent(component: unknown) {
  AppRegistry.registerComponent('main', () => component)
}
