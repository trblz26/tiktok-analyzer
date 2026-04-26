// popup.js — DOM scroll strategy, reads [data-e2e="video-views"] directly

let cachedData = null;

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('btnCrawl').addEventListener('click', startCrawl);
  document.getElementById('btnCSV').addEventListener('click', exportCSV);
  document.getElementById('btnJSON').addEventListener('click', exportJSON);
  document.getElementById('btnRefresh').addEventListener('click', startCrawl);
  document.getElementById('btnDebug').addEventListener('click', () => {
    navigator.clipboard.writeText(window._lastDebugLog || '(no log)');
    showToast('Đã copy debug log ✓');
  });
  document.getElementById('dayBlocks').addEventListener('click', (e) => {
    const header = e.target.closest('[data-toggle="day"]');
    if (header) toggleDay(header);
  });

  const tab = await getActiveTab();
  if (!tab) return;
  const isOk = /tiktok\.com\/@[^/]+/.test(tab.url);
  if (!isOk) {
    showError('Hãy mở trang profile TikTok trước!\nVD: https://www.tiktok.com/@username');
    document.getElementById('btnCrawl').disabled = true;
    return;
  }
  const stored = await chrome.storage.local.get(['lastData', 'lastUrl']);
  if (stored.lastData && stored.lastUrl === tab.url) {
    cachedData = stored.lastData;
    renderResult(cachedData);
    document.getElementById('headerSub').textContent =
      'Cache: ' + new Date(stored.lastData.crawledAt).toLocaleTimeString('vi-VN');
  }
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function startCrawl() {
  const tab = await getActiveTab();
  if (!tab) return;
  showLoading('Đang scroll tải video...', 'Đang cuộn trang, vui lòng đợi...');
  document.getElementById('btnCrawl').disabled = true;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrollAndCollect,
    });
    const result = results?.[0]?.result;
    if (!result || !result.success) {
      const errMsg = result?.error || 'Không lấy được dữ liệu.';
      window._lastDebugLog = result?.debugLog || errMsg;
      showError(errMsg);
      document.getElementById('btnDebug').style.display = 'inline-block';
      document.getElementById('btnCrawl').disabled = false;
      return;
    }
    const data = result.data;
    cachedData = data;
    chrome.storage.local.set({ lastData: data, lastUrl: tab.url });
    document.getElementById('headerSub').textContent =
      data.totalFound + ' video — ' + new Date().toLocaleTimeString('vi-VN');
    document.getElementById('btnCrawl').disabled = false;
    renderResult(data);
  } catch (err) {
    showError('Lỗi: ' + err.message);
    document.getElementById('btnCrawl').disabled = false;
  }
}

