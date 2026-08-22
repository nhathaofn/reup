export const LOCAL_APP_ID = 'com.nhathaofn.tediapros.local' as const
export const LOCAL_APP_NAME = 'TediaPros Local' as const
export const LOCAL_USER_DATA_DIRECTORY = 'TediaPros Local Data' as const

export function isLocalPortableBuild(
  env: Record<string, string | undefined>,
  isPackaged: boolean
): boolean {
  return isPackaged && Boolean(env.PORTABLE_EXECUTABLE_DIR?.trim())
}


