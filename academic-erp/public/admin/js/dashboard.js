const tabs = ['overview', 'students', 'bulkImport', 'faculty', 'auditLog'];
let refData = { departments: [], programmes: [], sections: [] };
const $ = (id) => document.getElementById(id);

function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); }
async function guarded(fn) { try { await fn(); } catch (e) { toast(e.message); } }

function showTab(name) {
  tabs.forEach((t) => { $(`tab-${t}`).style.display = t === name ? 'block' : 'none'; });
  document.querySelectorAll('.sidebar nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  const loaders = { overview: loadOverview, students: loadStudents, bulkImport: loadBulkImportTab, faculty: loadFaculty, auditLog: loadAuditLog };
  guarded(loaders[name]);
}
document.querySelectorAll('.sidebar nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('logoutBtn').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });

async function init() {
  const me = await api('/auth/me');
  if (!['super_admin', 'university_admin'].includes(me.user.role)) { location.href = '/login.html'; return; }
  $('whoName').textContent = me.user.username;
  refData = await api('/admin/reference-data');
  showTab('overview');
}

async function loadOverview() {
  const s = await api('/admin/dashboard');
  $('tab-overview').innerHTML = `<h2>Overview</h2><div class="card-row">
    <div class="stat-card"><div class="n">${s.totalStudents}</div><div class="label">Active students</div></div>
    <div class="stat-card"><div class="n">${s.totalFaculty}</div><div class="label">Active faculty</div></div>
    <div class="stat-card"><div class="n">${s.totalDepartments}</div><div class="label">Departments</div></div>
    <div class="stat-card"><div class="n">${s.totalProgrammes}</div><div class="label">Programmes</div></div>
    <div class="stat-card"><div class="n">${s.pendingImportBatches}</div><div class="label">Import batches awaiting review</div></div></div>
    <p class="muted">Attendance, assignments, tests and leave join this dashboard as those modules ship in later phases.</p>`;
}

async function loadStudents() {
  const opts = refData.programmes.map((p) => `<option value="${esc(p.id)}">${esc(p.code)}</option>`).join('');
  $('tab-students').innerHTML = `<h2>Students</h2>
    <div class="panel"><div class="row">
      <input id="stuSearch" placeholder="Search name, student ID or roll no." style="width:250px">
      <select id="stuProgramme"><option value="">All programmes</option>${opts}</select>
      <button class="btn secondary" id="stuSearchBtn">Search</button>
      <a class="btn secondary" href="/api/admin/students/export">Export CSV</a></div></div>
    <div class="panel"><div class="table-wrap"><table id="stuTable"><thead><tr><th>Student ID</th><th>Roll no.</th><th>Name</th><th>Programme</th><th>Sem</th><th>Section</th><th>Status</th></tr></thead><tbody></tbody></table></div>
    <div id="stuPager" class="row hint" style="margin-top:10px"></div></div>`;
  $('stuSearchBtn').addEventListener('click', () => guarded(() => renderStudents(1)));
  $('stuSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') guarded(() => renderStudents(1)); });
  await renderStudents(1);
}

async function renderStudents(page) {
  const p = new URLSearchParams({ page, pageSize: 20 });
  if ($('stuSearch').value.trim()) p.set('q', $('stuSearch').value.trim());
  if ($('stuProgramme').value) p.set('programme_id', $('stuProgramme').value);
  const d = await api(`/admin/students?${p}`);
  document.querySelector('#stuTable tbody').innerHTML = d.students.length ? d.students.map((s) => `<tr>
    <td>${esc(s.student_id_no)}</td><td>${esc(s.roll_number)}</td><td>${esc(s.name)}</td><td>${esc(s.programme_code)}</td>
    <td>${esc(s.semester)}</td><td>${esc(s.section_name || '—')}</td>
    <td><span class="badge ${s.is_active ? 'ok' : 'bad'}">${s.is_active ? 'Active' : 'Inactive'}</span></td></tr>`).join('')
    : '<tr><td colspan="7" class="muted">No students match this search.</td></tr>';
  const pages = Math.max(Math.ceil(d.total / d.pageSize), 1);
  $('stuPager').innerHTML = `<button class="btn secondary" id="prevP" ${d.page <= 1 ? 'disabled' : ''}>Previous</button>
    <span>Page ${d.page} of ${pages} (${d.total} students)</span>
    <button class="btn secondary" id="nextP" ${d.page >= pages ? 'disabled' : ''}>Next</button>`;
  $('prevP').onclick = () => guarded(() => renderStudents(d.page - 1));
  $('nextP').onclick = () => guarded(() => renderStudents(d.page + 1));
}

