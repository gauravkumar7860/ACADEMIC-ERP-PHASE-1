// Escape any value before putting it in innerHTML (prevents XSS from CSV/user data).
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const ROLE_HOME = { super_admin: '/admin/dashboard.html', university_admin: '/admin/dashboard.html', student: '/student/dashboard.html', faculty: '/faculty/dashboard.html' };

async function api(path, { method = 'GET', body, isForm = false } = {}) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body && isForm) opts.body = body;
  else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`/api${path}`, opts);
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  const onAuthPage = /login|change-password/.test(location.pathname);
  if (res.status === 401 && !onAuthPage) { location.href = '/login.html'; throw new Error('Please sign in.'); }
  if (data && data.error === 'PASSWORD_CHANGE_REQUIRED' && !onAuthPage) { location.href = '/change-password.html'; throw new Error('Password change required.'); }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