// Runs inside the TikTok tab
async function scrollAndCollect() {
  const log = [];
  const SEVEN_DAYS_AGO_MS = Date.now() - 7 * 24 * 3600 * 1000;

  function decodeTimestamp(videoId) {
    try {
      const ts = Number(BigInt(videoId) >> 32n) * 1000;
      return (ts > 1_000_000_000_000 && ts < 2_000_000_000_000) ? ts : 0;
    } catch { return 0; }
  }

  function parseCount(text) {
    if (!text) return 0;
    const t = text.trim().replace(/,/g, '');
    if (t.endsWith('M') || t.endsWith('m')) return Math.round(parseFloat(t) * 1_000_000);
    if (t.endsWith('K') || t.endsWith('k')) return Math.round(parseFloat(t) * 1_000);
    return parseInt(t) || 0;
  }

  function collectItems() {
    const items = document.querySelectorAll('[data-e2e="user-post-item"]');
    const results = [];
    const seen = new Set();
    for (const item of items) {
      const link = item.querySelector('a[href*="/video/"]');
      if (!link) continue;
      const m = link.href.match(/\/video\/(\d+)/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      const videoId = m[1];
      const createTimeMs = decodeTimestamp(videoId);
      const viewEl = item.querySelector('[data-e2e="video-views"]');
      const imgEl = item.querySelector('img[alt]');
      results.push({
        id: videoId,
        createTime: Math.floor(createTimeMs / 1000),
        createTimeMs,
        desc: imgEl?.alt || '',
        cover: imgEl?.src || '',
        videoUrl: link.href,
        stats: {
          playCount: parseCount(viewEl?.textContent),
          diggCount: 0, commentCount: 0, shareCount: 0, collectCount: 0,
        },
      });
    }
    return results;
  }

  function getUserInfo() {
    const q = (s) => document.querySelector(s)?.textContent?.trim() || '';
    return {
      handle:    window.location.pathname.replace('/@', '').split('/')[0],
      nickname:  q('[data-e2e="user-title"]') || q('h1[data-e2e]') || '',
      followers: q('[data-e2e="followers-count"]'),
      following: q('[data-e2e="following-count"]'),
      likes:     q('[data-e2e="likes-count"]'),
      avatar:    document.querySelector('[data-e2e="user-avatar"] img')?.src || '',
    };
  }

  function oldestBeyond7Days(items) {
    const withTime = items.filter(v => v.createTimeMs > 0);
    if (!withTime.length) return false;
    return Math.min(...withTime.map(v => v.createTimeMs)) < SEVEN_DAYS_AGO_MS;
  }

  async function scrollLoop() {
    const MAX_SCROLLS = 30, SCROLL_DELAY = 1300, STALL_LIMIT = 3;
    let lastCount = 0, stall = 0;
    for (let i = 0; i < MAX_SCROLLS; i++) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, SCROLL_DELAY));
      const items = collectItems();
      log.push('Scroll #' + (i+1) + ': ' + items.length + ' items');
      if (oldestBeyond7Days(items)) { log.push('Oldest beyond 7d, stop.'); break; }
      if (items.length === lastCount) { if (++stall >= STALL_LIMIT) { log.push('Stalled, stop.'); break; } }
      else { stall = 0; lastCount = items.length; }
    }
  }

  try {
    const user = getUserInfo();
    log.push('Profile: @' + user.handle);
    const initial = collectItems();
    log.push('Initial: ' + initial.length);
    if (!initial.length) return {
      success: false,
      error: 'Không thấy video nào. Hãy đảm bảo trang profile đã load xong.',
      debugLog: log.join('\n'),
    };
    await scrollLoop();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const all = collectItems();
    const filtered = all
      .filter(v => v.createTimeMs === 0 || v.createTimeMs >= SEVEN_DAYS_AGO_MS)
      .sort((a, b) => b.createTime - a.createTime);
    log.push('Filtered: ' + filtered.length);
    if (!filtered.length) return {
      success: false, error: 'Không có video nào trong 7 ngày gần nhất.', debugLog: log.join('\n'),
    };
    return {
      success: true,
      data: { user, videos: filtered, crawledAt: Date.now(), totalFound: filtered.length, _log: log },
    };
  } catch(e) {
    return { success: false, error: 'Lỗi: ' + e.message, debugLog: log.join('\n') };
  }
}

// ─── UI ─────────────────────────────────────────────────────────────────────

function showLoading(text, sub) {
  hideAll();
  document.getElementById('stateLoading').style.display = 'block';
  document.getElementById('loadingText').textContent = text;
  document.getElementById('loadingSub').textContent = sub;
}
function showError(msg) {
  hideAll();
  document.getElementById('stateError').style.display = 'block';
  document.getElementById('errorMsg').textContent = msg;
}
function hideAll() {
  ['stateIdle','stateLoading','stateError','stateResult'].forEach(id =>
    document.getElementById(id).style.display = 'none');
}

// ─── RENDER ─────────────────────────────────────────────────────────────────

function renderResult(data) {
  hideAll();
  document.getElementById('stateResult').style.display = 'block';
  renderUserCard(data.user);
  renderMetrics(data.videos);
  renderHeatmap(data.videos);
  renderDayBlocks(data.videos);
}

