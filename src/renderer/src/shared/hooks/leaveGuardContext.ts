import { createContext } from 'react'
export type LeaveGuardRef = { current: (() => boolean) | null }
export const LeaveGuardContext = createContext<LeaveGuardRef | null>(null)
