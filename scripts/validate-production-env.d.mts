export function shouldValidateProductionEnv(
  env: Record<string, string | undefined>,
): boolean;

export function productionEnvErrors(env: Record<string, string | undefined>): string[];
