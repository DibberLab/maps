/* Accounts end-to-end: gating, sign-up, admin approval, sync between two
   devices, deletes, sign-out, adopting items saved before signing in, and an
   admin password reset. Needs the API serving the site on one origin:
     LF_DB=/tmp/lf.db LF_ADMIN_EMAILS=boss@example.com LF_COOKIE_SECURE=0 LF_STATIC=site \
       .venv/bin/gunicorn -b 127.0.0.1:8766 --chdir server app:app &
     node tools/smoke_accounts.js http://127.0.0.1:8766/
   Use a fresh LF_DB each run. */
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if(!ok) failed++; };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function device(name){
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
    await page.goto(BASE + '#map=16/45.86/-92.62&layers=parcels');
    await page.waitForFunction(() => window.LF && LF.account && LF.sync);
    page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'hunter@example.com' : undefined));
    return page;
  }
  const tool = async (p, t) => { await p.click('#toolsBtn'); await p.click(`[data-tool=${t}]`); };
  const head = p => p.textContent('#sheetHead');
  const signUp = async (p, email, pw, nm) => {
    await p.click('#toolsBtn'); await p.click('#accountEntry');
    await p.click('[data-act=to-signup]');
    await p.fill('#a-name', nm); await p.fill('#a-email', email); await p.fill('#a-pw', pw);
    await p.click('[data-act=signup]');
    await p.waitForFunction(() => LF.account.user(), null, { timeout: 5000 });
  };
  const signIn = async (p, email, pw) => {
    await p.click('#toolsBtn'); await p.click('#accountEntry');
    await p.fill('#a-email', email); await p.fill('#a-pw', pw); await p.click('[data-act=signin]');
    await p.waitForFunction(() => LF.account.user(), null, { timeout: 5000 });
  };
  const dropWaypoint = async (p, name, x, y) => {
    await tool(p, 'waypoint'); await p.mouse.click(x, y);
    await p.waitForSelector('#f-name'); await p.fill('#f-name', name); await p.click('[data-act=save]');
    await p.waitForFunction(n => document.querySelector('#sheetHead h2').textContent.includes(n), name);
    await p.click('#closeSheet');
  };
  const names = p => p.evaluate(() => LF.db.all('waypoints').then(w => w.map(x => x.name).sort().join(',')));

  // 1. Signed out: the map works, saving tools ask you to sign in.
  const anon = await device('anon');
  check(await anon.locator('[data-tool=waypoint].locked').count() === 1, 'saving tools marked as needing an approved account');
  await tool(anon, 'waypoint');
  check(/needs a Line Fence account/.test(await anon.textContent('#sheetBody')), 'waypoint tool asks a signed-out visitor to sign in');
  await anon.click('#closeSheet');
  await tool(anon, 'line'); await anon.mouse.click(100, 300); await anon.mouse.click(300, 300);
  check(/ft|mi/.test(await anon.textContent('#stripText')), 'measuring works without an account');
  await anon.click('#stripBtns [data-a=save]');
  check(/needs a Line Fence account/.test(await anon.textContent('#sheetBody')), 'keeping a drawing asks to sign in');
  await anon.click('#closeSheet'); await anon.click('#stripBtns [data-a=cancel]');

  check(!(await anon.isChecked('#l-discgolf')) && await anon.locator('.dg-pin').count() === 0, 'disc golf layer is off by default');

  // 2. The listed admin email signs up approved.
  const admin = await device('admin');
  await signUp(admin, 'boss@example.com', 'correct horse', 'Boss');
  check(await admin.evaluate(() => LF.account.approved()), 'admin email is approved at sign-up');
  await dropWaypoint(admin, 'Boss stand', 200, 300);

  // 2b. Layer settings follow the account: change them here, see them on a new device.
  await admin.click('#layersBtn');
  await admin.click('#l-discgolf'); await admin.click('#b-topo');
  await admin.click('#layersBtn');
  await admin.waitForTimeout(2500);   // saved a moment after the last change
  const other = await device('admin-2');
  await other.goto(BASE + '#map=14/45.86/-92.62');   // a plain address, not a link that sets layers
  await signIn(other, 'boss@example.com', 'correct horse');
  await other.waitForFunction(() => document.getElementById('l-discgolf').checked, null, { timeout:5000 }).catch(() => {});
  check(await other.isChecked('#l-discgolf') && await other.isChecked('#b-topo'), 'layer settings saved to the account and applied on another device');
  await other.reload(); await other.waitForFunction(() => window.LF && LF.account);
  await other.waitForTimeout(800);
  check(await other.isChecked('#l-discgolf') && await other.isChecked('#b-topo'), 'and they stay after a reload');
  const fresh = await device('fresh');
  check(!(await fresh.isChecked('#l-discgolf')) && await fresh.isChecked('#b-hyb'), 'a signed-out visitor still gets the defaults');

  // 3. A new user waits for approval.
  const hunter = await device('hunter');
  await hunter.evaluate(() => LF.db.put('waypoints', { name:'Before sign-in', lat:45.861, lng:-92.621, icon:'pin' }));   // saved before accounts existed
  await signUp(hunter, 'hunter@example.com', 'deerseason', 'Hunter');
  check(/Waiting for approval/.test(await hunter.textContent('#sheetBody')), 'new account shows waiting for approval');
  await hunter.click('#closeSheet');
  await tool(hunter, 'track');
  check(/unlocks once your account is approved/.test(await hunter.textContent('#sheetBody')), 'pending account cannot record tracks');
  await hunter.click('#closeSheet');

  // 4. Admin portal: approve.
  const portal = await admin.context().newPage();
  portal.on('dialog', d => d.accept(d.type() === 'prompt' ? 'hunter@example.com' : undefined));
  await portal.goto(BASE + 'admin/');
  await portal.waitForSelector('[data-a=approve]');
  check(/Hunter/.test(await portal.textContent('main')) && /waiting/.test(await portal.textContent('main')), 'admin portal lists the waiting account');
  await portal.click('[data-a=approve]');
  await portal.waitForFunction(() => !document.querySelector('[data-a=approve]'));
  check(true, 'admin approves from the portal');

  // 5. The hunter checks again, is approved, and their earlier item joins the account.
  await hunter.click('#toolsBtn'); await hunter.click('#accountEntry'); await hunter.click('[data-act=recheck]');
  await hunter.waitForFunction(() => LF.account.approved(), null, { timeout: 5000 });
  check(true, 'Check again picks up the approval');
  await dropWaypoint(hunter, 'Ridge stand', 220, 330);
  await hunter.evaluate(() => LF.sync.now());
  check(await hunter.evaluate(() => LF.sync.pendingCount()) === 0, 'changes reach the server: ' + await hunter.evaluate(() => LF.sync.status()));

  // 6. A second device signs in and gets them.
  const phone2 = await device('phone2');
  await signIn(phone2, 'hunter@example.com', 'deerseason');
  await phone2.evaluate(() => LF.sync.now());
  check(await names(phone2) === 'Before sign-in,Ridge stand', 'second device pulls the account\'s waypoints: ' + await names(phone2));
  check(!(await names(phone2)).includes('Boss'), 'accounts only see their own items');

  // 6b. Restoring a backup on one device syncs its changes (here, a folder) to the other.
  await hunter.evaluate(async () => { const b = await LF.db.exportAll();
    b.data.waypoints.forEach(w => { if(w.name === 'Ridge stand'){ w.folder = 'Hunting / Stands'; w.updated = Date.now(); } });
    await LF.db.importAll(b); await LF.sync.now(); });
  await phone2.evaluate(() => LF.sync.now());
  check(await phone2.evaluate(() => LF.db.all('waypoints').then(w => (w.find(x => x.name === 'Ridge stand') || {}).folder)) === 'Hunting / Stands',
    'a restored backup syncs to the other device');

  // 7. Delete on one device, gone on the other.
  await phone2.evaluate(() => LF.db.all('waypoints').then(w => LF.db.del('waypoints', w.find(x => x.name === 'Ridge stand').id)));
  await phone2.evaluate(() => LF.sync.now());
  await hunter.evaluate(() => LF.sync.now());
  check(await names(hunter) === 'Before sign-in', 'a delete on one device removes it on the other');

  // 8. Sign out clears the device; items stay in the account.
  await phone2.click('#toolsBtn'); await phone2.click('#accountEntry'); await phone2.click('[data-act=signout]');
  await phone2.waitForFunction(() => !LF.account.user());
  check(await names(phone2) === '', 'signing out removes the account\'s items from the device');
  await signIn(phone2, 'hunter@example.com', 'deerseason'); await phone2.evaluate(() => LF.sync.now());
  check(await names(phone2) === 'Before sign-in', 'signing back in brings them back');

  // 9. Admin resets a password; the temporary one works.
  await portal.click('[data-tab=approved]');
  const card = portal.locator('.card', { hasText: 'hunter@example.com' });
  await card.locator('[data-a=reset]').click();
  await portal.waitForSelector('.temp code');
  const temp = await portal.textContent('.temp code');
  check(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/.test(temp), 'portal shows a temporary password');
  const phone3 = await device('phone3');
  await signIn(phone3, 'hunter@example.com', temp);
  check(await phone3.evaluate(() => LF.account.approved()), 'the temporary password signs in');

  check(errors.length === 0, 'no script errors' + (errors.length ? ':\n  ' + errors.join('\n  ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
