export async function retryAfterCsrfRecovery<T>(
  action: () => Promise<T>,
  refreshCsrf: () => Promise<unknown>,
  shouldRecover: (error: unknown) => boolean
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!shouldRecover(error)) {
      throw error;
    }
    await refreshCsrf();
    return action();
  }
}
