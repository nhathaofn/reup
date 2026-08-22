export type StartupStage =
  | 'server-checking'
  | 'server-required'
  | 'dependency-checking'
  | 'setup'
  | 'ready'

export type StartupEvent =
  | { type: 'server-connected' }
  | { type: 'server-unavailable' }
  | { type: 'dependencies-ready' }
  | { type: 'dependencies-missing' }
  | { type: 'setup-complete' }

export const INITIAL_STARTUP_STAGE: StartupStage = 'server-checking'

export function transitionStartup(stage: StartupStage, event: StartupEvent): StartupStage {
  if (event.type === 'server-unavailable') return 'server-required'

  if (event.type === 'server-connected') {
    return stage === 'server-checking' || stage === 'server-required'
      ? 'dependency-checking'
      : stage
  }

  if (stage === 'dependency-checking') {
    if (event.type === 'dependencies-ready') return 'ready'
    if (event.type === 'dependencies-missing') return 'setup'
  }

  if (stage === 'setup' && event.type === 'setup-complete') return 'ready'
  return stage
}
