import { useMemo, useState } from 'react'
import { AppRegistry, PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Constants from 'expo-constants'
import * as Audio from 'expo-audio'
import * as Contacts from 'expo-contacts'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import { LinearGradient } from 'expo-linear-gradient'
import * as LocalAuthentication from 'expo-local-authentication'
import * as Location from 'expo-location'
import * as Maps from 'expo-maps'
import * as MediaLibrary from 'expo-media-library'
import * as Video from 'expo-video'
import { Canvas, Circle } from '@shopify/react-native-skia'

const POST_READY_CRASH_MESSAGE = 'Native Preview acceptance crash after first content'

function scheduleFatalCrashAfterReady(): void {
  setTimeout(() => {
    throw new Error(POST_READY_CRASH_MESSAGE)
  }, 0)
}

function NativePreviewFixture() {
  const [tapCount, setTapCount] = useState(0)
  const [dragDistance, setDragDistance] = useState(0)
  const { height, width } = useWindowDimensions()
  const orientation = width >= height ? 'landscape' : 'portrait'
  const dimensions = `${Math.round(width)} × ${Math.round(height)}`
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 4,
    onPanResponderMove: (_event, gesture) => setDragDistance(Math.round(gesture.dx)),
  }), [])

  return <LinearGradient colors={['#07182A', '#123B58']} style={styles.screen}>
    <Text accessibilityRole="header" style={styles.title}>Native Preview fixture ready</Text>
    <Text style={styles.dimensions}>Expo {Constants.expoConfig?.sdkVersion ?? '57'}</Text>
    <Text style={styles.dimensions}>Media modules: {Object.keys(Audio).length}/{Object.keys(Video).length}</Text>
    <Text style={styles.dimensions}>Project modules: {[Contacts, ImagePicker, LocalAuthentication, Location, Maps, MediaLibrary].filter(Boolean).length}</Text>
    <Canvas accessibilityLabel="Native Preview Skia canvas" style={styles.skia} testID="native-preview-skia">
      <Circle cx={14} cy={14} r={12} color="#62E6C7" />
    </Canvas>
    <Text
      accessibilityLabel={`Native Preview viewport ${orientation}, ${dimensions}`}
      style={styles.dimensions}
      testID="native-preview-dimensions"
    >
      Viewport: {orientation} · {dimensions}
    </Text>
    <Pressable
      accessibilityLabel={`Tap count ${tapCount}`}
      accessibilityRole="button"
      onPress={() => {
        setTapCount((count) => count + 1)
        void Haptics.selectionAsync()
      }}
      style={styles.button}
      testID="native-preview-tap"
    >
      <Text style={styles.buttonText}>Tap count: {tapCount}</Text>
    </Pressable>
    <Pressable
      accessibilityHint="Raises the deterministic Native Preview acceptance error"
      accessibilityLabel="Trigger post-ready crash"
      accessibilityRole="button"
      onPress={scheduleFatalCrashAfterReady}
      style={[styles.button, styles.crashButton]}
      testID="native-preview-crash"
    >
      <Text style={styles.buttonText}>Trigger post-ready crash</Text>
    </Pressable>
    <View
      accessible
      accessibilityLabel={`Drag distance ${dragDistance}`}
      style={styles.dragTarget}
      testID="native-preview-drag"
      {...panResponder.panHandlers}
    >
      <Text style={styles.dragText}>Drag horizontally: {dragDistance}</Text>
    </View>
    <ScrollView
      accessibilityLabel="Native Preview vertical scroll"
      contentContainerStyle={styles.scrollContent}
      style={styles.scroll}
      testID="native-preview-scroll"
    >
      {Array.from({ length: 40 }, (_, index) => <Text key={index} style={styles.row}>Scrollable row {index + 1}</Text>)}
      <Text accessibilityLabel="Native Preview bottom marker" style={styles.bottom}>Bottom marker</Text>
    </ScrollView>
  </LinearGradient>
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18, paddingTop: 18, backgroundColor: '#07182A' },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', marginBottom: 12 },
  dimensions: { color: '#9EC5FF', fontSize: 15, fontWeight: '700', marginBottom: 12 },
  skia: { width: 28, height: 28, marginBottom: 12 },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#526BFF' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  crashButton: { marginTop: 12, backgroundColor: '#A93245' },
  dragTarget: { minHeight: 72, alignItems: 'center', justifyContent: 'center', marginTop: 12, borderRadius: 12, backgroundColor: '#123B58' },
  dragText: { color: '#62E6C7', fontSize: 15, fontWeight: '700' },
  scroll: { flex: 1, marginTop: 12 },
  scrollContent: { gap: 8, paddingBottom: 32 },
  row: { minHeight: 42, padding: 10, borderRadius: 8, color: '#FFFFFF', backgroundColor: '#0D233A' },
  bottom: { padding: 16, color: '#62E6C7', fontSize: 18, fontWeight: '800', textAlign: 'center' },
})

AppRegistry.registerComponent('main', () => NativePreviewFixture)
