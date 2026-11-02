/** Capability reads are idempotent; one retry tolerates a brief deployment/edge interruption. */
export async function fetchCapabilities(url: string, parent?: AbortSignal): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    parent?.throwIfAborted();
    try {
      const timeout = AbortSignal.timeout(5000);
      const response = await fetch(url, {
        signal: parent ? AbortSignal.any([parent, timeout]) : timeout,
        cache: 'no-store',
      });
      if (response.status < 500 || attempt === 1) return response;
    } catch (error) {
      if (parent?.aborted || attempt === 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Capability request did not complete');
}
