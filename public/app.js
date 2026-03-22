const loginCard = document.getElementById('login-card');
const contentCard = document.getElementById('content-card');
const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('user-password');
const loginMessage = document.getElementById('login-message');
const announcementBox = document.getElementById('announcement');
const domainGrid = document.getElementById('domain-grid');
const latencyHint = document.getElementById('latency-hint');
const tokenKey = 'dmainplus_user_token';
const MAX_CONCURRENT_LATENCY_TESTS = 3;

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
  const token = sessionStorage.getItem(tokenKey);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function loadDomains() {
  try {
    const res = await fetch('/api/domains', { headers: getAuthHeader() });
    if (res.status === 401) {
      sessionStorage.removeItem(tokenKey);
      toggleView(false);
      return;
    }
    if (!res.ok) {
      setMessage(loginMessage, '加载域名失败，请稍后再试', 'error');
      return;
    }
    const data = await res.json();
    renderAnnouncement(data.announcement || '');
    renderDomains(data.domains || []);
    toggleView(true);
  } catch (error) {
    setMessage(loginMessage, '网络异常，请检查连接', 'error');
  }
}

function renderAnnouncement(text) {
  if (!text) {
    announcementBox.textContent = '暂无公告，祝您使用愉快！';
    return;
  }
  announcementBox.textContent = text;
}

function renderDomains(domains) {
  domainGrid.innerHTML = '';
  updateLatencyHint('');
  if (!domains.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '暂无可用域名，请联系管理员添加';
    domainGrid.appendChild(empty);
    return;
  }

  const queue = [];

  domains.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'domain-card';

    const title = document.createElement('h3');
    title.textContent = item.name || item.url;
    card.appendChild(title);

    const urlEl = document.createElement('div');
    urlEl.className = 'domain-url';
    urlEl.textContent = item.url;
    card.appendChild(urlEl);

    const actions = document.createElement('div');
    actions.className = 'domain-actions';

    const status = document.createElement('span');
    status.className = 'status muted';
    status.textContent = '等待自动测试';

    const btn = document.createElement('button');
    btn.className = 'btn secondary';
    btn.type = 'button';
    btn.textContent = '重新测试';
    btn.addEventListener('click', () => testLatency(item.url, status, btn));

    actions.appendChild(status);
    actions.appendChild(btn);
    card.appendChild(actions);

    domainGrid.appendChild(card);
    queue.push({ url: item.url, statusEl: status, btn });
  });

  startAutoLatency(queue);
}

async function testLatency(url, statusEl, btn, options = {}) {
  const { auto = false } = options;
  statusEl.textContent = auto ? '自动测试中...' : '测试中...';
  statusEl.className = 'status muted';
  if (btn) {
    btn.disabled = true;
  }
  try {
    const res = await fetch('/api/ping', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok || data.status === 'timeout' || data.reachable === false) {
      throw new Error('ping failed');
    }
    if (typeof data.latency === 'number' && data.status !== 'degraded') {
      statusEl.textContent = `${data.latency} ms`;
      statusEl.className = 'status ok';
    } else if (typeof data.latency === 'number') {
      statusEl.textContent = `${data.latency} ms · 可访问`;
      statusEl.className = 'status warn';
    } else {
      statusEl.textContent = '未获取到延迟';
      statusEl.className = 'status warn';
    }
    return true;
  } catch (error) {
    statusEl.textContent = '测试失败';
    statusEl.className = 'status fail';
    return false;
  } finally {
    if (btn) {
      btn.disabled = false;
    }
  }
}

function startAutoLatency(queue) {
  if (!queue.length) return;
  updateLatencyHint('正在自动测试延迟...');
  let active = 0;

  const runNext = () => {
    if (!queue.length && active === 0) {
      updateLatencyHint('自动测试完成，可点击“重新测试”刷新结果');
      return;
    }
    while (active < MAX_CONCURRENT_LATENCY_TESTS && queue.length) {
      const task = queue.shift();
      active += 1;
      testLatency(task.url, task.statusEl, task.btn, { auto: true })
        .catch((err) => console.warn('自动延迟检测失败', task.url, err))
        .finally(() => {
          active -= 1;
          runNext();
        });
    }
  };

  runNext();
}

function updateLatencyHint(text) {
  if (!latencyHint) return;
  latencyHint.textContent = text || '';
  latencyHint.classList.toggle('hidden', !text);
}

function toggleView(authed) {
  if (authed) {
    loginCard.classList.add('hidden');
    contentCard.classList.remove('hidden');
  } else {
    loginCard.classList.remove('hidden');
    contentCard.classList.add('hidden');
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = passwordInput.value.trim();
  if (!password) {
    setMessage(loginMessage, '请输入访问密码', 'error');
    return;
  }
  try {
    const res = await fetch('/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!res.ok) {
      setMessage(loginMessage, '密码错误或网络异常', 'error');
      return;
    }
    const data = await res.json();
    sessionStorage.setItem(tokenKey, data.token);
    passwordInput.value = '';
    setMessage(loginMessage, '');
    loadDomains();
  } catch (error) {
    setMessage(loginMessage, '登录失败，请稍后重试', 'error');
  }
});

if (sessionStorage.getItem(tokenKey)) {
  loadDomains();
}
