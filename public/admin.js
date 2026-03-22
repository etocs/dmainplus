const adminLoginCard = document.getElementById('admin-login-card');
const adminPanel = document.getElementById('admin-panel');
const adminLoginForm = document.getElementById('admin-login-form');
const adminPasswordInput = document.getElementById('admin-password');
const adminLoginMessage = document.getElementById('admin-login-message');

const userPassForm = document.getElementById('user-pass-form');
const userPassMessage = document.getElementById('user-pass-message');
const newUserPass = document.getElementById('new-user-pass');
const userPassList = document.getElementById('user-pass-list');

const adminPassForm = document.getElementById('admin-pass-form');
const adminPassMessage = document.getElementById('admin-pass-message');
const newAdminPass = document.getElementById('new-admin-pass');

const announcementForm = document.getElementById('announcement-form');
const announcementInput = document.getElementById('announcement-input');
const announcementMessage = document.getElementById('announcement-message');

const addDomainForm = document.getElementById('add-domain-form');
const domainNameInput = document.getElementById('domain-name');
const domainUrlInput = document.getElementById('domain-url');
const addDomainMessage = document.getElementById('add-domain-message');
const domainList = document.getElementById('domain-list');

const adminTokenKey = 'dmainplus_admin_token';

function setMessage(target, text, type = 'info') {
  if (!target) return;
  if (!text) {
    target.classList.add('hidden');
    target.textContent = '';
    return;
  }
  target.textContent = text;
  target.classList.remove('hidden');
  target.style.borderColor = type === 'error' ? 'rgba(255,123,123,0.5)' : 'rgba(90,209,209,0.5)';
}

function getAuthHeader() {
  const token = sessionStorage.getItem(adminTokenKey);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function toggleView(authed) {
  if (authed) {
    adminLoginCard.classList.add('hidden');
    adminPanel.classList.remove('hidden');
  } else {
    adminLoginCard.classList.remove('hidden');
    adminPanel.classList.add('hidden');
  }
}

async function loadAdminData() {
  try {
    const res = await fetch('/api/admin/data', { headers: getAuthHeader() });
    if (res.status === 401) {
      sessionStorage.removeItem(adminTokenKey);
      toggleView(false);
      return;
    }
    if (!res.ok) {
      setMessage(adminLoginMessage, '拉取数据失败，请稍后重试', 'error');
      return;
    }
    const data = await res.json();
    renderUserPasswords(data.userPasswords || []);
    renderDomains(data.domains || []);
    announcementInput.value = data.announcement || '';
    toggleView(true);
  } catch (error) {
    setMessage(adminLoginMessage, '网络异常，请检查连接', 'error');
  }
}

function renderUserPasswords(passwords) {
  userPassList.innerHTML = '';
  if (!passwords.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '暂无前端密码，请至少添加一个';
    userPassList.appendChild(empty);
    return;
  }

  passwords.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-item';

    const info = document.createElement('div');
    info.innerHTML = `<strong>密码 ${item.hint ? `...${item.hint}` : ''}</strong><br/><span class="muted">${
      item.createdAt ? new Date(item.createdAt).toLocaleString() : '创建时间未知'
    }</span>`;
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn secondary';
    delBtn.type = 'button';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => deleteUserPassword(item.id, delBtn));
    actions.appendChild(delBtn);

    row.appendChild(actions);
    userPassList.appendChild(row);
  });
}

function renderDomains(domains) {
  domainList.innerHTML = '';
  if (!domains.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '暂无域名，请添加新的专享域名';
    domainList.appendChild(empty);
    return;
  }

  domains.forEach((domain) => {
    const item = document.createElement('div');
    item.className = 'list-item';

    const info = document.createElement('div');
    info.innerHTML = `<strong>${domain.name || domain.url}</strong><br/><span class="muted">${domain.url}</span>`;
    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn secondary';
    delBtn.type = 'button';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => deleteDomain(domain.id, delBtn));
    actions.appendChild(delBtn);

    item.appendChild(actions);
    domainList.appendChild(item);
  });
}

