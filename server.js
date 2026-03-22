const express = require('express');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'data.json');
const JWT_SECRET = process.env.APP_SECRET || process.env.JWT_SECRET || 'replace-me-with-env-secret';
const PASSWORD_MIN_LENGTH = 6;
const REQUEST_TIMEOUT = 5000;

const DEFAULT_DATA = {
  announcement: '感谢您的赞助，以下域名可供专享使用：',
  domains: [
    {
      id: crypto.randomUUID(),
      name: '示例域名',
      url: 'https://example.com'
    }
  ],
  defaultUserPassword: process.env.DEFAULT_USER_PASSWORD || 'user123456',
  defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123456'
};

if (JWT_SECRET === 'replace-me-with-env-secret') {
  console.warn('警告：未设置 APP_SECRET 环境变量，建议尽快更换为复杂随机值。');
}

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function ensureDataFile() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return normalizeData(parsed);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
    return initializeData();
  }
}

function buildUserPasswordEntry(hash) {
  return {
    id: crypto.randomUUID(),
    hash,
    createdAt: new Date().toISOString()
  };
}

function maskPasswordEntry(entry) {
  if (!entry) return null;
  const hint = typeof entry.hash === 'string' && entry.hash.length >= 4 ? entry.hash.slice(-4) : '';
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    hint
  };
}

async function initializeData() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const userPasswordHash = await bcrypt.hash(DEFAULT_DATA.defaultUserPassword, 10);
  const payload = {
    announcement: DEFAULT_DATA.announcement,
    domains: DEFAULT_DATA.domains.map((item) => ({ ...item })),
    userPasswords: [buildUserPasswordEntry(userPasswordHash)],
    adminPasswordHash: await bcrypt.hash(DEFAULT_DATA.defaultAdminPassword, 10)
  };
  await fs.writeFile(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  return payload;
}

async function normalizeData(existing) {
  let updated = false;
  const data = { ...existing };

  if (!data.announcement) {
    data.announcement = DEFAULT_DATA.announcement;
    updated = true;
  }

  if (!Array.isArray(data.domains)) {
    data.domains = DEFAULT_DATA.domains.map((item) => ({ ...item }));
    updated = true;
  }

  const existingUserPasswords = Array.isArray(data.userPasswords) ? data.userPasswords : [];

  const normalizedUserPasswords = [];
  for (const item of existingUserPasswords) {
    if (item && typeof item.hash === 'string') {
      normalizedUserPasswords.push({
        id: item.id || crypto.randomUUID(),
        hash: item.hash,
        createdAt: item.createdAt || new Date().toISOString()
      });
    }
  }

  if (!normalizedUserPasswords.length && typeof data.userPasswordHash === 'string') {
    normalizedUserPasswords.push(buildUserPasswordEntry(data.userPasswordHash));
    delete data.userPasswordHash;
    updated = true;
  } else if (typeof data.userPasswordHash === 'string') {
    delete data.userPasswordHash;
    updated = true;
  }

  if (!normalizedUserPasswords.length) {
    const defaultHash = await bcrypt.hash(DEFAULT_DATA.defaultUserPassword, 10);
    normalizedUserPasswords.push(buildUserPasswordEntry(defaultHash));
    updated = true;
  }

  const isSameUserPasswords =
    normalizedUserPasswords.length === existingUserPasswords.length &&
    normalizedUserPasswords.every((entry) => {
      const matched = existingUserPasswords.find(
        (item) => item && item.id === entry.id && item.createdAt === entry.createdAt && item.hash === entry.hash
      );
      return Boolean(matched);
    });

  if (!isSameUserPasswords) {
    updated = true;
  }

  data.userPasswords = normalizedUserPasswords;

  if (!data.adminPasswordHash) {
    data.adminPasswordHash = await bcrypt.hash(DEFAULT_DATA.defaultAdminPassword, 10);
    updated = true;
  }

  if (updated) {
    await saveData(data);
  }

  return data;
}

async function saveData(data) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function signToken(role) {
  return jwt.sign({ role }, JWT_SECRET, { expiresIn: '1d' });
}

function authenticate(requiredRole) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: '未授权访问' });
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ message: '权限不足' });
      }
      req.userRole = payload.role;
      next();
    } catch (error) {
      return res.status(401).json({ message: '登录已过期，请重新登录' });
    }
  };
}

app.post('/api/user/login', async (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (!password) {
    return res.status(400).json({ message: '请输入密码' });
  }
  const data = await ensureDataFile();
  const candidates = Array.isArray(data.userPasswords) ? data.userPasswords : [];
  const comparisons = await Promise.all(
    candidates.map((entry) => {
      if (!entry || typeof entry.hash !== 'string') return Promise.resolve(false);
      return bcrypt.compare(password, entry.hash);
    })
  );
  const ok = comparisons.some(Boolean);
  if (!ok) {
    return res.status(401).json({ message: '密码错误' });
  }
  return res.json({ token: signToken('user') });
});

app.post('/api/admin/login', async (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (!password) {
    return res.status(400).json({ message: '请输入管理员密码' });
  }
  const data = await ensureDataFile();
  const ok = await bcrypt.compare(password, data.adminPasswordHash);
  if (!ok) {
    return res.status(401).json({ message: '管理员密码错误' });
  }
  return res.json({ token: signToken('admin') });
});

app.get('/api/domains', authenticate('user'), async (_req, res) => {
  const data = await ensureDataFile();
  res.json({
    announcement: data.announcement || '',
    domains: data.domains || []
  });
});

