import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Privacy — Voxbench' };
export default function Privacy() {
  return (
    <main className="lab privacy-page">
      <a href="/">← Back to Voxbench</a>
      <h1>Privacy at Voxbench</h1>
      <p>
        Voxbench is operated by aliceisjustplaying. Contact{' '}
        <a href="mailto:aliceisjustplaying@gmail.com">
          aliceisjustplaying@gmail.com
        </a>{' '}
        about privacy or data requests.
      </p>
      <h2>Your recordings and transcripts</h2>
      <p>
        With your own keys, your browser sends audio and optional vocabulary
        directly to each selected speech-recognition provider; nothing passes
        through our server. For the free trial, requests go through our
        Cloudflare server to OpenRouter and on to OpenAI, Mistral and Microsoft.
        We do not save audio, vocabulary or transcripts. Providers apply their
        own processing and retention policies; links to model documentation are
        available on the comparison page. Your reference transcript is used only
        in your browser.
      </p>
      <h2>Saved keys and browser data</h2>
      <p>
        API keys and vocabulary stay in local storage on your browser until you
        remove them or clear this site’s browser data. Local storage is not an
        encrypted vault. Only the key needed for a selected provider is sent
        with its request. OpenRouter sign-in stores the resulting key here too.
        Current recordings and up to 20 comparisons stay in tab memory;
        reloading closes that session. Files you export remain wherever you save
        them.
      </p>
      <h2>Free-trial protection</h2>
      <p>
        Free comparisons use Cloudflare Turnstile to check for automated abuse.
        It receives browser and network information needed for verification.
        Your own-key mode does not load that widget. After a verified free
        comparison, we set a signed, secure, HTTP-only browser identifier cookie
        lasting up to one year. We use it to count your three trial comparisons;
        this allowance does not reset daily.
      </p>
      <p>
        We also keep daily network counters, a global daily counter and trial
        claim records. Network identifiers are hashes that incorporate the day;
        IPv6 addresses are grouped by network. Daily counters and claim records
        become eligible for deletion after seven days and are removed on the
        next successful trial. Pseudonymous visitor totals remain to enforce the
        trial allowance. These records do not contain audio, vocabulary,
        transcripts or provider keys.
      </p>
      <h2>Analytics and operational logs</h2>
      <p>
        We use our Plausible instance at p.mosphere.at to understand aggregate
        visits, referral sources and device/browser usage. We do not send
        recordings, transcripts, vocabulary or API keys as analytics events. The
        analytics script loads on the comparison page, not the OpenRouter
        authorization callback. Plausible does not use an analytics cookie.
      </p>
      <p>
        Cloudflare processes network information to deliver and protect the
        site. Operational logs include request metadata and sanitized error
        details, not request bodies. URL query strings are redacted from Worker
        logs. Logs follow the configured Cloudflare retention period; the
        current Workers Free plan retains them for three days.
      </p>
      <h2>Your choices</h2>
      <p>
        You can remove saved keys in Connections, clear your vocabulary, or
        clear this site’s browser data. If you contact us about server-side
        records, we may need enough information to locate a pseudonymous record.
        You can also contact the selected provider about audio it received.
        Depending on your location, you may have rights to access, correct,
        delete or restrict use of personal data, or complain to your local
        data-protection authority.
      </p>
      <p>
        We process recordings to provide the comparison you request, and use
        operational and abuse-prevention data to run and protect the service.
        External providers may process data in other countries under their own
        terms and safeguards.
      </p>
    </main>
  );
}
