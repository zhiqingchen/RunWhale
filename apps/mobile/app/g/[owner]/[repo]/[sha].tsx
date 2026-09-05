import { validatedGitHubCommitReference } from '@runwhale/mobile-protocol'
import { useLocalSearchParams } from 'expo-router'
import { GitHubSnapshotImportScreen } from '@/components/GitHubSnapshotImportScreen'

export default function GitHubShareDeepLinkScreen() {
  const params = useLocalSearchParams<{ owner?: string; repo?: string; sha?: string }>()
  try {
    const reference = validatedGitHubCommitReference({ owner: params.owner ?? '', repo: params.repo ?? '', commit: params.sha ?? '' })
    return <GitHubSnapshotImportScreen initialReference={reference} />
  } catch (cause) {
    return <GitHubSnapshotImportScreen initialError={cause instanceof Error ? cause.message : String(cause)} />
  }
}
