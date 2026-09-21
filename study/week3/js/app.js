/* ==========================================================================
 * 韩国热门视频播放量 TOP10 —— 前端交互逻辑
 * ---------------------------------------------------------------------------
 * 第三周核心：DOM 操作 + 事件绑定 + fetch 读取本地 CSV/JSON + 交互渲染
 *
 * 数据来源：不使用任何预生成的 JSON。页面打开时用 fetch 读取
 *          data/ 下的原始 CSV 与 JSON，在浏览器里现场解析、清洗、去重、排序。
 *
 * 模块划分（对应方案 2.3 D）：
 *   CsvParser        引用感知的 CSV 解析器
 *   DataLoader       用 fetch 读取 CSV/JSON 并完成解析清洗去重
 *   Formatter        数字、百分比、日期格式化
 *   CategoryService  生成类别下拉项
 *   FilterService    关键词与类别过滤
 *   SortService      按字段排序
 *   RankingService   截取 TOP N
 *   ViewRenderer     渲染榜单与状态
 *   EventBinder      绑定搜索 / 筛选 / 排序 / 重置
 *
 * 安全约定：所有来自数据的文本（标题、频道名、类别名）一律通过
 *          textContent 写入 DOM，绝不拼接 HTML 字符串，避免 XSS。
 * ========================================================================== */

