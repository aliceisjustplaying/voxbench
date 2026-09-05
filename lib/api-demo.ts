import { checkRequestAccess, checkProviderAccess } from './abuse-controls.ts';
import { readBoundedJson } from './request-body.ts';
import { RequestError, transcribe, prepareAudio } from './transcription.ts';
import { logFailure } from './logging.ts';
import {
  DEMO_MODELS,
  demoEnabled,
  validateDemo,
  trialIdentity,
  remainingTrials,
  claimTrial,
  checkTrialCapacity,
  verifyHuman,
  checkDemoBudget,
  type DemoEnv,
} from './demo.ts';
const headers = { 'Cache-Control': 'no-store' };
export async function handleDemoStatus(request: Request, config: DemoEnv) {
  if (!demoEnabled(config))
    return Response.json({ available: false }, { headers });
  try {
    const identity = await trialIdentity(request, config.DEMO_COOKIE_SECRET!);
    const remaining = identity.existing
      ? await remainingTrials(config.DEMO_DB!, identity.visitor)
      : 3;
    return Response.json(
      { available: true, remaining, siteKey: config.TURNSTILE_SITE_KEY },
      { headers },
    );
  } catch (error) {
    logFailure('demo-status', error, [config.DEMO_COOKIE_SECRET || '']);
    return Response.json({ available: false }, { headers });
  }
}
export async function handleDemoComparison(
  request: Request,
  config: DemoEnv,
  fetcher: typeof fetch = fetch,
) {
  let stage = 'demo-request';
  const secrets = [
    config.VOXBENCH_DEMO_KEY || '',
    config.DEMO_COOKIE_SECRET || '',
    config.TURNSTILE_SECRET || '',
  ];
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
    stage = 'demo-body';
    const { input, token, bytes } = validateDemo(
      await readBoundedJson(request, 1_350_000),
      config.VOXBENCH_DEMO_KEY!,
    );
    const identity = await trialIdentity(request, config.DEMO_COOKIE_SECRET!);
    stage = 'demo-capacity';
    await checkTrialCapacity(
      config.DEMO_DB!,
      identity.visitor,
      identity.network,
      identity.day,
    );
    stage = 'demo-budget';
    await checkDemoBudget(config.VOXBENCH_DEMO_KEY!, fetcher);
    stage = 'demo-verification';
    await verifyHuman(token, request, config.TURNSTILE_SECRET!, fetcher);
    // Check capacity before consuming a trial, then perform exactly the fixed trio.
    for (const _ of DEMO_MODELS)
      await checkProviderAccess('openrouter', input.key, config);
    stage = 'demo-claim';
    await claimTrial(
      config.DEMO_DB!,
      identity.visitor,
      identity.network,
      identity.day,
    );
    const audio = await prepareAudio(bytes);
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
            output: await transcribe({ ...input, id }, signal, fetcher, audio),
          };
        } catch (error) {
          logFailure('demo-provider-' + id, error, secrets);
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
    if (!(error instanceof RequestError) || error.status >= 500)
      logFailure(stage, error, secrets);
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
