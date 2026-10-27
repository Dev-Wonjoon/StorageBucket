export const projectRoot: string

export function createTestWorkspace(name: string): string
export function cleanupTestWorkspace(root: string): void
export function testPath(root: string, ...segments: string[]): string
export function testEnvironment(root: string): NodeJS.ProcessEnv
export function requireTestWorkspace(): string
