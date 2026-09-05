export async function readApiResponse<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(
      `The server returned an unreadable response (HTTP ${response.status}). Please try again. If it keeps happening, the service may be temporarily unavailable.`,
    );
  }
}
