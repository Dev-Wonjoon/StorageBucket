import type { ReactNode } from 'react'
import { LeaveGuardContext, type LeaveGuardRef } from '@renderer/shared/hooks/leaveGuardContext'

export function LeaveGuardProvider({
    guard,
    children
}: {
    guard: LeaveGuardRef
    children: ReactNode
}): React.JSX.Element {
    return <LeaveGuardContext.Provider value={guard}>{children}</LeaveGuardContext.Provider>
}
