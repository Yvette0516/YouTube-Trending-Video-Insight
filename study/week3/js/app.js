/* ==========================================================================
 * 韩国热门视频播放量 TOP10 —— 前端交互逻辑
 * ---------------------------------------------------------------------------
 * 第三周核心：DOM 操作 + 事件绑定 + 用 fetch 读取本地 CSV/JSON + 交互渲染
 *
 * 页面打开时用 fetch 读取 data/ 下的三个文件，在浏览器里现场解析、清洗、
 * 去重、排序，再渲染成表格 —— 没有任何预生成的 JSON，也不用 pandas。
 *
 * 整体流程（从下往上读代码正好是这个顺序）：
 *   boot()        启动：显示加载提示 → 读数据 → 建下拉 → 渲染
 *   loadData()    用 fetch 读三个文件，解析出视频数组
 *   parseCsv()    引用感知的 CSV 解析器（CSV 里有逗号和换行在引号内）
 *   render()      筛选 → 排序 → 截取前 N 条 → 画表格
 *   bindEvents()  搜索 / 类别 / 排序 / 重置四个交互
 *
 * 安全约定：所有来自数据的文本（标题、频道名、类别名）都用 textContent
 *          写进 DOM，不拼 HTML 字符串，避免 XSS。
 * ========================================================================== */

