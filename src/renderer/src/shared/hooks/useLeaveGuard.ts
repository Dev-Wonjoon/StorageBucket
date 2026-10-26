import { useContext, useLayoutEffect, useRef } from 'react'
import { LeaveGuardContext } from './leaveGuardContext'
import { confirmDiscard } from '../utils/leaveGuard'

export function useLeaveGuard(dirty: boolean, busy: boolean): void {
    const registeredRef = useContext(LeaveGuardContext)
    const latest = useRef({ dirty, busy })
    useLayoutEffect(() => {
        latest.current = { dirty, busy }
    }, [dirty, busy])
    useLayoutEffect(() => {
        if (!registeredRef) return
        const guard = (): boolean => !latest.current.busy && confirmDiscard(latest.current.dirty)
        registeredRef.current = guard
        return () => {
            if (registeredRef.current === guard) registeredRef.current = null
        }
    }, [registeredRef])
}
