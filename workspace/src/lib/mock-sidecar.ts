// CC-BE-GOV-0109: mock sidecar is opt-in only.
export function resolveMockSidecar(input: Record<string, unknown>): boolean {
  return input.mock_sidecar === true || input.demo === true;
}