function renderUserCard(user) {
  const card = document.getElementById('userCard');
  const initials = (user?.nickname || user?.handle || 'TK').substring(0,2).toUpperCase();
  const avatarHtml = user?.avatar
    ? '<img src="' + user.avatar + '" onerror="this.style.display=\'none\'">' : initials;
  card.innerHTML = '<div class="user-avatar">' + avatarHtml + '</div><div>' +
    '<div class="user-name">' + esc(user?.nickname || user?.handle || 'TikTok User') + '</div>' +
    '<div class="user-handle">@' + esc(user?.handle || '') + '</div>' +
    '<div class="user-stats-row">' +
    (user?.followers ? '<div class="user-stat"><strong>' + user.followers + '</strong> followers</div>' : '') +
    (user?.following ? '<div class="user-stat"><strong>' + user.following + '</strong> following</div>' : '') +
    (user?.likes     ? '<div class="user-stat"><strong>' + user.likes     + '</strong> likes</div>'     : '') +
    '</div></div>';
}

function renderMetrics(videos) {
  const totalViews = videos.reduce((s,v) => s+(v.stats.playCount||0), 0);
  const avgViews   = videos.length ? Math.round(totalViews/videos.length) : 0;
  const maxViews   = videos.reduce((m,v) => Math.max(m, v.stats.playCount||0), 0);
  document.getElementById('metricsRow').innerHTML =
    '<div class="metric-card"><div class="metric-val accent">' + videos.length + '</div><div class="metric-label">Video</div></div>' +
    '<div class="metric-card"><div class="metric-val teal">' + fmtNum(totalViews) + '</div><div class="metric-label">Tổng xem</div></div>' +
    '<div class="metric-card"><div class="metric-val gold">' + fmtNum(avgViews) + '</div><div class="metric-label">TB/video</div></div>' +
    '<div class="metric-card"><div class="metric-val purple">' + fmtNum(maxViews) + '</div><div class="metric-label">Cao nhất</div></div>';
}

function renderHeatmap(videos) {
  const hourCount = new Array(24).fill(0);
  videos.forEach(v => {
    if (!v.createTime) return;
    hourCount[new Date((v.createTime + 7*3600)*1000).getUTCHours()]++;
  });
  const maxCount = Math.max(...hourCount, 1);
  const cells = hourCount.map((c,h) => {
    const level = c===0 ? 0 : Math.ceil((c/maxCount)*4);
    return '<div class="heatmap-cell" data-count="' + Math.min(level,4) + '" ' +
      (level>=4 ? 'data-level="high"' : '') + ' title="' + h + 'h: ' + c + ' video"></div>';
  }).join('');
  const labels = Array.from({length:24},(_,h) =>
    '<div class="heatmap-label">' + (h%6===0 ? h+'h' : '') + '</div>').join('');
  document.getElementById('heatmapWrap').innerHTML =
    '<div class="heatmap-title">Phân bố giờ đăng (giờ VN)</div>' +
    '<div class="heatmap-grid">' + cells + '</div>' +
    '<div class="heatmap-labels">' + labels + '</div>';
}

function renderDayBlocks(videos) {
  const groups = {};
  videos.forEach(v => {
    if (!v.createTime) return;
    const d   = new Date((v.createTime+7*3600)*1000);
    const key = d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0');
    if (!groups[key]) groups[key] = [];
    groups[key].push(v);
  });
  const sortedDays = Object.keys(groups).sort((a,b) => b.localeCompare(a));
  const container  = document.getElementById('dayBlocks');
  container.innerHTML = '';
  if (!sortedDays.length) {
    container.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:12px;">Không có video trong 7 ngày</div>';
    return;
  }
  const today    = new Date();
  const todayKey = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

  sortedDays.forEach((day,idx) => {
    const vids       = groups[day].sort((a,b) => b.createTime-a.createTime);
    const totalViews = vids.reduce((s,v) => s+(v.stats.playCount||0), 0);
    const [y,m,d]   = day.split('-');
    const dateLabel  = day===todayKey ? 'Hôm nay — ' + d + '/' + m : d+'/'+m+'/'+y;
    const block = document.createElement('div');
    block.className = 'day-block';
    block.innerHTML =
      '<div class="day-header" data-toggle="day">' +
        '<div>' +
          '<div class="day-date">' + dateLabel + '</div>' +
          '<div style="font-size:10px;color:var(--muted);margin-top:2px;">👁 ' + fmtNum(totalViews) + ' lượt xem</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-left:auto;">' +
          '<span class="day-count-badge">' + vids.length + ' video</span>' +
          '<span class="day-chevron">▼</span>' +
        '</div>' +
      '</div>' +
      '<div class="video-list ' + (idx===0?'open':'') + '">' +
        vids.map(v => renderVideoItem(v)).join('') +
      '</div>';
    if (idx===0) block.querySelector('.day-chevron').classList.add('open');
    container.appendChild(block);
  });
}