function loadBulkImportTab() {
  $('tab-bulkImport').innerHTML = `<h2>Bulk student import</h2><div class="panel">
    <p class="hint">Required columns: student_id_no, roll_number, name, dob, gender, mobile, email, programme_code, semester, section_name, admission_year. Optional: fathers_name, mothers_name, address.</p>
    <div class="row"><input type="file" id="bulkFile" accept=".csv"><button class="btn" id="bulkValidateBtn">Upload and preview</button></div></div>
    <div id="bulkPreview"></div>`;
  $('bulkValidateBtn').addEventListener('click', () => guarded(onBulkValidate));
}

async function onBulkValidate() {
  const file = $('bulkFile').files[0];
  if (!file) { $('bulkPreview').innerHTML = '<p class="error-text">Choose a CSV file first.</p>'; return; }
  const form = new FormData(); form.append('file', file);
  $('bulkPreview').innerHTML = '<p class="muted">Checking every row…</p>';
  try { renderBulkPreview(await api('/admin/students/bulk/validate', { method: 'POST', body: form, isForm: true })); }
  catch (e) { $('bulkPreview').innerHTML = `<p class="error-text">${esc(e.message)}</p>`; }
}

function renderBulkPreview(d) {
  const rows = d.preview.map((r) => `<tr><td>${r.row_number}</td><td>${esc(r.data.student_id_no)}</td><td>${esc(r.data.name)}</td>
    <td>${r.errors.length ? '<span class="badge bad">Error</span>' : '<span class="badge ok">Valid</span>'}</td>
    <td class="hint">${esc(r.errors.join('; '))}</td></tr>`).join('');
  $('bulkPreview').innerHTML = `<div class="panel">
    <div class="row" style="margin-bottom:12px"><span class="badge ok">${d.validRows} valid</span><span class="badge bad">${d.errorRows} with errors</span><span class="muted">of ${d.totalRows} rows</span></div>
    <div class="table-wrap"><table><thead><tr><th>Row</th><th>Student ID</th><th>Name</th><th>Status</th><th>Issues</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${d.totalRows > d.preview.length ? `<p class="hint">Showing the first ${d.preview.length} rows.</p>` : ''}
    <div class="row" style="margin-top:16px"><button class="btn" id="bulkCommitBtn" ${d.validRows === 0 ? 'disabled' : ''}>Create ${d.validRows} student account(s)</button>
    <button class="btn secondary" id="bulkCancelBtn">Cancel this batch</button></div>
    <p class="hint" style="margin-top:8px">Rows with errors are always skipped. Fix them in the file and upload again.</p><div id="bulkResult" style="margin-top:14px"></div></div>`;
  $('bulkCommitBtn').addEventListener('click', () => guarded(() => onBulkCommit(d.batchId)));
  $('bulkCancelBtn').addEventListener('click', () => guarded(async () => { await api(`/admin/students/bulk/${d.batchId}/cancel`, { method: 'POST' }); loadBulkImportTab(); }));
}

