import Svg, { Path } from 'react-native-svg'

export function WhaleTailIcon({ size = 14 }: { size?: number }) {
  // Trim the source margins and optically center the top-heavy tail.
  return <Svg width={size} height={size} viewBox="12 11 43 35">
    <Path fill="#0D73FF" d="M13.4 15.3
      C13.5 13.8 14.4 13.5 15.5 14.5
      C18.7 17.5 22.4 17.6 26.2 18
      C29.7 18.3 32.5 20.1 33.7 23.1
      C34 23.7 34.4 23.7 34.7 22.9
      C36.1 19.6 39.3 18.4 43.5 18
      C47.2 17.7 49.8 16.8 52.3 14.7
      C53.3 13.8 54 14.1 54 15.7
      C54.5 25.6 49.9 32.2 40.1 34.7
      C39.1 35 38.9 35.5 38.9 36.5
      C38.8 42.6 35.3 47.2 29.2 46.5
      C28.1 46.4 27.8 45.9 28.5 45
      C30.1 42.7 30.2 39.1 29.8 36.9
      C29.6 35.6 29.1 35.1 27.6 34.8
      C18.1 33 12.7 25.5 13.4 15.3Z" />
  </Svg>
}
