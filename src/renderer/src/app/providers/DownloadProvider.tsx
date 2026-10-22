import { useEffect, useState, type ReactNode } from 'react'
import { getApi } from '@renderer/shared/api'
import { useToast } from '@renderer/shared/hooks/useToast'
import { DownloadContext } from '@renderer/features/download/downloadContext'
import { createDownloadStore } from '@renderer/features/download/downloadStore'

export function DownloadProvider({ children }: { children: ReactNode }): React.JSX.Element {
    const { showToast } = useToast()
    const [store] = useState(() => createDownloadStore(getApi()))
    useEffect(() => store.connect((notice) => showToast(notice.message)), [store, showToast])
    return <DownloadContext.Provider value={store}>{children}</DownloadContext.Provider>
}
