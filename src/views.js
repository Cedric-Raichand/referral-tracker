import { config } from './config.js';

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const css = `
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f6f8;color:#1c1e21}
  main{max-width:520px;margin:0 auto;padding:24px 16px}
  main.wide{max-width:900px}
  .card{background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:16px}
  h1{font-size:1.4rem;margin:0 0 6px} h2{font-size:1.1rem;margin:0 0 10px}
  p{line-height:1.5;margin:0 0 12px;color:#4b4f56}
  label{display:block;font-weight:600;font-size:.9rem;margin:14px 0 6px}
  input{width:100%;padding:12px;border:1px solid #cfd3d9;border-radius:10px;font-size:1rem}
  button,.btn{display:inline-block;width:100%;margin-top:18px;padding:13px;border:0;border-radius:10px;background:#1f7a4d;color:#fff;font-size:1rem;font-weight:600;cursor:pointer;text-align:center;text-decoration:none}
  .error{background:#fdecec;color:#a12626;padding:10px 12px;border-radius:10px;margin-bottom:12px}
  .linkbox{display:flex;gap:8px;align-items:center;margin-bottom:12px}
  .linkbox input{flex:1;font-size:.85rem}
  .linkbox button{width:auto;margin:0;padding:12px 14px}
  .tag{font-size:.8rem;font-weight:600;color:#1f7a4d;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;font-size:.92rem}
  th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #e4e6ea}
  th{font-size:.8rem;text-transform:uppercase;color:#65676b}
  td.num,th.num{text-align:right}
  .scroll{overflow-x:auto}
  a{color:#1f7a4d}
  .foot{text-align:center;font-size:.85rem;margin-top:8px}
  .small{width:auto;margin:0;padding:8px 12px;font-size:.85rem}
  .grey{background:#6b7280}
  .ok{color:#1f7a4d;font-weight:600;white-space:nowrap}
  form.inline{margin:0}
`;

