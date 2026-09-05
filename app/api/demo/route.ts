import { env } from 'cloudflare:workers';
import { checkRequestAccess, checkProviderAccess } from '@/lib/abuse-controls';
import { readBoundedJson } from '@/lib/request-body';
import { RequestError, transcribe } from '@/lib/transcription';
import {
  DEMO_MODELS,
  demoEnabled,
  validateDemo,
  trialIdentity,
  remainingTrials,
  claimTrial,
  verifyHuman,
  checkDemoBudget,
  type DemoEnv,
} from '@/lib/demo';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  const config = env as DemoEnv;
  if (!demoEnabled(config))
    return Response.json({ available: false }, { headers });
  try {
    const identity = await trialIdentity(request, config.VOXBENCH_DEMO_KEY!);
    const remaining = await remainingTrials(config.DEMO_DB!, identity.visitor);
    return Response.json(
      { available: true, remaining, siteKey: config.TURNSTILE_SITE_KEY },
      { headers: { ...headers, 'Set-Cookie': identity.cookie } },
    );
  } catch {
    return Response.json({ available: false }, { headers });
  }
}
export async function POST(request: Request) {
  const config = env as DemoEnv;
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return Response.json(
      { error: 'Open the trial from Voxbench.' },
      { status: 403, headers },
    );
  try {
    if (!demoEnabled(config))
      throw new RequestError(
        'The free trial is temporarily unavailable. You can use your own keys.',
        503,
      );
    await checkRequestAccess(request, config);
    const { input, token } = validateDemo(
      await readBoundedJson(request, 1_350_000),
      config.VOXBENCH_DEMO_KEY!,
    );
    const identity = await trialIdentity(request, config.VOXBENCH_DEMO_KEY!);
    await verifyHuman(token, request, config.TURNSTILE_SECRET!);
    await checkDemoBudget(config.VOXBENCH_DEMO_KEY!);
    // Check capacity before consuming a trial, then perform exactly the fixed trio.
    for (const _ of DEMO_MODELS)
      await checkProviderAccess('openrouter', input.key, config);
    await claimTrial(config.DEMO_DB!, identity.visitor, identity.network);
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(55_000),
    ]);
    const results = await Promise.all(
      DEMO_MODELS.map(async (id) => {
        try {
          return {
            id,
            status: 'done',
            output: await transcribe({ ...input, id }, signal),
          };
        } catch (error) {
          // No retries or quota refunds: a failed response can still represent paid work.
          return {
            id,
            status: 'error',
            error:
              error instanceof RequestError
                ? error.message
                : 'The provider connection failed. You can try another free comparison if you have one left.',
          };
        }
      }),
    );
    return Response.json(
      {
        results,
        remaining: await remainingTrials(config.DEMO_DB!, identity.visitor),
      },
      { headers: { ...headers, 'Set-Cookie': identity.cookie } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof RequestError
            ? error.message
            : 'The free trial is temporarily unavailable. Please try again later.',
      },
      { status: error instanceof RequestError ? error.status : 503, headers },
    );
  }
}
