import type { TediaProsApi } from './index'

declare global {
  interface Window {
    api: TediaProsApi
  }
}

export {}