app.post('/api/ping', authenticate('user'), async (req, res) => {
  const url = (req.body && req.body.url) || '';
  if (!url) {
    return res.status(400).json({ message: '缺少域名地址' });
  }
  let target;
  try {
    target = new URL(url);
  } catch (error) {
    return res.status(400).json({ message: '无效的域名地址' });
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    return res.status(400).json({ message: '仅支持 http/https 协议' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  const started = Date.now();
  let upstreamStatus = null;

  async function performRequest(method) {
    const response = await fetch(target.toString(), {
      method,
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal
    });
    upstreamStatus = response.status;
    return response;
  }

  try {
    let response;
    try {
      response = await performRequest('HEAD');
      if (!response.ok && (response.status === 405 || response.status === 501)) {
        response = await performRequest('GET');
      } else if (!response.ok && response.status >= 500) {
        response = await performRequest('GET');
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.warn(
          'HEAD request failed for',
          target.toString(),
          '- retrying with GET:',
          error.message || error
        );
        response = await performRequest('GET');
      } else {
        throw error;
      }
    }
    const latency = Date.now() - started;
    return res.json({
      latency,
      status: response.ok ? 'ok' : 'degraded',
      upstreamStatus,
      reachable: response.status >= 200 && response.status < 300
    });
  } catch (error) {
    return res.json({
      latency: Date.now() - started,
      status: error.name === 'AbortError' ? 'timeout' : 'network-error',
      upstreamStatus,
      reachable: false,
      message: '延迟测试失败，请稍后重试'
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.get('/api/admin/data', authenticate('admin'), async (_req, res) => {
  const data = await ensureDataFile();
  res.json({
    announcement: data.announcement || '',
    domains: data.domains || [],
    userPasswords: (data.userPasswords || []).map((item) => maskPasswordEntry(item)).filter(Boolean)
  });
});

app.get('/api/admin/user-passwords', authenticate('admin'), async (_req, res) => {
  const data = await ensureDataFile();
  return res.json({
    passwords: (data.userPasswords || []).map((item) => maskPasswordEntry(item)).filter(Boolean)
  });
});

app.post('/api/admin/user-passwords', authenticate('admin'), async (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return res
      .status(400)
      .json({ message: `密码至少需要 ${PASSWORD_MIN_LENGTH} 位` });
  }
  const data = await ensureDataFile();
  const hash = await bcrypt.hash(password, 10);
  const entry = buildUserPasswordEntry(hash);
  data.userPasswords.push(entry);
  await saveData(data);
  return res
    .status(201)
    .json({ message: '前端访问密码已新增', password: maskPasswordEntry(entry) });
});

app.delete('/api/admin/user-passwords/:id', authenticate('admin'), async (req, res) => {
  const { id } = req.params;
  const data = await ensureDataFile();
  const currentUserPasswords = data.userPasswords || [];
  const next = currentUserPasswords.filter((item) => item.id !== id);
  if (next.length === currentUserPasswords.length) {
    return res.status(404).json({ message: '未找到该前端访问密码' });
  }
  if (!next.length) {
    return res.status(400).json({ message: '至少保留一个前端访问密码以保证可访问' });
  }
  data.userPasswords = next;
  await saveData(data);
  return res.json({ message: '前端访问密码已删除' });
});

app.post('/api/admin/user-password', authenticate('admin'), async (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return res
      .status(400)
      .json({ message: `密码至少需要 ${PASSWORD_MIN_LENGTH} 位` });
  }
  const data = await ensureDataFile();
  const hash = await bcrypt.hash(password, 10);
  data.userPasswords = [buildUserPasswordEntry(hash)];
  await saveData(data);
  return res.json({
    message: '前端访问密码已重置，仅保留最新设置的密码',
    warning: '该接口将逐步弃用，请使用 /api/admin/user-passwords 添加或删除前端访问密码'
  });
});

app.post('/api/admin/admin-password', authenticate('admin'), async (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return res
      .status(400)
      .json({ message: `管理员密码至少需要 ${PASSWORD_MIN_LENGTH} 位` });
  }
  const data = await ensureDataFile();
  data.adminPasswordHash = await bcrypt.hash(password, 10);
  await saveData(data);
  return res.json({ message: '管理员密码已更新' });
});

app.post('/api/admin/announcement', authenticate('admin'), async (req, res) => {
  const announcement = (req.body && req.body.announcement) || '';
  if (typeof announcement !== 'string' || announcement.length > 1000) {
    return res.status(400).json({ message: '公告内容过长或无效' });
  }
  const data = await ensureDataFile();
  data.announcement = announcement;
  await saveData(data);
  return res.json({ message: '公告已更新' });
});

app.post('/api/admin/domains', authenticate('admin'), async (req, res) => {
  const { name, url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ message: '请输入有效的域名地址' });
  }
  let target;
  try {
    target = new URL(url);
  } catch (error) {
    return res.status(400).json({ message: '域名格式错误' });
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    return res.status(400).json({ message: '仅支持 http/https 协议' });
  }

  const data = await ensureDataFile();
  const domain = {
    id: crypto.randomUUID(),
    name: name && typeof name === 'string' ? name.trim() || target.hostname : target.hostname,
    url: target.toString()
  };
  data.domains.push(domain);
  await saveData(data);
  return res.status(201).json({ message: '域名已添加', domain });
});

app.delete('/api/admin/domains/:id', authenticate('admin'), async (req, res) => {
  const { id } = req.params;
  const data = await ensureDataFile();
  const nextDomains = data.domains.filter((item) => item.id !== id);
  if (nextDomains.length === data.domains.length) {
    return res.status(404).json({ message: '未找到该域名' });
  }
  data.domains = nextDomains;
  await saveData(data);
  return res.json({ message: '域名已删除' });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ message: '未找到接口' });
  }
  next();
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: '服务器错误，请稍后重试' });
});

ensureDataFile()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`dmainplus server is running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server', err);
    process.exit(1);
  });