function renderVideoItem(v) {
  const dt      = new Date((v.createTime+7*3600)*1000);
  const timeStr = String(dt.getUTCHours()).padStart(2,'0') + ':' + String(dt.getUTCMinutes()).padStart(2,'0');
  const desc    = v.desc || '(Không có mô tả)';
  const views   = v.stats.playCount;

  const thumbHtml = v.cover
    ? '<a href="' + v.videoUrl + '" target="_blank" style="flex-shrink:0;display:block;width:36px;height:48px;border-radius:5px;overflow:hidden;border:1px solid var(--border2);">' +
        '<img src="' + v.cover + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy">' +
      '</a>'
    : '';

  const viewPill = views > 0
    ? '<span class="stat-pill views">👁 ' + fmtNum(views) + '</span>'
    : '<span class="stat-pill" style="color:var(--muted);font-size:10px;">👁 –</span>';

  const linkHtml = v.videoUrl
    ? '<a href="' + v.videoUrl + '" target="_blank" style="color:var(--teal);font-size:10px;text-decoration:none;flex-shrink:0;" title="Xem video">↗</a>'
    : '';

  return '<div class="video-item">' +
    thumbHtml +
    '<div class="video-time">' + timeStr + '</div>' +
    '<div class="video-info" style="min-width:0;">' +
      '<div style="display:flex;align-items:flex-start;gap:4px;margin-bottom:4px;">' +
        '<div class="video-desc" style="flex:1;" title="' + esc(desc) + '">' + esc(desc) + '</div>' +
        linkHtml +
      '</div>' +
      '<div class="video-stats">' + viewPill + '</div>' +
    '</div>' +
  '</div>';
}

function toggleDay(header) {
  header.nextElementSibling.classList.toggle('open');
  header.querySelector('.day-chevron').classList.toggle('open');
}

// ─── EXPORT ─────────────────────────────────────────────────────────────────

function exportCSV() {
  if (!cachedData) return;
  const rows = [['Ngày','Giờ (VN)','Lượt xem','Mô tả','Link']];
  cachedData.videos.forEach(v => {
    if (!v.createTime) return;
    const dt   = new Date((v.createTime+7*3600)*1000);
    const date = dt.getUTCFullYear() + '-' + String(dt.getUTCMonth()+1).padStart(2,'0') + '-' + String(dt.getUTCDate()).padStart(2,'0');
    const time = String(dt.getUTCHours()).padStart(2,'0') + ':' + String(dt.getUTCMinutes()).padStart(2,'0');
    rows.push([date, time, v.stats.playCount||0, '"'+(v.desc||'').replace(/"/g,'""')+'"', v.videoUrl||'']);
  });
  downloadFile('\uFEFF' + rows.map(r=>r.join(',')).join('\n'),
    'tiktok_' + (cachedData.user?.handle||'profile') + '_' + dateStr() + '.csv', 'text/csv');
  showToast('Đã xuất CSV ✓');
}

function exportJSON() {
  if (!cachedData) return;
  downloadFile(JSON.stringify(cachedData,null,2),
    'tiktok_' + (cachedData.user?.handle||'profile') + '_' + dateStr() + '.json', 'application/json');
  showToast('Đã xuất JSON ✓');
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content],{type});
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {href:url, download:filename});
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── UTILS ──────────────────────────────────────────────────────────────────

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+'M';
  if (n >= 1_000)     return (n/1_000).toFixed(1)+'K';
  return n.toString();
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function dateStr() {
  const d = new Date();
  return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
