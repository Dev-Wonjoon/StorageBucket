import { createContext } from 'react'
import type { DownloadStore } from './downloadStore'

export const DownloadContext = createContext<DownloadStore | null>(null)