export function layout(title, body, { wide = false, description = '', path = '' } = {}) {
  const desc = description || 'Join through a friend’s link and get invited straight in.';
  const image = `${config.baseUrl}/cover.png`;
  // Open Graph tags make WhatsApp, Instagram, Snapchat etc. show a preview card with a cover image.
  const preview = `
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(config.siteName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
${path ? `<meta property="og:url" content="${esc(config.baseUrl + path)}">` : ''}
<meta name="twitter:card" content="summary_large_image">`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>${preview}
<style>${css}</style>
</head><body><main class="${wide ? 'wide' : ''}">${body}</main></body></html>`;
}

export function registerPage({ error = '', values = {} } = {}) {
  return layout(
    'Join the referral program',
    `<div class="card">
      <h1>Become a referrer</h1>
      <p>Register to get your own links. Every person who joins through your link is counted for you.</p>
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      <form method="post" action="/register">
        <label for="name">Your name</label>
        <input id="name" name="name" required maxlength="60" value="${esc(values.name)}">
        <label for="phone">Contact number</label>
        <input id="phone" name="phone" type="tel" required placeholder="0241234567" value="${esc(values.phone)}">
        <label for="username">Username</label>
        <input id="username" name="username" required minlength="3" maxlength="20"
               placeholder="letters, numbers, underscore" value="${esc(values.username)}">
        <button type="submit">Get my links</button>
      </form>
    </div>
    <p class="foot"><a href="/admin">Admin login</a></p>`,
    { description: 'Register to get your own links and get credit for everyone you bring in.', path: '/' },
  );
}

export function linksPage(referrer) {
  const boxes = Object.entries(config.platforms)
    .map(([key, p]) => {
      const link = `${config.baseUrl}/r/${encodeURIComponent(referrer.username)}/${key}`;
      return `<div class="tag">${esc(p.label)}</div>
        <div class="linkbox">
          <input readonly value="${esc(link)}" id="l-${key}">
          <button type="button" onclick="copyLink('l-${key}',this)">Copy</button>
        </div>`;
    })
    .join('');
  return layout(
    'Your referral links',
    `<div class="card">
      <h1>Welcome, ${esc(referrer.name)}</h1>
      <p>Your username is <strong>${esc(referrer.username)}</strong>. Share the links below. Each person who joins through them is credited to you.</p>
      ${boxes}
      <p><a href="/">Register another person</a></p>
    </div>
    <script>
      function copyLink(id, btn) {
        var el = document.getElementById(id);
        el.select();
        (navigator.clipboard ? navigator.clipboard.writeText(el.value) : Promise.resolve(document.execCommand('copy')))
          .then(function(){ btn.textContent = 'Copied'; setTimeout(function(){ btn.textContent = 'Copy'; }, 1500); });
      }
    </script>`,
  );
}

export function notFoundPage(message = 'Page not found.') {
  return layout('Not found', `<div class="card"><h1>Oops</h1><p>${esc(message)}</p><p><a href="/">Go home</a></p></div>`);
}

const contactFields = {
  phone: { label: 'Your phone number', type: 'tel', placeholder: '0241234567' },
  username: { label: 'Your username', type: 'text', placeholder: 'your handle, without @' },
};

export function joinPage({ referrer, platformKey, error = '', values = {} }) {
  const platform = config.platforms[platformKey];
  const field = contactFields[platform.contact];
  const label =
    platform.contact === 'username' ? `Your ${platform.label} username` : field.label;
  return layout(
    `${referrer.name} invited you to join the ${platform.label}`,
    `<div class="card">
      <h1>Join the ${esc(platform.label)}</h1>
      <p>You were invited by <strong>${esc(referrer.name)}</strong> (${esc(referrer.username)}). Enter your details so the invite is credited to them, then you'll be taken straight in.</p>
      ${error ? `<div class="error">${esc(error)}</div>` : ''}
      <form method="post" action="/r/${encodeURIComponent(referrer.username)}/${esc(platformKey)}">
        <label for="name">Your name</label>
        <input id="name" name="name" required maxlength="60" value="${esc(values.name)}">
        <label for="contact">${esc(label)}</label>
        <input id="contact" name="contact" type="${field.type}" required placeholder="${esc(field.placeholder)}" value="${esc(values.contact)}">
        <button type="submit">Continue to ${esc(platform.label)}</button>
      </form>
    </div>`,
    {
      description: `${referrer.name} invited you. Tap to join the ${platform.label}.`,
      path: `/r/${encodeURIComponent(referrer.username)}/${platformKey}`,
    },
  );
}

export function joinedPage({ referrer, platformKey, counted }) {
  const platform = config.platforms[platformKey];
  const note = counted
    ? `Thanks! This invite has been credited to <strong>${esc(referrer.name)}</strong>.`
    : 'Welcome back! You were already counted, so nothing changes.';
  return layout(
    'You are in',
    `<div class="card">
      <h1>${counted ? 'Done' : 'Already counted'}</h1>
      <p>${note}</p>
      <a class="btn" href="${esc(platform.url)}">Open ${esc(platform.label)}</a>
    </div>
    <div class="card">
      <h2>Want to invite people too?</h2>
      <p>Register as a referrer to get your own links. Everyone who joins through them is counted for you.</p>
      <a class="btn" href="/">Register as a referrer</a>
    </div>`,
  );
}

export function adminPage({ leaderboard }) {
  const platformCols = Object.values(config.platforms)
    .map((p) => `<th class="num">${esc(p.label)}</th>`)
    .join('');
  const rows = leaderboard
    .map(
      (r, i) => `<tr>
        <td>${i + 1}</td>
        <td><a href="/admin/${encodeURIComponent(r.username)}">${esc(r.name)}</a><br><small>${esc(r.username)} &middot; ${esc(r.phone)}</small></td>
        ${Object.keys(config.platforms).map((k) => `<td class="num">${r[k]}</td>`).join('')}
        <td class="num"><strong>${r.total}</strong></td>
        <td class="num"><strong>${r.confirmed}</strong></td>
      </tr>`,
    )
    .join('');
  const total = leaderboard.reduce((sum, r) => sum + r.total, 0);
  const confirmed = leaderboard.reduce((sum, r) => sum + r.confirmed, 0);
  return layout(
    'Admin',
    `<div class="card">
      <h1>Referral dashboard</h1>
      <p>${leaderboard.length} referrers &middot; ${total} referred &middot; ${confirmed} confirmed</p>
      <p><small><strong>Referred</strong> = came through the link and filled in the form. <strong>Confirmed</strong> = you checked they really joined. Open a referrer to confirm people.</small></p>
      <div class="scroll"><table>
        <tr><th>#</th><th>Referrer</th>${platformCols}<th class="num">Referred</th><th class="num">Confirmed</th></tr>
        ${rows || '<tr><td colspan="8">No referrers yet.</td></tr>'}
      </table></div>
    </div>`,
    { wide: true },
  );
}

export function adminReferrerPage({ referrer, referrals }) {
  const confirmedCount = referrals.filter((f) => f.confirmed).length;
  const rows = referrals
    .map((f) => {
      const isUser = config.platforms[f.platform]?.contact === 'username';
      const contact = isUser ? `@${esc(f.contact)}` : esc(f.contact);
      const action = f.confirmed
        ? `<span class="ok">Confirmed &#10003;</span>
           <form class="inline" method="post" action="/admin/confirm">
             <input type="hidden" name="id" value="${f.id}"><input type="hidden" name="value" value="0">
             <button class="small grey" type="submit">Undo</button>
           </form>`
        : `<form class="inline" method="post" action="/admin/confirm">
             <input type="hidden" name="id" value="${f.id}"><input type="hidden" name="value" value="1">
             <button class="small" type="submit">Confirm</button>
           </form>`;
      return `<tr>
        <td>${esc(f.name)}</td><td>${contact}</td>
        <td>${esc(config.platforms[f.platform]?.label || f.platform)}</td>
        <td>${esc(f.created_at)} UTC</td>
        <td>${action}</td>
      </tr>`;
    })
    .join('');
  return layout(
    `Admin - ${referrer.username}`,
    `<div class="card">
      <p><a href="/admin">&larr; Back to dashboard</a></p>
      <h1>${esc(referrer.name)}</h1>
      <p>${esc(referrer.username)} &middot; ${esc(referrer.phone)} &middot; ${referrals.length} referred &middot; ${confirmedCount} confirmed</p>
      <p><small>Check your real group members or followers, then tap Confirm next to each person you find there.</small></p>
      <div class="scroll"><table>
        <tr><th>Name</th><th>Contact</th><th>Platform</th><th>Joined</th><th></th></tr>
        ${rows || '<tr><td colspan="5">No one referred yet.</td></tr>'}
      </table></div>
    </div>`,
    { wide: true },
  );
}