export function logFailure(
  stage: string,
  error: unknown,
  secrets: string[] = [],
) {
  let message = error instanceof Error ? error.message : 'Unknown failure';
  for (const secret of secrets)
    if (secret) message = message.replaceAll(secret, '[redacted]');
  console.error('Voxbench request failed', {
    stage,
    name: error instanceof Error ? error.name : 'UnknownError',
    message: message.slice(0, 300),
  });
}