async function onBulkCommit(batchId) {
  $('bulkCommitBtn').disabled = true;
  $('bulkResult').innerHTML = '<p class="muted">Creating accounts…</p>';
  try {
    const r = await api('/admin/students/bulk/commit', { method: 'POST', body: { batchId } });
    const rows = r.created.map((c) => `<tr><td>${esc(c.student_id_no)}</td><td>${esc(c.username)}</td><td>${esc(c.temporaryPassword)}</td></tr>`).join('');
    $('bulkResult').innerHTML = `<p><span class="badge ok">${r.createdCount} created</span> <span class="badge warn">${r.skippedCount} skipped</span></p>
      <p class="hint">Save these temporary passwords now. They are not shown again, and each student must change theirs at first login.</p>
      <button class="btn secondary" id="dlCreds">Download credentials CSV</button>
      <div class="table-wrap"><table><thead><tr><th>Student ID</th><th>Username</th><th>Temporary password</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    $('dlCreds').addEventListener('click', () => {
      const csv = 'student_id_no,username,temporary_password\n' + r.created.map((c) => `${c.student_id_no},${c.username},${c.temporaryPassword}`).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'student_credentials.csv'; a.click();
    });
  } catch (e) { $('bulkResult').innerHTML = `<p class="error-text">${esc(e.message)}</p>`; $('bulkCommitBtn').disabled = false; }
}

async function loadFaculty() {
  const depts = refData.departments.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
  $('tab-faculty').innerHTML = `<h2>Faculty</h2><div class="panel"><h3 style="font-size:15px">Add faculty member</h3>
    <div class="row"><input id="facEmpId" placeholder="Employee ID" style="width:120px"><input id="facName" placeholder="Full name" style="width:160px">
    <select id="facDept">${depts}</select><input id="facDesignation" placeholder="Designation" style="width:140px">
    <input id="facUsername" placeholder="Username" style="width:120px"><input id="facEmail" placeholder="Email" style="width:180px">
    <button class="btn" id="facAddBtn">Add</button></div><div id="facAddResult" style="margin-top:10px"></div></div>
    <div class="panel"><div class="table-wrap"><table id="facTable"><thead><tr><th>Employee ID</th><th>Name</th><th>Department</th><th>Username</th><th>Status</th><th></th></tr></thead><tbody></tbody></table></div></div>`;
  $('facAddBtn').addEventListener('click', onAddFaculty);
  await renderFacultyList();
}

async function onAddFaculty() {
  try {
    const r = await api('/admin/faculty', { method: 'POST', body: { employee_id: $('facEmpId').value.trim(), name: $('facName').value.trim(),
      department_id: $('facDept').value, designation: $('facDesignation').value.trim(), username: $('facUsername').value.trim(), email: $('facEmail').value.trim() } });
    $('facAddResult').innerHTML = `<span class="badge ok">Created</span> <span class="hint">Username <strong>${esc(r.username)}</strong>, temporary password <strong>${esc(r.temporaryPassword)}</strong>. Save it now.</span>`;
    await renderFacultyList();
  } catch (e) { $('facAddResult').innerHTML = `<p class="error-text">${esc(e.message)}</p>`; }
}

async function renderFacultyList() {
  const d = await api('/admin/faculty');
  const tb = document.querySelector('#facTable tbody');
  tb.innerHTML = d.faculty.length ? d.faculty.map((f) => `<tr><td>${esc(f.employee_id)}</td><td>${esc(f.name)}</td><td>${esc(f.department)}</td><td>${esc(f.username)}</td>
    <td><span class="badge ${f.is_active ? 'ok' : 'bad'}">${f.is_active ? 'Active' : 'Inactive'}</span></td>
    <td><button class="btn secondary" data-id="${esc(f.id)}" data-active="${esc(f.is_active)}">${f.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('')
    : '<tr><td colspan="6" class="muted">No faculty yet. Add the first one above.</td></tr>';
  tb.querySelectorAll('button[data-id]').forEach((b) => b.addEventListener('click', () => guarded(async () => {
    await api(`/admin/faculty/${b.dataset.id}/status`, { method: 'PATCH', body: { is_active: b.dataset.active === '0' } });
    await renderFacultyList();
  })));
}

async function loadAuditLog() {
  const d = await api('/admin/audit-logs?pageSize=50');
  $('tab-auditLog').innerHTML = `<h2>Audit log</h2><div class="panel"><div class="table-wrap"><table><thead><tr><th>When</th><th>User (role)</th><th>Action</th><th>Record</th><th>Reason</th></tr></thead><tbody>${
    d.logs.length ? d.logs.map((l) => `<tr><td class="hint">${esc(new Date(l.created_at).toLocaleString())}</td><td>${esc(l.user_id ?? '—')} (${esc(l.user_role ?? '—')})</td>
    <td>${esc(l.action)}</td><td>${esc(l.entity_type)}${l.entity_id ? ' #' + esc(l.entity_id) : ''}</td><td class="hint">${esc(l.reason || '')}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">No audit entries yet.</td></tr>'}</tbody></table></div></div>`;
}

init().catch((e) => toast(e.message));