async function deleteDomain(id, button) {
  button.disabled = true;
  try {
    const res = await fetch(`/api/admin/domains/${id}`, {
      method: 'DELETE',
      headers: getAuthHeader()
    });
    if (!res.ok) {
      throw new Error('delete failed');
    }
    await loadAdminData();
  } catch (error) {
    setMessage(addDomainMessage, '删除失败，请稍后重试', 'error');
  } finally {
    button.disabled = false;
  }
}

async function deleteUserPassword(id, button) {
  button.disabled = true;
  try {
    const res = await fetch(`/api/admin/user-passwords/${id}`, {
      method: 'DELETE',
      headers: getAuthHeader()
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      const message = payload && payload.message ? payload.message : '删除失败，请稍后重试';
      setMessage(userPassMessage, message, 'error');
      return;
    }
    setMessage(userPassMessage, '前端密码已删除', 'success');
    await loadAdminData();
  } catch (error) {
    setMessage(userPassMessage, '网络异常，请稍后重试', 'error');
  } finally {
    button.disabled = false;
  }
}

adminLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = adminPasswordInput.value.trim();
  if (!password) {
    setMessage(adminLoginMessage, '请输入管理员密码', 'error');
    return;
  }
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!res.ok) {
      setMessage(adminLoginMessage, '密码错误或网络异常', 'error');
      return;
    }
    const data = await res.json();
    sessionStorage.setItem(adminTokenKey, data.token);
    adminPasswordInput.value = '';
    setMessage(adminLoginMessage, '');
    loadAdminData();
  } catch (error) {
    setMessage(adminLoginMessage, '登录失败，请稍后重试', 'error');
  }
});

userPassForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = newUserPass.value.trim();
  if (!password) {
    setMessage(userPassMessage, '请输入新的前端密码', 'error');
    return;
  }
  try {
    const res = await fetch('/api/admin/user-passwords', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ password })
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      const message = payload && payload.message ? payload.message : '更新失败，请检查登录或密码长度';
      setMessage(userPassMessage, message, 'error');
      return;
    }
    setMessage(userPassMessage, '前端密码已新增', 'success');
    newUserPass.value = '';
    await loadAdminData();
  } catch (error) {
    setMessage(userPassMessage, '网络异常，请稍后重试', 'error');
  }
});

adminPassForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = newAdminPass.value.trim();
  if (!password) {
    setMessage(adminPassMessage, '请输入新的管理员密码', 'error');
    return;
  }
  try {
    const res = await fetch('/api/admin/admin-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ password })
    });
    if (!res.ok) {
      setMessage(adminPassMessage, '更新失败，请检查登录或密码长度', 'error');
      return;
    }
    setMessage(adminPassMessage, '管理员密码已更新', 'success');
    newAdminPass.value = '';
  } catch (error) {
    setMessage(adminPassMessage, '网络异常，请稍后重试', 'error');
  }
});

announcementForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await fetch('/api/admin/announcement', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ announcement: announcementInput.value })
    });
    if (!res.ok) {
      setMessage(announcementMessage, '发布失败，请检查登录状态', 'error');
      return;
    }
    setMessage(announcementMessage, '公告已发布', 'success');
  } catch (error) {
    setMessage(announcementMessage, '网络异常，请稍后重试', 'error');
  }
});

addDomainForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = domainNameInput.value.trim();
  const url = domainUrlInput.value.trim();
  if (!url) {
    setMessage(addDomainMessage, '请填写完整域名', 'error');
    return;
  }
  try {
    const res = await fetch('/api/admin/domains', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ name, url })
    });
    if (!res.ok) {
      setMessage(addDomainMessage, '添加失败，请检查域名格式或登录状态', 'error');
      return;
    }
    domainNameInput.value = '';
    domainUrlInput.value = '';
    setMessage(addDomainMessage, '域名已添加', 'success');
    loadAdminData();
  } catch (error) {
    setMessage(addDomainMessage, '网络异常，请稍后重试', 'error');
  }
});

if (sessionStorage.getItem(adminTokenKey)) {
  loadAdminData();
}
