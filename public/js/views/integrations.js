// Telco & API: the scale path. Operators divert flagged calls; banks and I4C consume the output.
import { $, esc, api, toast } from '../util.js';

let root;

export const view = {
  id: 'integrations',
  title: 'Telco & API',
  mount(el) {
    root = el;
    el.innerHTML = `
      <header class="page-head"><div><p class="overline">System <span>·</span> telco &amp; API</p><h2>From one citizen to every operator</h2><p class="page-sub">Where calls come in, where intelligence goes, and the APIs banks and telcos use. The simulator pushes flagged calls through the full pipeline.</p></div></header>
      <div class="int-grid">
        <section class="panel span2">
          <header class="panel-head"><h2>Where Chakravyuh plugs in</h2></header>
          <div class="arch">
            <div class="lane"><h4>Calls in</h4>
              <div class="box">Citizens<small>Merge a suspicious call into the Chakravyuh number with “add call”; promoted with 1930 awareness drives and DoT's Chakshu.</small></div>
              <div class="box">Telecom operators<small>Spam filters already flag fraud calls; flagged calls are diverted to the decoy over a SIP trunk instead of only being labelled.</small></div>
              <div class="box">Decoy numbers<small>Unused numbers, each tied to a persona, seeded into the leaked lists scammers buy.</small></div>
            </div>
            <div class="lane core"><h4>Chakravyuh</h4>
              <div class="box">Voice agent<small>Speech-to-text → playbook + persona → text-to-speech, with barge-in.</small></div>
              <div class="box">Intelligence<small>Identifier extraction, IFSC checks, voiceprints, script campaigns, honeytokens.</small></div>
              <div class="box">Ring graph<small>Links calls through shared numbers, mule accounts, voices and honeytokens.</small></div>
            </div>
            <div class="lane"><h4>Action out</h4>
              <div class="box">State cyber cells / I4C<small>Ring dossiers, NCRP / 1930 packets, suspect identifiers for the Suspect Registry.</small></div>
              <div class="box">Bank fraud desks<small>Mule-account feed and lookups; complements RBI's MuleHunter.AI.</small></div>
              <div class="box">Telcos<small>Per-call fee; numbers confirmed as scam lines for blocking.</small></div>
            </div>
          </div>
        </section>
        <section class="panel">
          <header class="panel-head"><h2>Telco diversion simulator</h2></header>
          <p>Simulates operators diverting flagged fraud calls to the decoy. Each call runs through the full pipeline (playbook, extraction, ring linking, case creation) in the background, without audio.</p>
          <div class="form-row">
            <label class="field">Calls to divert<select id="tc-count"><option>5</option><option selected>10</option><option>20</option><option>40</option></select></label>
          </div>
          <button class="btn primary" id="tc-go">Divert flagged calls</button>
          <div id="tc-result"></div>
          <p class="fine">Synthetic: numbers, UPI IDs and accounts are made up. Real diversion needs an operator SIP trunk and a DoT / law-enforcement framework.</p>
        </section>
        <section class="panel api-doc">
          <header class="panel-head"><h2>API</h2></header>
          <table class="table"><tbody>
            <tr><td><code>POST /api/v1/telco/divert</code></td><td>Operator hands over flagged calls (simulated here)</td></tr>
            <tr><td><code>GET /api/v1/mules</code></td><td>Risk-scored mule UPI IDs and accounts (JSON); <a href="/api/v1/mules.csv">CSV</a></td></tr>
            <tr><td><code>GET /api/v1/lookup?q=</code></td><td>Is this UPI ID, account, phone or IFSC known?</td></tr>
            <tr><td><code>GET /api/export/{ring}.json</code></td><td>Ring feed for I4C / bank fraud desks</td></tr>
            <tr><td><code>GET /dossier/{ring}</code></td><td>1930 / NCRP complaint packet with freeze requests</td></tr>
          </tbody></table>
          <pre><code>curl -X POST http://127.0.0.1:4310/api/v1/telco/divert \\
  -H "Content-Type: application/json" -d '{"count": 10}'</code></pre>
        </section>
        <section class="panel">
          <header class="panel-head"><h2>Business model</h2></header>
          <ul class="biz">
            <li><b>Government</b> State cyber-crime cells and I4C license the ring-intelligence console.</li>
            <li><b>Banks & payment apps</b> Subscribe to the mule-account feed and lookup API.</li>
            <li><b>Telcos</b> Pay per diverted fraud call, and get confirmed scam numbers back.</li>
            <li><b>Citizens</b> The merge-call number stays free.</li>
          </ul>
          <p class="fine">Pilot plan: one Tamil Nadu cyber-crime wing and one bank fraud desk, then telco spam-filter partnerships.</p>
        </section>
      </div>`;
    $('#tc-go', el).onclick = async () => {
      const btn = $('#tc-go', el);
      btn.disabled = true;
      btn.textContent = 'Diverting…';
      try {
        const r = await api('/api/v1/telco/divert', { count: Number($('#tc-count', el).value) });
        $('#tc-result', el).innerHTML = `<div class="notice hit"><b>${r.diverted} calls diverted.</b> ${r.linked} linked to known rings (${r.ringsBefore} → ${r.ringsAfter} rings). Calls ${esc(r.callIds[0])} to ${esc(r.callIds[r.callIds.length - 1])}. <a href="#/rings">See the graph</a> · <a href="#/cases">Case board</a></div>`;
        toast(`${r.diverted} telco calls processed; ${r.linked} linked to known rings`);
      } catch (err) {
        toast(err.message, 'warn');
      }
      btn.disabled = false;
      btn.textContent = 'Divert flagged calls';
    };
  },
  update() {}
};
