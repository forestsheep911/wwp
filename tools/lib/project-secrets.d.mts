import type { DotenvConfigOptions, DotenvConfigOutput } from "dotenv";
export function config(options?: DotenvConfigOptions): DotenvConfigOutput;
export function projectEnv(name: string): string | undefined;
export function resolveSecretReferences(env?: Record<string, string | undefined>, readSecret?: (vault: string, name: string) => string): Record<string, string | undefined>;
