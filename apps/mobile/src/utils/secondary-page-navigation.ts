export type SecondaryPageHomeRoute = '/(tabs)/settings' | '/(tabs)/workspace'

export interface SecondaryPageRouter {
  canGoBack(): boolean
  back(): void
  replace(href: SecondaryPageHomeRoute): void
}

export function returnFromSecondaryPage(router: SecondaryPageRouter, homeRoute: SecondaryPageHomeRoute): true {
  if (router.canGoBack()) router.back()
  else router.replace(homeRoute)
  return true
}
