export function focusedInputScrollOffset(currentOffset: number, inputPageY: number, scrollPageY: number): number {
  return Math.max(0, currentOffset + inputPageY - scrollPageY)
}