(function () {
  'use strict';

  /* ======================================================================
   * 配置
   *
   * 本页面不使用任何预生成的 JSON —— 打开时直接用 fetch 读取本地 CSV/JSON，
   * 在浏览器里现场解析、清洗、去重，再渲染。
   * ==================================================================== */
  var CONFIG = {
    csvUrl: 'data/KRvideos.csv',                              // 原始 CSV（34.8 MB）
    categoryJsonUrl: 'data/KR_category_id.json',              // 类别英文名
    categoryMapUrl: 'data/YouTube视频分类映射表.csv',          // 类别中文名
    topN: 10,             // 默认榜单长度（无筛选时只显示 TOP10）
    filteredLimit: 100,   // 带筛选条件时最多展示条数（第三周不做复杂分页）
    fetchTimeoutMs: 120000 // CSV 较大，超时给足 2 分钟
  };

  var DATA_FILES = CONFIG.csvUrl + '、' + CONFIG.categoryJsonUrl +
                   ' 和 ' + CONFIG.categoryMapUrl;

  var COUNTRY = 'KR';

  /* ======================================================================
   * Formatter —— 格式化
   * ==================================================================== */
  var Formatter = {
    /** 千分位整数：113876217 -> "113,876,217" */
    number: function (n) {
      if (typeof n !== 'number' || !isFinite(n)) return '—';
      return Math.round(n).toLocaleString('en-US');
    },

    /** 点赞率：0.024687 -> "2.47%" */
    percent: function (r, digits) {
      if (typeof r !== 'number' || !isFinite(r)) return '—';
      var d = typeof digits === 'number' ? digits : 2;
      return (r * 100).toFixed(d) + '%';
    },

    /** 上榜日期：原始格式 "17.11.12"（YY.DD.MM）原样展示 */
    trendingDate: function (s) {
      var v = String(s == null ? '' : s).trim();
      return v === '' ? '—' : v;
    },

    /** 生成时间 ISO -> 本地可读：2026/9/19 23:28 */
    timestamp: function (iso) {
      if (!iso) return '—';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      var p = function (x) { return x < 10 ? '0' + x : String(x); };
      return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() +
             ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
  };

  /* ======================================================================
   * DOM 引用
   * ==================================================================== */
  var el = {
    updatedAt: document.getElementById('data-updated-at'),
    totalBadge: document.getElementById('data-total'),
    searchInput: document.getElementById('search-input'),
    searchClear: document.getElementById('search-clear'),
    categorySelect: document.getElementById('category-select'),
    sortButtons: Array.prototype.slice.call(document.querySelectorAll('.sort-btn')),
    resetBtn: document.getElementById('reset-btn'),
    summary: document.getElementById('result-summary'),
    statusRegion: document.getElementById('status-region'),
    statusSpinner: document.getElementById('status-spinner'),
    statusTitle: document.getElementById('status-title'),
    statusDetail: document.getElementById('status-detail'),
    statusRetry: document.getElementById('status-retry'),
    listSection: document.getElementById('list-section'),
    rankBody: document.getElementById('rank-body')
  };

  /* ======================================================================
   * 应用状态
   * ==================================================================== */
  var state = {
    allVideos: [],
    meta: null,
    keyword: '',
    category: '',
    sortKey: 'views',
    loadError: null
  };

  /* ======================================================================
   * DataLoader —— 用 fetch 读取本地 CSV/JSON 并现场处理
   *
   * 流程：fetch CSV → 容错解码 → 引用感知解析 → 类别映射
   *       → 清洗 → 按 video_id 去重 → 排序 → 交给渲染层
   * ==================================================================== */

  /** 带超时的 fetch，避免网络异常时页面一直转圈 */
  function fetchWithTimeout(url, asText) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, CONFIG.fetchTimeoutMs);

    var opts = { cache: 'no-store' };
    if (controller) opts.signal = controller.signal;

    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error('请求 ' + url + ' 失败，HTTP 状态码 ' + res.status);
      }
      if (!asText) return res.json();
      // 用非 fatal 的 TextDecoder：原始 CSV 存在少量损坏字节，
      // fatal 模式会直接抛错导致整个文件读不了；这里替换成 U+FFFD 继续处理。
      return res.arrayBuffer().then(function (buf) {
        return new TextDecoder('utf-8', { fatal: false }).decode(buf);
      });
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  /**
   * 引用感知的 CSV 解析器。
   * 必须处理引号内的逗号与换行 —— 原始 CSV 的 tags / description 字段里
   * 就含带引号的换行符，按行切分会造成字段错位并静默丢数据。
   */
  var CsvParser = {
    parse: function (text) {
      var src = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; // 去 BOM
      var rows = [];
      var row = [];
      var field = '';
      var inQuotes = false;
      var n = src.length;

      for (var i = 0; i < n; i++) {
        var ch = src.charAt(i);
        if (inQuotes) {
          if (ch === '"') {
            if (src.charAt(i + 1) === '"') { field += '"'; i++; } // 转义的引号
            else inQuotes = false;
          } else {
            field += ch;
          }
          continue;
        }
        if (ch === '"') { inQuotes = true; continue; }
        if (ch === ',') { row.push(field); field = ''; continue; }
        if (ch === '\r') continue;
        if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
        field += ch;
      }
      if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
      return rows;
    },
  };

  /** 转数字，无法解析返回 null（便于与真实的 0 区分） */
  function toNumber(raw) {
    if (raw === undefined || raw === null) return null;
    var s = String(raw).trim().replace(/,/g, '');
    if (s === '') return null;
    var v = Number(s);
    return isFinite(v) ? v : null;
  }

  var DataLoader = {
    /** 读取并处理三个输入文件，返回 { videos, meta } */
    loadAll: function () {
      var startedAt = Date.now();
      return Promise.all([
        fetchWithTimeout(CONFIG.categoryJsonUrl, false),
        fetchWithTimeout(CONFIG.categoryMapUrl, true),
        fetchWithTimeout(CONFIG.csvUrl, true),
      ]).then(function (r) {
        var catJson = r[0];
        var mapText = r[1];
        var csvText = r[2];

        // ---- 类别映射：中文（映射表）+ 英文（数据集 JSON）----
        var idToZh = Object.create(null);
        var mapRows = CsvParser.parse(mapText);
        var mh = mapRows[0];
        var mi = mh.indexOf('category_id');
        var mzh = mh.indexOf('chinese_name');
        if (mi < 0 || mzh < 0) throw new Error('映射表缺少 category_id 或 chinese_name 列');
        for (var k = 1; k < mapRows.length; k++) {
          var mr = mapRows[k];
          if (!mr || mr.length <= mzh) continue;
          var mid = String(mr[mi]).trim();
          if (mid) idToZh[mid] = String(mr[mzh]).trim();
        }

        var idToEn = Object.create(null);
        var items = (catJson && catJson.items) || [];
        for (var j = 0; j < items.length; j++) {
          idToEn[String(items[j].id)] = (items[j].snippet && items[j].snippet.title) || '';
        }

        // ---- 解析 CSV ----
        var records = CsvParser.parse(csvText);
        if (!records.length) throw new Error('CSV 内容为空，无法解析。');
        var header = records[0];
        var col = Object.create(null);
        for (var h = 0; h < header.length; h++) col[header[h]] = h;

        var required = ['video_id', 'title', 'channel_title', 'category_id', 'views',
          'likes', 'dislikes', 'comment_count', 'trending_date', 'publish_time', 'tags'];
        for (var q = 0; q < required.length; q++) {
          if (col[required[q]] === undefined) {
            throw new Error('原始 CSV 缺少必需字段：' + required[q]);
          }
        }

        // ---- 清洗 + 按 video_id 去重（保留播放量最高的一条）----
        var best = Object.create(null);
        var droppedMissing = 0;
        var brokenKey = 0;
        var unmapped = 0;

        for (var x = 1; x < records.length; x++) {
          var rec = records[x];
          if (rec.length !== header.length) continue; // 字段数异常的行跳过

          var videoId = String(rec[col.video_id] || '').trim();
          var title = String(rec[col.title] || '').trim();
          var channel = String(rec[col.channel_title] || '').trim();
          var views = toNumber(rec[col.views]);

          if (!videoId || !title || !channel || views === null) { droppedMissing++; continue; }
          // 容错解码留下的替换字符若落在关键字段，该行不可靠
          if (videoId.indexOf('\uFFFD') >= 0 || title.indexOf('\uFFFD') >= 0
              || channel.indexOf('\uFFFD') >= 0) { brokenKey++; continue; }

          var likes = toNumber(rec[col.likes]) || 0;
          var prev = best[videoId];
          if (prev !== undefined) {
            if (prev.views > views) continue;
            // 播放量相同时（数据集存在这种重复快照）比点赞，取数值更完整的那条
            if (prev.views === views && prev.likes >= likes) continue;
          }

          var categoryId = String(rec[col.category_id] || '').trim();
          var categoryName = idToZh[categoryId];
          if (categoryName === undefined) {
            unmapped++;
            categoryName = idToEn[categoryId] || '未分类';
          }

          best[videoId] = {
            video_id: videoId,
            title: title,
            channel_title: channel,
            category_id: categoryId,
            category_name: categoryName,
            views: views,
            likes: likes,
            dislikes: toNumber(rec[col.dislikes]) || 0,
            comment_count: toNumber(rec[col.comment_count]) || 0,
            like_rate: views > 0 ? Number((likes / views).toFixed(6)) : 0,
            trending_date: String(rec[col.trending_date] || '').trim(),
            publish_time: String(rec[col.publish_time] || '').trim(),
            tags: String(rec[col.tags] || '').trim(),
            country: COUNTRY,
          };
        }

        // ---- 排序：播放量降序 → 点赞降序 → video_id 升序 ----
        // 第三个键让「播放量与点赞都相同」时结果确定、可复现
        var videos = [];
        for (var id in best) videos.push(best[id]);
        videos.sort(function (a, b) {
          return (b.views - a.views)
            || (b.likes - a.likes)
            || (a.video_id < b.video_id ? -1 : a.video_id > b.video_id ? 1 : 0);
        });

        var elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        var meta = {
          country: COUNTRY,
          country_name: '韩国',
          source_file: 'KRvideos.csv',
          category_file: 'KR_category_id.json',
          category_map_file: 'YouTube视频分类映射表.csv',
          generated_by: '浏览器端 JavaScript fetch（无预生成 JSON、无 pandas）',
          generated_at: new Date().toISOString(),
          total_records: videos.length,
          load_seconds: Number(elapsed),
          dedupe: 'by video_id, keep max views',
          category_language: 'zh',
        };

        if (window.console && console.info) {
          var parsedRows = records.length - 1;
          console.info('[Trending Video Insight] 浏览器端处理完成：'
            + parsedRows + ' 行 → 去重后 ' + videos.length + ' 条，耗时 ' + elapsed + ' 秒'
            + '（关键字段缺失丢弃 ' + droppedMissing
            + '，损坏字符丢弃 ' + brokenKey
            + '，类别未映射 ' + unmapped + '）');
        }

        return { videos: videos, meta: meta };
      });
    }
  };

  /* ======================================================================
   * CategoryService —— 类别下拉
   * ==================================================================== */
  var CategoryService = {
    /** 统计类别出现次数，按次数降序、同次数按名称排序 */
    buildOptions: function (videos) {
      var counts = Object.create(null);
      videos.forEach(function (v) {
        var name = v.category_name;
        if (!name) return;
        counts[name] = (counts[name] || 0) + 1;
      });
      return Object.keys(counts)
        .map(function (name) { return { name: name, count: counts[name] }; })
        .sort(function (a, b) {
          return b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN');
        });
    },

    render: function (options) {
      // 保留第一个「全部类别」选项，其余重建
      while (el.categorySelect.options.length > 1) {
        el.categorySelect.remove(1);
      }
      options.forEach(function (opt) {
        var node = document.createElement('option');
        node.value = opt.name;
        node.textContent = opt.name + '（' + opt.count + '）';
        el.categorySelect.appendChild(node);
      });
    }
  };

  /* ======================================================================
   * FilterService —— 搜索与类别筛选
   * ==================================================================== */
  var FilterService = {
    /**
     * 关键词同时匹配「视频标题 / 频道名 / 类别名」，大小写不敏感。
     * 韩文与中文没有大小写概念，toLowerCase 对其无副作用。
     */
    apply: function (videos, keyword, category) {
      var kw = String(keyword || '').trim().toLowerCase();
      return videos.filter(function (v) {
        if (category && v.category_name !== category) return false;
        if (kw === '') return true;
        var title = String(v.title || '').toLowerCase();
        var channel = String(v.channel_title || '').toLowerCase();
        var cat = String(v.category_name || '').toLowerCase();
        return title.indexOf(kw) !== -1 ||
               channel.indexOf(kw) !== -1 ||
               cat.indexOf(kw) !== -1;
      });
    },

    isActive: function () {
      return String(state.keyword).trim() !== '' || state.category !== '';
    }
  };

  /* ======================================================================
   * SortService —— 排序
   * ==================================================================== */
  var SORT_LABELS = { views: '播放量', likes: '点赞数', like_rate: '点赞率' };

  var SortService = {
    /** 三个指标均为「越大越好」，统一降序；并列时用播放量做稳定兜底 */
    apply: function (videos, sortKey) {
      var key = SORT_LABELS[sortKey] ? sortKey : 'views';
      return videos.slice().sort(function (a, b) {
        var x = Number(a[key]) || 0;
        var y = Number(b[key]) || 0;
        if (y !== x) return y - x;
        return (Number(b.views) || 0) - (Number(a.views) || 0);
      });
    }
  };

  /* ======================================================================
   * RankingService —— 取 TOP N
   * ==================================================================== */
  var RankingService = {
    top: function (videos, n) {
      return videos.slice(0, Math.max(0, n));
    }
  };

  /* ======================================================================
   * ViewRenderer —— 渲染
   * ==================================================================== */

  function showStatus(opts) {
    el.statusRegion.hidden = false;
    el.statusRegion.classList.toggle('status--error', !!opts.error);
    el.statusSpinner.hidden = !opts.spinner;
    el.statusTitle.textContent = opts.title || '';
    el.statusTitle.hidden = !opts.title;

    // detail 允许传入纯文本（含 \n，由 CSS white-space: pre-line 换行）
    el.statusDetail.textContent = opts.detail || '';
    el.statusDetail.hidden = !opts.detail;
    el.statusRetry.hidden = !opts.retry;

    if (!opts.spinner) el.listSection.hidden = true;
  }

  function hideStatus() {
    el.statusRegion.hidden = true;
    el.statusRegion.classList.remove('status--error');
  }

  var ViewRenderer = {
    /** 加载中 */
    renderLoading: function () {
      el.summary.hidden = true;
      showStatus({
        spinner: true,
        title: '正在加载并解析数据…',
        detail: '读取 ' + DATA_FILES +
          '\nCSV 约 35 MB，浏览器需要现场解析去重，首次打开请稍候。'
      });
    },

    /** 加载失败：区分 file:// 直接打开与其它异常，给出可操作提示 */
    renderError: function (err) {
      var isFileProtocol = location.protocol === 'file:';
      var detail;

      if (isFileProtocol) {
        detail =
          '检测到当前是通过 file:// 直接打开页面，浏览器出于安全策略会阻止 fetch 读取本地文件。\n' +
          '请改用本地静态服务器访问：\n' +
          '  1) VS Code 安装 Live Server 扩展，右键 index.html → Open with Live Server\n' +
          '  2) 或用任意静态服务器，在 study/week3 目录下起服务\n' +
          '然后访问 http://localhost:5500/';
      } else {
        detail =
          '无法读取 ' + DATA_FILES + '。\n' +
          '本页面需要这些文件位于 study/week3/data/ 下：\n' +
          '  KRvideos.csv、KR_category_id.json、YouTube视频分类映射表.csv\n' +
          '（它们可直接从 data/archive.zip 解压得到）\n' +
          '错误信息：' + (err && err.message ? err.message : String(err));
      }

      el.summary.hidden = true;
      showStatus({
        error: true,
        retry: true,
        title: isFileProtocol ? '需要通过本地服务器打开页面' : '数据加载失败',
        detail: detail
      });
    },

    /** 顶部元数据 */
    renderMeta: function (meta) {
      el.updatedAt.textContent = Formatter.timestamp(meta && meta.generated_at);
      var total = meta && typeof meta.total_records === 'number' ? meta.total_records : state.allVideos.length;
      el.totalBadge.textContent = '数据集 ' + Formatter.number(total) + ' 条';
      el.updatedAt.title = meta && meta.generated_at ? String(meta.generated_at) : '';
    },

    /** 结果统计条 */
    renderSummary: function (total, shown, isFiltered) {
      el.summary.textContent = '';

      var frag = document.createDocumentFragment();
      var strong = document.createElement('strong');
      // 这里要显示的是「匹配到的总条数」，不是「本次渲染的条数」。
      // 两者在筛选时通常不同（例如匹配 4,076 条、受 filteredLimit 限制只渲染 100 条）。
      strong.textContent = Formatter.number(total);
      frag.appendChild(document.createTextNode('共匹配 '));
      frag.appendChild(strong);
      frag.appendChild(document.createTextNode(' 条'));

      var chipSort = document.createElement('span');
      chipSort.className = 'chip';
      chipSort.textContent = '按' + SORT_LABELS[state.sortKey] + '降序';
      frag.appendChild(chipSort);

      if (isFiltered) {
        var chipScope = document.createElement('span');
        chipScope.className = 'chip';
        chipScope.textContent = shown < total
          ? '显示前 ' + Formatter.number(shown) + ' 条'
          : '全部显示';
        frag.appendChild(chipScope);

        if (String(state.keyword).trim() !== '') {
          var chipKw = document.createElement('span');
          chipKw.className = 'chip';
          chipKw.textContent = '关键词「' + String(state.keyword).trim() + '」';
          frag.appendChild(chipKw);
        }
        if (state.category !== '') {
          var chipCat = document.createElement('span');
          chipCat.className = 'chip';
          chipCat.textContent = '类别「' + state.category + '」';
          frag.appendChild(chipCat);
        }
      } else {
        var chipTop = document.createElement('span');
        chipTop.className = 'chip';
        chipTop.textContent = '默认 TOP' + CONFIG.topN;
        frag.appendChild(chipTop);
      }

      el.summary.appendChild(frag);
      el.summary.hidden = false;
    },

    /** 无结果 */
    renderEmpty: function () {
      el.summary.hidden = false;
      el.rankBody.textContent = '';
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 9;
      td.className = 'cell-empty';
      td.textContent = state.allVideos.length === 0
        ? '数据文件为空，没有可展示的视频记录。'
        : '没有符合当前条件的视频，请调整关键词或类别筛选。';
      tr.appendChild(td);
      el.rankBody.appendChild(tr);
      el.listSection.hidden = false;
    },

    /**
     * 渲染榜单表格。
     * 全部文本使用 textContent 赋值，title 等敏感字符不会被当作 HTML 解析。
     */
    renderList: function (rows) {
      var frag = document.createDocumentFragment();

      rows.forEach(function (v, i) {
        var rank = i + 1;
        var tr = document.createElement('tr');
        if (rank <= 3) tr.className = 'rank-top-' + rank;

        // 排名
        var tdRank = document.createElement('td');
        var badge = document.createElement('span');
        badge.className = 'rank-badge' + (rank <= 3 ? ' rank-badge--' + rank : '');
        badge.textContent = String(rank);
        tdRank.appendChild(badge);
        tr.appendChild(tdRank);

        // 标题 + video_id
        var tdTitle = document.createElement('td');
        var wrap = document.createElement('div');
        wrap.className = 'cell-title';
        var titleText = document.createElement('span');
        titleText.className = 'cell-title__text';
        titleText.textContent = v.title || '(无标题)';
        titleText.title = v.title || '';
        var idText = document.createElement('span');
        idText.className = 'cell-title__id';
        idText.textContent = v.video_id || '';
        wrap.appendChild(titleText);
        wrap.appendChild(idText);
        tdTitle.appendChild(wrap);
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

        // 播放量 / 点赞 / 评论 / 点赞率
        var numericCells = [
          { value: Formatter.number(v.views), cls: 'num--views' },
          { value: Formatter.number(v.likes), cls: 'num--likes' },
          { value: Formatter.number(v.comment_count), cls: 'num--comments' },
          { value: Formatter.percent(v.like_rate), cls: 'num--rate' }
        ];
        numericCells.forEach(function (cell) {
          var td = document.createElement('td');
          var span = document.createElement('span');
          span.className = 'num ' + cell.cls;
          span.textContent = cell.value;
          td.appendChild(span);
          tr.appendChild(td);
        });

        // 上榜日期
        var tdDate = document.createElement('td');
        tdDate.className = 'cell-date';
        tdDate.textContent = Formatter.trendingDate(v.trending_date);
        tr.appendChild(tdDate);

        frag.appendChild(tr);
      });

      el.rankBody.textContent = '';
      el.rankBody.appendChild(frag);
      el.listSection.hidden = false;
    }
  };

  /* ======================================================================
   * 渲染编排：过滤 -> 排序 -> 截取 -> 渲染
   * ==================================================================== */
  function render() {
    if (state.loadError) return; // 加载失败时保持错误提示

    var filtered = FilterService.apply(state.allVideos, state.keyword, state.category);
    var sorted = SortService.apply(filtered, state.sortKey);
    var isFiltered = FilterService.isActive();
    var limit = isFiltered ? CONFIG.filteredLimit : CONFIG.topN;
    var rows = RankingService.top(sorted, limit);

    if (rows.length === 0) {
      ViewRenderer.renderEmpty();
      return;
    }
    ViewRenderer.renderList(rows);
    ViewRenderer.renderSummary(filtered.length, rows.length, isFiltered);
  }

  /* ======================================================================
   * EventBinder —— 交互绑定
   * ==================================================================== */
  function updateSortButtons() {
    el.sortButtons.forEach(function (btn) {
      var active = btn.getAttribute('data-sort') === state.sortKey;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function updateSearchClear() {
    el.searchClear.hidden = String(state.keyword).trim() === '';
  }

  function bindEvents() {
    // 搜索：输入即时过滤（150ms 防抖，兼顾响应与性能）
    var debounceTimer = null;
    el.searchInput.addEventListener('input', function (e) {
      state.keyword = e.target.value;
      updateSearchClear();
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(render, 150);
    });

    // 搜索框清空按钮
    el.searchClear.addEventListener('click', function () {
      state.keyword = '';
      el.searchInput.value = '';
      updateSearchClear();
      render();
      el.searchInput.focus();
    });

    // 回车不提交表单（本页无 form），避免意外刷新
    el.searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') e.preventDefault();
    });

    // 类别筛选
    el.categorySelect.addEventListener('change', function (e) {
      state.category = e.target.value;
      render();
    });

    // 排序按钮
    el.sortButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sort');
        if (!SORT_LABELS[key] || key === state.sortKey) return;
        state.sortKey = key;
        updateSortButtons();
        render();
      });
    });

    // 重置：恢复默认「播放量 TOP10」
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

    // 加载失败后的重试
    el.statusRetry.addEventListener('click', function () {
      boot();
    });
  }

  /* ======================================================================
   * 启动流程
   * ==================================================================== */
  function boot() {
    state.loadError = null;
    ViewRenderer.renderLoading();

    DataLoader.loadAll()
      .then(function (data) {
        state.allVideos = data.videos;
        state.meta = data.meta;

        hideStatus();
        ViewRenderer.renderMeta(data.meta);
        CategoryService.render(CategoryService.buildOptions(state.allVideos));
        // 重建下拉后恢复当前选中项（重试场景）
        el.categorySelect.value = state.category;
        render();
      })
      .catch(function (err) {
        state.loadError = err;
        console.error('[Trending Video Insight] 数据加载失败：', err);
        ViewRenderer.renderError(err);
      });
  }

  function init() {
    bindEvents();
    updateSortButtons();
    updateSearchClear();
    boot();
  }

  /* ======================================================================
   * 测试钩子
   * ----------------------------------------------------------------------
   * 暴露内部模块与状态，供 tests/ 下的校验脚本在不启动浏览器的情况下
   * 复用真实逻辑（尤其是 CsvParser 与各 Service）。
   * 使用 __TVIS__ 命名空间，避免污染全局，不影响页面正常运行。
   * ==================================================================== */
  if (typeof window !== 'undefined') {
    window.__TVIS__ = {
      Formatter: Formatter,
      CsvParser: CsvParser,
      FilterService: FilterService,
      SortService: SortService,
      CategoryService: CategoryService,
      RankingService: RankingService,
      ViewRenderer: ViewRenderer,
      DataLoader: DataLoader,
      CONFIG: CONFIG,
      state: state,
      render: render
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