(function () {
  'use strict';

  /* ======================================================================
   * 1. 配置与 DOM 引用
   * ==================================================================== */

  var CONFIG = {
    csvUrl: 'data/KRvideos.csv',                       // 原始 CSV，34.8 MB
    categoryJsonUrl: 'data/KR_category_id.json',       // 类别英文名
    categoryMapUrl: 'data/YouTube视频分类映射表.csv',   // 类别中文名
    topN: 10,             // 没筛选时只显示前 10 名
    filteredLimit: 100,   // 有筛选时最多显示 100 条（本页不做分页）
    timeoutMs: 120000,    // CSV 很大，给 2 分钟超时
  };

  // 错误提示里要列出文件名，提前拼好
  var FILE_LIST = 'KRvideos.csv、KR_category_id.json 和 YouTube视频分类映射表.csv';

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    updatedAt: $('data-updated-at'),
    totalBadge: $('data-total'),
    searchInput: $('search-input'),
    searchClear: $('search-clear'),
    categorySelect: $('category-select'),
    sortButtons: Array.prototype.slice.call(document.querySelectorAll('.sort-btn')),
    resetBtn: $('reset-btn'),
    summary: $('result-summary'),
    status: $('status-region'),
    statusSpinner: $('status-spinner'),
    statusTitle: $('status-title'),
    statusDetail: $('status-detail'),
    statusRetry: $('status-retry'),
    listSection: $('list-section'),
    rankBody: $('rank-body'),
  };

  // 当前的筛选与排序条件
  var state = {
    allVideos: [],        // 解析后的全部视频（已去重、已排序）
    keyword: '',
    category: '',
    sortKey: 'views',
    loadError: null,
  };

  var SORT_LABELS = { views: '播放量', likes: '点赞数', like_rate: '点赞率' };

  /* ======================================================================
   * 2. 格式化
   * ==================================================================== */

  /** 千分位：113876217 -> "113,876,217" */
  function fmtNumber(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return Math.round(n).toLocaleString('en-US');
  }

  /** 点赞率：0.024687 -> "2.47%" */
  function fmtPercent(r) {
    if (typeof r !== 'number' || !isFinite(r)) return '—';
    return (r * 100).toFixed(2) + '%';
  }

  /** 时间戳 -> "2026/9/19 23:28" */
  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var pad = function (x) { return x < 10 ? '0' + x : String(x); };
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate()
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** 文本转数字，解析不出来返回 null（这样能跟真实的 0 区分开） */
  function toNumber(raw) {
    if (raw === undefined || raw === null) return null;
    var s = String(raw).trim().replace(/,/g, '');
    if (s === '') return null;
    var v = Number(s);
    return isFinite(v) ? v : null;
  }

  /* ======================================================================
   * 3. CSV 解析
   *
   * 不能简单地按行 split('\n') 再用逗号切 —— 原始 CSV 的 tags 和
   * description 字段里有被引号包起来的逗号和换行，那样切会让字段错位、
   * 悄悄丢掉数据。所以必须一个字符一个字符地读，记住自己是否在引号内。
   * ==================================================================== */
  function parseCsv(text) {
    var src = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;  // 去掉 BOM
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;

    for (var i = 0; i < src.length; i += 1) {
      var ch = src.charAt(i);

      if (inQuotes) {
        if (ch === '"') {
          if (src.charAt(i + 1) === '"') { field += '"'; i += 1; }  // "" 表示一个引号
          else inQuotes = false;                                    // 引号结束
        } else {
          field += ch;
        }
        continue;
      }

      if (ch === '"') { inQuotes = true; continue; }
      if (ch === ',') { row.push(field); field = ''; continue; }
      if (ch === '\r') continue;                                    // 忽略回车
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
      field += ch;
    }
    // 最后一行可能没有换行符结尾
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  /* ======================================================================
   * 4. 读取与清洗数据
   * ==================================================================== */

  /** 带超时的 fetch，避免网络异常时页面一直转圈 */
  function fetchText(url, asText) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, CONFIG.timeoutMs);

    return fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('请求 ' + url + ' 失败，HTTP 状态码 ' + res.status);
        if (!asText) return res.json();
        /*
         * 原始 CSV 里有少量损坏字节，直接用 res.text()（内部是 fatal 解码）
         * 会整份读不出来。这里用 fatal:false 把坏字节换成「�」继续读，
         * 之后再把这些行丢掉（见下面的 brokenKey 判断）。
         */
        return res.arrayBuffer().then(function (buf) {
          return new TextDecoder('utf-8', { fatal: false }).decode(buf);
        });
      })
      .catch(function (err) {
        clearTimeout(timer);
        throw err;
      });
  }

  /** 把「类别 id -> 中文名」和「类别 id -> 英文名」两张表建好 */
  function buildCategoryMaps(mapText, catJson) {
    var idToZh = {};
    var mapRows = parseCsv(mapText);
    var head = mapRows[0];
    var iId = head.indexOf('category_id');
    var iZh = head.indexOf('chinese_name');
    if (iId < 0 || iZh < 0) throw new Error('映射表缺少 category_id 或 chinese_name 列');

    for (var i = 1; i < mapRows.length; i += 1) {
      var r = mapRows[i];
      if (r && r.length > iZh && String(r[iId]).trim()) {
        idToZh[String(r[iId]).trim()] = String(r[iZh]).trim();
      }
    }

    var idToEn = {};
    ((catJson && catJson.items) || []).forEach(function (item) {
      idToEn[String(item.id)] = (item.snippet && item.snippet.title) || '';
    });

    return { zh: idToZh, en: idToEn };
  }

  /** 读三个文件并处理成最终的视频数组 */
  function loadData() {
    var startedAt = Date.now();

    return Promise.all([
      fetchText(CONFIG.categoryJsonUrl, false),
      fetchText(CONFIG.categoryMapUrl, true),
      fetchText(CONFIG.csvUrl, true),
    ]).then(function (res) {
      var maps = buildCategoryMaps(res[1], res[0]);

      var records = parseCsv(res[2]);
      if (!records.length) throw new Error('CSV 内容为空，无法解析。');

      // 表头建一份「列名 -> 列号」的索引
      var header = records[0];
      var col = {};
      header.forEach(function (name, i) { col[name] = i; });

      var required = ['video_id', 'title', 'channel_title', 'category_id', 'views',
        'likes', 'dislikes', 'comment_count', 'trending_date', 'publish_time', 'tags'];
      required.forEach(function (name) {
        if (col[name] === undefined) throw new Error('原始 CSV 缺少必需字段：' + name);
      });

      // 按 video_id 去重：同一个视频可能因为多次上榜出现好几行，保留播放量最高的
      var best = {};
      var dropped = 0;

      for (var i = 1; i < records.length; i += 1) {
        var rec = records[i];
        if (rec.length !== header.length) continue;   // 字段数不对的行跳过

        var videoId = String(rec[col.video_id] || '').trim();
        var title = String(rec[col.title] || '').trim();
        var channel = String(rec[col.channel_title] || '').trim();
        var views = toNumber(rec[col.views]);

        if (!videoId || !title || !channel || views === null) { dropped += 1; continue; }
        // 关键字段里有「�」说明这行的字节坏了，不可信，丢掉
        if (videoId.indexOf('\uFFFD') >= 0 || title.indexOf('\uFFFD') >= 0
          || channel.indexOf('\uFFFD') >= 0) { dropped += 1; continue; }

        var likes = toNumber(rec[col.likes]) || 0;
        var prev = best[videoId];
        if (prev) {
          if (prev.views > views) continue;
          // 播放量相同时比点赞，留下数值更完整的那条
          if (prev.views === views && prev.likes >= likes) continue;
        }

        var categoryId = String(rec[col.category_id] || '').trim();

        best[videoId] = {
          video_id: videoId,
          title: title,
          channel_title: channel,
          category_name: maps.zh[categoryId] || maps.en[categoryId] || '未分类',
          views: views,
          likes: likes,
          comment_count: toNumber(rec[col.comment_count]) || 0,
          like_rate: views > 0 ? Number((likes / views).toFixed(6)) : 0,
          trending_date: String(rec[col.trending_date] || '').trim(),
        };
      }

      // 排序：播放量降序 → 点赞降序 → video_id 升序
      // 第三个条件是为了「播放量和点赞都相同」时结果固定，刷新多少次都一样
      var videos = Object.keys(best).map(function (id) { return best[id]; });
      videos.sort(function (a, b) {
        return (b.views - a.views)
          || (b.likes - a.likes)
          || (a.video_id < b.video_id ? -1 : a.video_id > b.video_id ? 1 : 0);
      });

      var seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.info('[week3] 浏览器端处理完成：' + (records.length - 1) + ' 行 → 去重后 '
        + videos.length + ' 条，耗时 ' + seconds + ' 秒（丢弃异常行 ' + dropped + '）');

      return {
        videos: videos,
        generatedAt: new Date().toISOString(),
        rowCount: records.length - 1,
      };
    });
  }

  /* ======================================================================
   * 5. 状态提示区（加载中 / 加载失败 / 无结果）
   * ==================================================================== */

  function showStatus(o) {
    el.status.hidden = false;
    el.status.classList.toggle('status--error', !!o.error);
    el.statusSpinner.hidden = !o.spinner;
    el.statusTitle.textContent = o.title || '';
    el.statusTitle.hidden = !o.title;
    el.statusDetail.textContent = o.detail || '';
    el.statusDetail.hidden = !o.detail;
    el.statusRetry.hidden = !o.retry;

    // 不是加载中（也就是出错了）就把表格藏起来
    if (!o.spinner) el.listSection.hidden = true;
  }

  function renderLoading() {
    el.summary.hidden = true;
    showStatus({
      spinner: true,
      title: '正在加载并解析数据…',
      detail: '读取 ' + FILE_LIST
        + '\nCSV 约 35 MB，浏览器要现场解析去重，首次打开请稍候。',
    });
  }

  function renderError(err) {
    var isFile = location.protocol === 'file:';
    el.summary.hidden = true;

    if (isFile) {
      showStatus({
        error: true,
        retry: true,
        title: '需要通过本地服务器打开页面',
        detail: '检测到当前用 file:// 直接打开了页面。浏览器出于安全策略会阻止 fetch 读取本地文件。\n'
          + '请改用本地静态服务器访问：\n'
          + '  1) VS Code 装 Live Server 扩展，右键 index.html → Open with Live Server\n'
          + '  2) 或用任意静态服务器，把网站根指向 study/week3\n'
          + '然后访问 http://localhost:5500/',
      });
    } else {
      showStatus({
        error: true,
        retry: true,
        title: '数据加载失败',
        detail: '无法读取 ' + FILE_LIST + '。\n'
          + '这三个文件应该在 study/week3/data/ 下（可从 data/archive.zip 解压得到）。\n'
          + '错误信息：' + (err && err.message ? err.message : String(err)),
      });
    }
  }

  /* ======================================================================
   * 6. 渲染
   * ==================================================================== */

  /** 顶部：数据更新时间与总条数 */
  function renderMeta(generatedAt, total) {
    el.updatedAt.textContent = fmtTime(generatedAt);
    el.updatedAt.title = generatedAt || '';
    el.totalBadge.textContent = '数据集 ' + fmtNumber(total) + ' 条';
  }

  /** 统计条：共匹配多少条 + 当前条件 */
  function renderSummary(total, shown, isFiltered) {
    var parts = ['共匹配 ' + fmtNumber(total) + ' 条'];

    parts.push('按' + SORT_LABELS[state.sortKey] + '降序');

    if (isFiltered) {
      parts.push(shown < total ? '显示前 ' + fmtNumber(shown) + ' 条' : '全部显示');
      if (state.keyword.trim()) parts.push('关键词「' + state.keyword.trim() + '」');
      if (state.category) parts.push('类别「' + state.category + '」');
    } else {
      parts.push('默认 TOP' + CONFIG.topN);
    }

    el.summary.textContent = parts.join(' · ');
    el.summary.hidden = false;
  }

  /**
   * 画表格。
   * 全部文本用 textContent 赋值 —— 视频标题里的 < > 等字符不会被当成 HTML。
   */
  function renderList(rows) {
    var frag = document.createDocumentFragment();

    rows.forEach(function (v, i) {
      var rank = i + 1;
      var tr = document.createElement('tr');

      // 排名
      var tdRank = document.createElement('td');
      var badge = document.createElement('span');
      badge.className = 'rank-badge' + (rank <= 3 ? ' rank-badge--' + rank : '');
      badge.textContent = String(rank);
      tdRank.appendChild(badge);
      tr.appendChild(tdRank);

      // 标题 + video_id
      var tdTitle = document.createElement('td');
      var titleText = document.createElement('span');
      titleText.className = 'cell-title__text';
      titleText.textContent = v.title || '(无标题)';
      titleText.title = v.title || '';
      var idText = document.createElement('span');
      idText.className = 'cell-title__id';
      idText.textContent = v.video_id;
      tdTitle.className = 'cell-title';
      tdTitle.appendChild(titleText);
      tdTitle.appendChild(idText);
      tr.appendChild(tdTitle);

      // 频道
      var tdChannel = document.createElement('td');
      tdChannel.className = 'cell-channel';
      tdChannel.textContent = v.channel_title || '—';
      tr.appendChild(tdChannel);

      // 类别
      var tdCat = document.createElement('td');
      var catTag = document.createElement('span');
      catTag.className = 'cat-tag';
      catTag.textContent = v.category_name || '未分类';
      tdCat.appendChild(catTag);
      tr.appendChild(tdCat);

      // 四个数字列
      [
        ['num--views', fmtNumber(v.views)],
        ['num--likes', fmtNumber(v.likes)],
        ['num--comments', fmtNumber(v.comment_count)],
        ['num--rate', fmtPercent(v.like_rate)],
      ].forEach(function (pair) {
        var td = document.createElement('td');
        var span = document.createElement('span');
        span.className = 'num ' + pair[0];
        span.textContent = pair[1];
        td.appendChild(span);
        tr.appendChild(td);
      });

      // 上榜日期
      var tdDate = document.createElement('td');
      tdDate.className = 'cell-date';
      tdDate.textContent = v.trending_date || '—';
      tr.appendChild(tdDate);

      frag.appendChild(tr);
    });

    el.rankBody.textContent = '';
    el.rankBody.appendChild(frag);
    el.listSection.hidden = false;
  }

  function renderEmpty() {
    el.summary.hidden = false;
    el.rankBody.textContent = '';

    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = 9;
    td.className = 'cell-empty';
    td.textContent = '没有符合当前条件的视频，请调整关键词或类别筛选。';
    tr.appendChild(td);
    el.rankBody.appendChild(tr);
    el.listSection.hidden = false;
  }

  /**
   * 主渲染：筛选 → 排序 → 取前 N 条 → 画表格
   */
  function render() {
    if (state.loadError) return;   // 加载失败时保持错误提示

    var keyword = state.keyword.trim().toLowerCase();
    var filtered = state.allVideos.filter(function (v) {
      if (state.category && v.category_name !== state.category) return false;
      if (keyword === '') return true;
      // 关键词同时匹配标题、频道名、类别名；韩文中文没有大小写，toLowerCase 无副作用
      return v.title.toLowerCase().indexOf(keyword) !== -1
        || v.channel_title.toLowerCase().indexOf(keyword) !== -1
        || v.category_name.toLowerCase().indexOf(keyword) !== -1;
    });

    var key = SORT_LABELS[state.sortKey] ? state.sortKey : 'views';
    var sorted = filtered.slice().sort(function (a, b) {
      if (b[key] !== a[key]) return b[key] - a[key];
      return b.views - a.views;      // 并列时用播放量兜底
    });

    var isFiltered = keyword !== '' || state.category !== '';
    var limit = isFiltered ? CONFIG.filteredLimit : CONFIG.topN;
    var rows = sorted.slice(0, limit);

    if (rows.length === 0) {
      renderEmpty();
      return;
    }
    renderList(rows);
    renderSummary(filtered.length, rows.length, isFiltered);
  }

  /* ======================================================================
   * 7. 事件绑定
   * ==================================================================== */

  function updateSortButtons() {
    el.sortButtons.forEach(function (btn) {
      var active = btn.getAttribute('data-sort') === state.sortKey;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function updateSearchClear() {
    el.searchClear.hidden = state.keyword.trim() === '';
  }

  function bindEvents() {
    // 搜索：输入即时过滤。加 150ms 防抖，避免每敲一个字就重排整张表
    var timer = null;
    el.searchInput.addEventListener('input', function (e) {
      state.keyword = e.target.value;
      updateSearchClear();
      clearTimeout(timer);
      timer = setTimeout(render, 150);
    });

    el.searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') e.preventDefault();   // 本页没有 form，回车不做任何事
    });

    // 清空搜索
    el.searchClear.addEventListener('click', function () {
      state.keyword = '';
      el.searchInput.value = '';
      updateSearchClear();
      render();
      el.searchInput.focus();
    });

    // 类别筛选
    el.categorySelect.addEventListener('change', function (e) {
      state.category = e.target.value;
      render();
    });

    // 排序
    el.sortButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.sortKey = btn.getAttribute('data-sort');
        updateSortButtons();
        render();
      });
    });

    // 重置：回到默认的「播放量 TOP10」
    el.resetBtn.addEventListener('click', function () {
      state.keyword = '';
      state.category = '';
      state.sortKey = 'views';
      el.searchInput.value = '';
      el.categorySelect.value = '';
      updateSearchClear();
      updateSortButtons();
      render();
      el.searchInput.focus();
    });

    // 出错后点「重新加载」
    el.statusRetry.addEventListener('click', boot);
  }

  /* ======================================================================
   * 8. 启动
   * ==================================================================== */

  /** 类别下拉项：按出现次数从多到少排 */
  function fillCategorySelect(videos) {
    var counts = {};
    videos.forEach(function (v) {
      counts[v.category_name] = (counts[v.category_name] || 0) + 1;
    });

    var names = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b, 'zh-Hans-CN');
    });

    // 保留第一个「全部类别」，其余重建
    while (el.categorySelect.options.length > 1) el.categorySelect.remove(1);

    names.forEach(function (name) {
      var o = document.createElement('option');
      o.value = name;
      o.textContent = name + '（' + counts[name] + '）';
      el.categorySelect.appendChild(o);
    });
  }

  function boot() {
    state.loadError = null;
    renderLoading();

    loadData()
      .then(function (data) {
        state.allVideos = data.videos;
        el.status.hidden = true;
        el.status.classList.remove('status--error');

        renderMeta(data.generatedAt, data.videos.length);
        fillCategorySelect(data.videos);
        el.categorySelect.value = state.category;   // 重试时恢复原来的选择
        render();
      })
      .catch(function (err) {
        state.loadError = err;
        console.error('[week3] 数据加载失败：', err);
        renderError(err);
      });
  }

  function init() {
    bindEvents();
    updateSortButtons();
    updateSearchClear();
    boot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
