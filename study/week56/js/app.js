/* ==========================================================================
 * 热门视频数据大屏 —— week5-6
 * ---------------------------------------------------------------------------
 * 分析方向：不同国家的视频观看偏好
 *
 * 数据：data/aggregates.json（0.26 MB，跨国家聚合；图表直接读它，打开就出图）
 *      data/meta.json（国家清单、类别清单、生成时间）
 *      data/<cc>.csv（各国明细，本轮不做下钻，先放着）
 *
 * 九个图表（含 2 个热力图 + 1 个词云 + 1 个世界地图）：
 *   ① 世界地图     各国平均播放量
 *   ② 热力图       国家 × 类别（可切换 数量 / 均播放 / 占比）
 *   ③ 词云         高频词（可切换 标题 / tags）
 *   ④ 折线图       上榜时间趋势
 *   ⑤ 横向条形图   头部频道
 *   ⑥ 柱状图       点赞率分布
 *   ⑦ 堆积条形图   类别构成占比
 *   ⑧ 横向条形图   跨国同榜热度
 *   ⑨ 热力图       国家 × 星期 观看热度
 *
 * 依赖：ECharts 5.5.1 + echarts-wordcloud，放在 week56 之外的 study/lib/，
 *      由 index.html 里的加载器探测路径并加载，加载完再调用本文件的 boot()。
 * ========================================================================== */

(function () {
  'use strict';

  /* ======================================================================
   * 1. 常量与配色
   * ==================================================================== */

  // 依赖目录：index.html 的加载器把命中的那条路径写进 window.__W56_LIB_BASE__
  var LIB = (typeof window !== 'undefined' && window.__W56_LIB_BASE__) || '../lib/';

  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // 世界地图 GeoJSON 里韩国的名字是 "Korea"，与数据里的 KR 对不上，需要单独映射
  var MAP_NAME = {
    US: 'United States', GB: 'United Kingdom', CA: 'Canada', DE: 'Germany',
    FR: 'France', RU: 'Russia', MX: 'Mexico', JP: 'Japan', KR: 'Korea', IN: 'India',
  };

  // 有些中文类别名太长，坐标轴上放不下，缩短成 4 个字
  var CAT_SHORT = {
    '人物与博客': '人物博客', '教程与风格': '教程风格', '新闻与政治': '新闻政治',
    '汽车与交通工具': '汽车交通', '电影与动画': '电影动画', '电影（长片）': '电影长片',
    '科学与技术': '科学技术', '非营利组织与公益': '非营利公益',
    '宠物与动物': '宠物动物', '旅行与活动': '旅行活动',
  };

  /*
   * 配色规则只有两条：
   *   1. 文字只用 text / dim / faint 三个黑灰色，彩色一律不当文字色；
   *   2. 奶黄与浅紫只在图表内部当数据系列色，页面上的色块按钮边框都不用它。
   */
  var C = {
    wine: '#BC4059',      // 主色：酒红
    wineDeep: '#94293C',  // 深一号，做渐变起点
    rose: '#CE5F76',      // 浅一号
    gold: '#F2D06B',      // 奶黄（只在图表里）
    purple: '#9B7FD4',    // 浅紫（只在图表里）
    text: '#1A1A1A',
    dim: '#4A4A4A',
    faint: '#8A8A8A',
    line: 'rgba(188,64,89,0.16)',      // 坐标轴/分隔线
    tipBg: 'rgba(255,255,255,0.97)',   // 提示框底色
    tipBorder: 'rgba(188,64,89,0.36)',
  };

  /*
   * 堆积图用的系列色。
   * 按「明度阶梯」排列（深 → 浅 → 深 → 浅），相邻类别不会突然跳色，整体更协调。
   */
  var PALETTE = [
    C.wine, '#F2D06B', '#9B7FD4', '#CE5F76', '#94293C',
    '#D9AF4A', '#A8425A', '#7B5FB8', '#E8C15C', '#D9C7EE',
  ];

  /* ======================================================================
   * 2. 页面状态
   * ==================================================================== */
  var state = {
    agg: null,            // aggregates.json 的内容
    meta: null,           // meta.json 的内容
    focus: '',            // 聚焦的国家代码，'' 表示全部国家对比
    words: 'title',       // 词云数据源：title | tag
    heatMetric: 'count',  // ② 号热力图的指标：count | avgViews | share
    hasMap: false,        // 世界地图 GeoJSON 是否拿到
    charts: {},           // 已创建的 ECharts 实例，按 key 存
  };

  /* ======================================================================
   * 3. 小工具函数
   * ==================================================================== */

  function $(id) { return document.getElementById(id); }

  /** 千分位：113876217 -> "113,876,217" */
  function fmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return Math.round(n).toLocaleString('en-US');
  }

  /** 大数字压缩显示：12472425372 -> "124.7 亿" */
  function fmtBig(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    if (n >= 1e8) return (n / 1e8).toFixed(1) + ' 亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万';
    return fmt(n);
  }

  /** 国家代码 -> 中文名（每国数据里自带 zh 字段） */
  function zh(cc) {
    var c = state.agg && state.agg.countries[cc];
    return (c && c.zh) || cc;
  }

  /** 提示框里用「韩国 (KR)」，方便对照原始数据 */
  function zhFull(cc) { return zh(cc) + ' (' + cc + ')'; }

  /** 类别名缩短 */
  function cat(c) { return CAT_SHORT[c] || c; }

  /** 把 #rrggbb 整体调亮(t>0)或调暗(t<0)，t 范围 -1 ~ 1 */
  function shade(hex, t) {
    var n = parseInt(hex.slice(1), 16);
    var out = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      var x = t >= 0 ? v + (255 - v) * t : v * (1 + t);
      return Math.max(0, Math.min(255, Math.round(x)));
    });
    return 'rgb(' + out.join(',') + ')';
  }

  /*
   * 下面四个是「公共配置片段」。
   * ECharts 的每个图表都要写一遍提示框样式和坐标轴样式，九个图写九遍既啰嗦
   * 又容易改漏，所以抽成函数，各个图表拼装时直接引用。
   */

  /** 提示框基础样式（各图表再补 trigger / formatter） */
  function tip(extra) {
    var base = {
      backgroundColor: C.tipBg,
      borderColor: C.tipBorder,
      textStyle: { color: C.text, fontSize: 12 },
    };
    for (var k in extra) base[k] = extra[k];
    return base;
  }

  /** 类目轴：x 轴或 y 轴 */
  function catAxis(data, extra) {
    var base = {
      type: 'category',
      data: data,
      axisLabel: { color: C.dim, fontSize: 11 },
      axisLine: { lineStyle: { color: C.line } },
      axisTick: { show: false },
    };
    for (var k in extra) base[k] = extra[k];
    return base;
  }

  /** 数值轴 */
  function valueAxis(extra) {
    var base = {
      type: 'value',
      axisLabel: { color: C.dim, fontSize: 11 },
      splitLine: { lineStyle: { color: C.line } },
    };
    for (var k in extra) base[k] = extra[k];
    return base;
  }

  /** 坐标轴上国家名用中文加粗（比英文缩写好认） */
  var CC_AXIS = { color: C.text, fontSize: 12, fontWeight: 600 };

  /* ======================================================================
   * 4. 数据整理
   *
   * aggregates.json 里存的是按国家、按维度分好的聚合结果。
   * 下面这些函数负责把「按国家存的数据」翻成「各图表要的形状」。
   * 关键点：多数函数先调 activeCC()，它决定这次是画 1 个国家还是 10 个国家。
   * ==================================================================== */

  var Data = {
    /** 全部国家代码 */
    allCC: function () { return state.agg.overlap.cc; },

    /** 本次要画的国家：聚焦时只有 1 个，否则全部 */
    activeCC: function () {
      return state.focus ? [state.focus] : this.allCC();
    },

    /** 取某国的聚合数据 */
    of: function (cc) { return state.agg.countries[cc]; },

    /** 国家 × 类别矩阵（② 号热力图用） */
    categoryMatrix: function (metric) {
      var ccs = this.activeCC();

      // 先按总数量挑出前 12 个类别，太多会把坐标轴挤满
      var total = {};
      ccs.forEach(function (cc) {
        var bc = Data.of(cc).by_category;
        for (var k in bc) total[k] = (total[k] || 0) + bc[k].count;
      });
      var cats = Object.keys(total)
        .sort(function (a, b) { return total[b] - total[a]; })
        .slice(0, 12);

      var data = [];
      var max = 0;
      ccs.forEach(function (cc, y) {
        var bc = Data.of(cc).by_category;
        var sum = 0;
        for (var k in bc) sum += bc[k].count;

        cats.forEach(function (name, x) {
          var d = bc[name];
          var v = 0;
          if (d) {
            if (metric === 'avgViews') v = Math.round(d.views / d.count);
            else if (metric === 'share') v = +(d.count / sum * 100).toFixed(2);
            else v = d.count;
          }
          data.push([x, y, v]);
          if (v > max) max = v;
        });
      });
      return { cc: ccs, cats: cats, data: data, max: max };
    },

    /** 跨国同榜排行（⑧ 号用）：聚焦时只看该国与其它国，否则看所有两两组合 */
    overlapPairs: function () {
      var ccs = this.allCC();
      var m = state.agg.overlap.matrix;
      var out = [];

      if (state.focus) {
        var i = ccs.indexOf(state.focus);
        ccs.forEach(function (cc, j) {
          if (j !== i) out.push({ a: ccs[i], b: cc, value: m[i][j] });
        });
      } else {
        for (var a = 0; a < ccs.length; a += 1) {
          for (var b = a + 1; b < ccs.length; b += 1) {
            out.push({ a: ccs[a], b: ccs[b], value: m[a][b] });
          }
        }
      }
      return out.sort(function (x, y) { return y.value - x.value; });
    },

    /** 词云数据（③ 号用）：单国直接取，多国把词频累加 */
    words: function (kind) {
      var key = kind === 'tag' ? 'words_tag' : 'words_title';
      var ccs = this.activeCC();

      if (ccs.length === 1) return this.of(ccs[0])[key].slice();

      var acc = {};
      ccs.forEach(function (cc) {
        Data.of(cc)[key].forEach(function (item) {
          acc[item[0]] = (acc[item[0]] || 0) + item[1];
        });
      });
      return Object.keys(acc)
        .map(function (w) { return [w, acc[w]]; })
        .sort(function (a, b) { return b[1] - a[1]; })
        .slice(0, 260);   // 词太多会挤成一团，取前 260 个
    },

    /** 上榜时间趋势（④ 号用）：按月汇总 */
    monthSeries: function () {
      var acc = {};
      this.activeCC().forEach(function (cc) {
        var bm = Data.of(cc).by_month;
        for (var m in bm) {
          if (!acc[m]) acc[m] = { views: 0, count: 0 };
          acc[m].views += bm[m].views;
          acc[m].count += bm[m].count;
        }
      });
      // 只留 2017 年以后：更早的都是零星老视频，会把曲线起点压平
      var months = Object.keys(acc).filter(function (m) { return m >= '2017-01'; }).sort();
      return {
        months: months,
        counts: months.map(function (m) { return acc[m].count; }),
      };
    },

    /** 头部频道（⑤ 号用）：单国取前 12 个，多国各取第 1 名做对比 */
    channels: function () {
      var ccs = this.activeCC();
      if (ccs.length === 1) {
        return this.of(ccs[0]).top_channels.map(function (c) {
          return { name: c.name, cc: ccs[0], value: c.views };
        });
      }
      var out = [];
      ccs.forEach(function (cc) {
        var top = Data.of(cc).top_channels[0];
        if (top) out.push({ name: top.name, cc: cc, value: top.views });
      });
      return out.sort(function (a, b) { return b.value - a.value; });
    },

    /** 点赞率分布（⑥ 号用）：10 个桶的计数相加 */
    likeRate: function () {
      var buckets = new Array(10).fill(0);
      this.activeCC().forEach(function (cc) {
        var b = Data.of(cc).like_rate_buckets;
        for (var i = 0; i < 10; i += 1) buckets[i] += b[i] || 0;
      });
      return buckets;
    },

    /** 类别构成占比（⑦ 号用）：9 个主要类别 + 其它 */
    categoryShare: function () {
      var ccs = this.activeCC();
      var all = state.agg.meta.categories;
      var rows = ccs.map(function (cc) {
        var bc = Data.of(cc).by_category;
        var sum = 0;
        for (var k in bc) sum += bc[k].count;
        return { cc: cc, bc: bc, sum: sum };
      });

      // 按这 10 国的总量排前 9 个类别，剩下的合成「其它」
      var top9 = all.slice().sort(function (a, b) {
        var ta = 0, tb = 0;
        rows.forEach(function (r) {
          ta += r.bc[a] ? r.bc[a].count : 0;
          tb += r.bc[b] ? r.bc[b].count : 0;
        });
        return tb - ta;
      }).slice(0, 9);

      var series = {};
      top9.forEach(function (name) { series[name] = []; });
      series['其它'] = [];

      rows.forEach(function (r) {
        var used = 0;
        top9.forEach(function (name) {
          var v = r.bc[name] ? r.bc[name].count : 0;
          used += v;
          series[name].push(r.sum > 0 ? +(v / r.sum * 100).toFixed(2) : 0);
        });
        series['其它'].push(r.sum > 0 ? +((r.sum - used) / r.sum * 100).toFixed(2) : 0);
      });

      return {
        rows: ccs.map(zh),
        names: top9.concat(['其它']),
        series: series,
      };
    },

    /*
     * 国家 × 星期 观看热度（⑨ 号热力图用）
     *
     * 指标是「那天发布的视频，平均被看了多少次」（单位：万次）。
     * 为什么用平均值：各国上榜视频总量差 4 倍（加拿大 2.4 万条、美国 6 千条），
     * 用总条数或总播放量都不公平；「每条视频平均」天然把总量差异除掉了。
     *
     * 着色为什么不按行归一化：各国量级差 45 倍（英国 320~793 万，
     * 日本 17.5~26.8 万）。若用同一把绝对色标，英国会整行顶格、
     * 日本等 5 国会整行垫底，同样看不出东西。所以每行按
     * 「本国这周最冷的一天 → 最热的一天」拉伸成 5 档，绝对数值放提示框里。
     */
    weekdayMatrix: function () {
      var ccs = this.activeCC();
      var COLORS = ['#F7E3E8', '#E4A7B7', C.wine, '#8E2438', '#EFCB84'];
      var LABELS = ['相对最冷', '偏冷', '中等', '偏热', '相对最热'];

      var data = [];
      var rows = [];   // 每国自己的 7 天平均值，后面按行找最大最小

      ccs.forEach(function (cc, y) {
        var bw = Data.of(cc).by_weekday;
        var avg = [];
        var counts = [];
        for (var d = 0; d < 7; d += 1) {
          var n = bw[d] ? bw[d].count : 0;
          var v = bw[d] ? bw[d].views : 0;
          counts.push(n);
          avg.push(n > 0 ? v / n / 10000 : 0);
        }
        rows.push({ cc: cc, avg: avg, counts: counts });

        var lo = Math.min.apply(null, avg);
        var hi = Math.max.apply(null, avg);

        for (var k = 0; k < 7; k += 1) {
          // level：0 = 本国最冷的一天，1 = 最热的一天
          var level = hi > lo ? (avg[k] - lo) / (hi - lo) : 0.5;
          var band = Math.min(4, Math.floor(level * 5));
          data.push({
            value: [k, y, +avg[k].toFixed(1), counts[k]],
            level: level,
            itemStyle: { color: COLORS[band] },
          });
        }
      });

      return { rows: rows, ccs: ccs, data: data, COLORS: COLORS, LABELS: LABELS };
    },
  };

  /* ======================================================================
   * 5. 九个图表
   *
   * 每个函数的结构都一样：
   *   1) 从 Data 拿整理好的数据
   *   2) inst.setOption({ ... }) 交给 ECharts 画
   * 最后那个 true 表示「不与上次的配置合并」，切换国家时旧数据会被完全替换。
   * ==================================================================== */

  /* ---------- ① 世界地图：各国平均播放量 ---------- */
  function chartMap() {
    var inst = state.charts.map;

    // 地图数据没拿到时（比如 world.json 路径不对），只让这一块显示提示，其余 8 个照常画
    if (!state.hasMap) {
      inst.clear();
      inst.setOption({
        title: {
          text: '地图数据 world.json 未加载',
          subtext: '它应该在 study/lib/ 下。\n其余图表不受影响。',
          left: 'center', top: 'middle',
          textStyle: { color: C.faint, fontSize: 13, fontWeight: 400 },
          subtextStyle: { color: C.faint, fontSize: 11, lineHeight: 16, align: 'center' },
        },
      });
      return;
    }

    // 地图的 name 要跟 GeoJSON 一致，所以用英文名；同时记下英文名 -> 国家代码的对应
    var byName = {};
    var data = state.meta.countries.map(function (c) {
      var name = MAP_NAME[c.cc] || c.cc;
      byName[name] = c.cc;
      return { name: name, value: Data.of(c.cc).avg_views };
    });

    inst.setOption({
      backgroundColor: 'transparent',
      tooltip: tip({
        trigger: 'item',
        formatter: function (p) {
          var cc = byName[p.name];
          if (!cc) return p.name + '：无数据';
          var d = Data.of(cc);
          return '<b>' + zh(cc) + '</b> (' + cc + ')<br/>'
            + '平均播放量：' + fmt(d.avg_views) + '<br/>'
            + '唯一视频：' + fmt(d.uniq) + ' 个<br/>'
            + '累计播放：' + fmtBig(d.views_sum);
        },
      }),
      visualMap: {
        min: 0,
        max: Math.max.apply(null, data.map(function (d) { return d.value; })),
        left: 8, bottom: 8,
        itemWidth: 12, itemHeight: 86,
        text: ['高', '低'],
        textStyle: { color: C.dim, fontSize: 11 },
        inRange: { color: ['#FDF6E3', '#FAD8DF', '#DD8098', C.wine, C.purple] },
        calculable: true,
      },
      series: [{
        type: 'map',
        map: 'world',
        roam: true,
        zoom: 1.15,
        label: { show: false },
        itemStyle: {
          areaColor: '#F7EEF1',                    // 没有数据的国家：淡粉底
          borderColor: 'rgba(188,64,89,0.22)',
          borderWidth: 0.6,
        },
        emphasis: {
          label: { show: true, color: C.text, fontSize: 11 },
          itemStyle: { areaColor: C.gold },
        },
        select: { disabled: true },
        data: data,
      }],
    }, true);
  }

  /* ---------- ② 国家 × 类别 热力图 ---------- */
  function chartHeatCat() {
    var inst = state.charts.heatCat;
    var m = Data.categoryMatrix(state.heatMetric);

    var metricName = state.heatMetric === 'avgViews' ? '平均播放量'
      : state.heatMetric === 'share' ? '占比(%)' : '视频数量';

    inst.setOption({
      backgroundColor: 'transparent',
      grid: { left: 62, right: 18, top: 12, bottom: 76 },
      tooltip: tip({
        formatter: function (p) {
          return zhFull(m.cc[p.data[1]]) + ' · ' + cat(m.cats[p.data[0]]) + '<br/>'
            + metricName + '：' + fmt(p.data[2]);
        },
      }),
      xAxis: catAxis(m.cats.map(cat), {
        axisLabel: { color: C.dim, fontSize: 10.5, rotate: 34, interval: 0, margin: 6 },
        splitArea: { show: false },
      }),
      yAxis: catAxis(m.cc.map(zh), { axisLabel: CC_AXIS }),
      visualMap: {
        min: 0,
        max: m.max,
        show: m.max > 0,
        orient: 'horizontal',
        left: 'center', bottom: 4,
        itemWidth: 12, itemHeight: 90,
        textStyle: { color: C.dim, fontSize: 11 },
        inRange: { color: ['#FFFFFF', '#FDF2F5', '#F6C9D4', '#DD8098', C.wine] },
      },
      series: [{
        type: 'heatmap',
        data: m.data,
        itemStyle: { borderColor: 'rgba(7,11,20,0.9)', borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: C.text, borderWidth: 1.2 } },
      }],
    }, true);
  }

  /* ---------- ③ 高频词云 ---------- */
  function chartWordcloud() {
    var inst = state.charts.wordcloud;
    var words = Data.words(state.words);

    if (!words.length) {
      inst.clear();
      inst.setOption({
        title: {
          text: '暂无词数据', left: 'center', top: 'middle',
          textStyle: { color: C.faint, fontSize: 13, fontWeight: 400 },
        },
      });
      return;
    }

    /*
     * 配色用固定转盘，不用 Math.random()：
     * 随机取色每次刷新颜色都在变，截图复现不了，也控制不了黄紫的比例。
     * 转盘 8 格里 6 格是酒红家族，黄与紫各占 1 格，
     * 所以整张词云约有 3/4 是酒红，黄紫只当点缀。
     */
    var wheel = [
      C.wine, C.rose, C.gold, '#A8425A', '#C2708A',
      C.purple, '#94293C', '#CE5F76',
    ];

    inst.setOption({
      backgroundColor: 'transparent',
      tooltip: tip({
        formatter: function (p) { return p.name + '：出现 <b>' + fmt(p.value) + '</b> 次'; },
      }),
      series: [{
        type: 'wordCloud',
        shape: 'circle',
        left: 'center', top: 'center',
        width: '96%', height: '92%',
        sizeRange: [11, 46],
        rotationRange: [-45, 45],
        rotationStep: 15,
        gridSize: 7,
        drawOutOfBound: false,
        layoutAnimation: true,
        textStyle: {
          fontFamily: 'Pretendard, "Malgun Gothic", "Segoe UI", sans-serif',
          fontWeight: 700,
        },
        emphasis: {
          textStyle: { textShadowBlur: 10, textShadowColor: 'rgba(188,64,89,0.65)' },
        },
        // 颜色按词的位置定好，保证每次都一样
        data: words.map(function (w, i) {
          return {
            name: w[0],
            value: w[1],
            textStyle: { color: wheel[i % wheel.length] },
          };
        }),
      }],
    }, true);
  }

  /* ---------- ④ 上榜时间趋势（折线 + 面积） ---------- */
  function chartTime() {
    var inst = state.charts.time;
    var s = Data.monthSeries();

    inst.setOption({
      backgroundColor: 'transparent',
      grid: { left: 46, right: 14, top: 26, bottom: 34 },
      tooltip: tip({ trigger: 'axis' }),
      xAxis: catAxis(s.months, {
        axisLabel: { color: C.dim, fontSize: 10, formatter: function (v) { return v.slice(2); } },
      }),
      yAxis: valueAxis({
        name: '视频数',
        nameTextStyle: { color: C.faint, fontSize: 10 },
        axisLabel: { color: C.dim, fontSize: 10 },
      }),
      series: [{
        name: '上榜视频数',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: false,
        data: s.counts,
        lineStyle: { width: 2, color: C.wine },
        itemStyle: { color: C.wine },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(188,64,89,0.32)' },
            { offset: 1, color: 'rgba(188,64,89,0.02)' },
          ]),
        },
      }],
    }, true);
  }

  /* ---------- ⑤ 头部频道（横向条形，播放量越高颜色越深） ---------- */
  function chartChannels() {
    var inst = state.charts.channels;
    // 横向条形图的 y 轴是从下往上画的，所以先 reverse 一下，
    // 让播放量最高的那条显示在最上面
    var list = Data.channels().slice(0, 12).reverse();

    // 单色阶：用 shade() 把酒红按位置调浅，值越大越深
    var maxValue = Math.max.apply(null, list.map(function (c) { return c.value; }));

    inst.setOption({
      backgroundColor: 'transparent',
      grid: { left: 8, right: 70, top: 8, bottom: 8, containLabel: true },
      tooltip: tip({
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: function (p) {
          var item = list[p.dataIndex];
          return '<b>' + p.name + '</b>' + (item ? ' · ' + zhFull(item.cc) : '')
            + '<br/>累计播放：' + fmt(p.value);
        },
      }),
      xAxis: valueAxis({
        axisLabel: { color: C.dim, fontSize: 10, formatter: fmtBig },
      }),
      yAxis: catAxis(list.map(function (c) { return c.name; }), {
        axisLabel: { color: C.dim, fontSize: 10.5 },
      }),
      series: [{
        type: 'bar',
        barWidth: '62%',
        data: list.map(function (c) {
          return {
            value: c.value,
            itemStyle: {
              borderRadius: [0, 4, 4, 0],
              color: shade(C.wine, 0.42 * (1 - c.value / maxValue)),
            },
          };
        }),
        label: {
          show: true, position: 'right', color: C.dim, fontSize: 10,
          formatter: function (p) { return fmtBig(p.value); },
        },
      }],
    }, true);
  }

  /* ---------- ⑥ 点赞率分布（柱状） ---------- */
  function chartLikeRate() {
    var inst = state.charts.likerate;
    var buckets = Data.likeRate();
    var labels = ['0-1', '1-2', '2-3', '3-4', '4-5', '5-6', '6-7', '7-8', '8-9', '9+'];
    var maxValue = Math.max.apply(null, buckets);

    inst.setOption({
      backgroundColor: 'transparent',
      grid: { left: 48, right: 14, top: 18, bottom: 34 },
      tooltip: tip({
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: function (ps) {
          return '点赞率 ' + ps[0].name + '%<br/>视频数：<b>' + fmt(ps[0].value) + '</b>';
        },
      }),
      xAxis: catAxis(labels, {
        name: '点赞率 %',
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: C.faint, fontSize: 10 },
        axisLabel: { color: C.dim, fontSize: 10 },
      }),
      yAxis: valueAxis({
        axisLabel: { color: C.dim, fontSize: 10, formatter: fmtBig },
      }),
      series: [{
        type: 'bar',
        barWidth: '68%',
        data: buckets.map(function (v) {
          return {
            value: v,
            itemStyle: {
              borderRadius: [4, 4, 0, 0],
              color: shade(C.wine, 0.55 * (1 - v / maxValue)),   // 柱子越高颜色越深
            },
          };
        }),
      }],
    }, true);
  }

  /* ---------- ⑦ 类别构成占比（堆积百分比条形） ---------- */
  function chartCategoryShare() {
    var inst = state.charts.catShare;
    var d = Data.categoryShare();

    inst.setOption({
      backgroundColor: 'transparent',
      grid: { left: 52, right: 16, top: 46, bottom: 26 },
      tooltip: tip({
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: function (ps) {
          var out = '<b>' + ps[0].axisValue + '</b> 类别构成 (%)';
          ps.forEach(function (p) {
            if (p.value > 0) out += '<br/>' + p.marker + cat(p.seriesName) + '：' + p.value + '%';
          });
          return out;
        },
      }),
      legend: {
        type: 'scroll',
        top: 0,
        itemWidth: 9, itemHeight: 8,
        textStyle: { color: C.dim, fontSize: 10 },
      },
      xAxis: catAxis(d.rows, { axisLabel: CC_AXIS }),
      yAxis: valueAxis({
        max: 100,
        axisLabel: { color: C.dim, fontSize: 10, formatter: '{value}%' },
      }),
      series: d.names.map(function (name, i) {
        return {
          name: cat(name),
          type: 'bar',
          stack: 'total',
          barWidth: '52%',
          data: d.series[name],
          itemStyle: {
            color: name === '其它' ? '#334155' : PALETTE[i % PALETTE.length],
            borderColor: 'rgba(7,11,20,0.85)',
            borderWidth: 0.5,
          },
          emphasis: { focus: 'series' },
        };
      }),
    }, true);
  }

  /* ---------- ⑧ 跨国同榜热度（横向条形） ---------- */
  function chartOverlap() {
    var inst = state.charts.overlap;
    var pairs = Data.overlapPairs().slice(0, 14).reverse();

    inst.setOption({
      backgroundColor: 'transparent',
      grid: { left: 108, right: 62, top: 10, bottom: 22 },
      tooltip: tip({
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: function (p) {
          var item = pairs[p.dataIndex];
          var title = item ? zhFull(item.a) + ' ↔ ' + zhFull(item.b) : p.name;
          return title + '<br/>两国同榜视频：<b>' + fmt(p.value) + '</b> 个';
        },
      }),
      xAxis: valueAxis(),
      yAxis: catAxis(pairs.map(function (p) { return zh(p.a) + ' ↔ ' + zh(p.b); })),
      series: [{
        type: 'bar',
        barWidth: '58%',
        data: pairs.map(function (p) { return p.value; }),
        itemStyle: {
          borderRadius: [0, 4, 4, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: C.wineDeep },
            { offset: 1, color: C.wine },
          ]),
        },
        label: {
          show: true, position: 'right', color: C.text, fontSize: 11,
          formatter: function (p) { return fmt(p.value); },
        },
      }],
    }, true);
  }

  /* ---------- ⑨ 国家 × 星期 观看热度（热力图） ---------- */
  function chartWeekday() {
    var inst = state.charts.weekday;
    var m = Data.weekdayMatrix();

    inst.setOption({
      backgroundColor: 'transparent',
      grid: { left: 62, right: 18, top: 12, bottom: 52 },
      tooltip: tip({
        formatter: function (p) {
          var v = p.data.value;
          var row = m.rows[v[1]];
          var level = p.data.level;
          var tag = level >= 0.99 ? '本国最热的一天'
            : level <= 0.01 ? '本国最冷的一天'
              : level >= 0.6 ? '偏热'
                : level <= 0.4 ? '偏冷' : '接近本国平均';
          return zhFull(row.cc) + ' · ' + WEEKDAYS[v[0]] + '<br/>'
            + '该日视频平均播放：<b>' + v[2].toFixed(1) + ' 万</b>（' + tag + '）<br/>'
            + '该国本周区间 ' + Math.min.apply(null, row.avg).toFixed(1)
            + ' ~ ' + Math.max.apply(null, row.avg).toFixed(1) + ' 万<br/>'
            + '（该日 ' + fmt(v[3]) + ' 条 / 该国上榜共 '
            + fmt(row.counts.reduce(function (a, b) { return a + b; }, 0)) + ' 条）';
        },
      }),
      xAxis: catAxis(WEEKDAYS, { splitArea: { show: false } }),
      yAxis: catAxis(m.ccs.map(zh), { axisLabel: CC_AXIS }),
      /*
       * 这个 visualMap 只当「图例」用，不参与着色 ——
       * 颜色已经在 Data.weekdayMatrix() 里逐条写进 itemStyle 了。
       * 为什么不用它着色：heatmap 的 series.itemStyle.color 会盖掉分段型
       * visualMap 的着色（连续型才盖得过去），用它反而会让整张图变白。
       * 每个 piece 给 value 而不是 min/max，效果就是只显示色块、不筛选数据。
       */
      visualMap: {
        type: 'piecewise',
        pieces: m.LABELS.map(function (label, i) {
          return { value: i, label: label, color: m.COLORS[i] };
        }),
        show: m.data.length > 0,
        orient: 'horizontal',
        left: 'center', bottom: 2,
        itemWidth: 16, itemHeight: 11, itemGap: 12,
        textStyle: { color: C.dim, fontSize: 11 },
      },
      series: [{
        type: 'heatmap',
        data: m.data,
        itemStyle: { borderColor: 'rgba(7,11,20,0.28)', borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: C.text, borderWidth: 1.4 } },
      }],
    }, true);
  }

  /* ======================================================================
   * 6. 渲染编排
   * ==================================================================== */

  // [容器 id, 实例 key, 渲染函数]
  var CHARTS = [
    ['chart-map', 'map', chartMap],
    ['chart-heat-cat', 'heatCat', chartHeatCat],
    ['chart-wordcloud', 'wordcloud', chartWordcloud],
    ['chart-time', 'time', chartTime],
    ['chart-channels', 'channels', chartChannels],
    ['chart-likerate', 'likerate', chartLikeRate],
    ['chart-catshare', 'catShare', chartCategoryShare],
    ['chart-overlap', 'overlap', chartOverlap],
    ['chart-weekday', 'weekday', chartWeekday],
  ];

  /** 为九个容器各建一个 ECharts 实例 */
  function initCharts() {
    CHARTS.forEach(function (row) {
      var dom = $(row[0]);
      if (!dom) return;
      state.charts[row[1]] = echarts.init(dom, null, { renderer: 'canvas' });
    });
  }

  /** 重画全部九个图表（切换国家 / 重置时调用） */
  function renderAll() {
    CHARTS.forEach(function (row) {
      var fn = row[2];
      if (state.charts[row[1]]) fn();
    });
    updateBadges();
  }

  /** 词云的范围标签与来源提示 */
  function updateBadges() {
    $('wc-scope').textContent = state.focus
      ? zh(state.focus) + ' (' + state.focus + ')'
      : '全部国家';

    $('wc-hint').textContent = state.words === 'tag'
      ? '来自 tags 标签字段 —— 反映上传者给视频打的分类词'
      : '来自视频标题分词 —— 反映观众实际点开的题材';
  }

  /** 顶部四个统计卡与页脚 */
  function renderSummary() {
    var videos = 0;
    var views = 0;
    state.meta.countries.forEach(function (c) {
      videos += Data.of(c.cc).uniq;
      views += Data.of(c.cc).views_sum;
    });

    $('stat-countries').textContent = state.meta.countries.length;
    $('stat-videos').textContent = fmt(videos);
    $('stat-views').textContent = fmtBig(views);
    $('stat-multi').textContent = state.agg.multi_country_media.length + '+';

    var t = state.agg.generated_at ? new Date(state.agg.generated_at) : new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    $('stat-updated').textContent = t.getFullYear() + '/' + (t.getMonth() + 1) + '/' + t.getDate()
      + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes());

    $('foot-note').textContent = '数据：10 国 ' + fmt(videos) + ' 个去重视频 · 聚合文件 '
      + state.agg.multi_country_media.length + ' 个跨国同榜视频样本';
  }

  /* ======================================================================
   * 7. 交互绑定
   * ==================================================================== */
  function bindEvents() {
    // 聚焦国家：重画全部图表
    $('sel-country').addEventListener('change', function (e) {
      state.focus = e.target.value;
      renderAll();
    });

    // ② 号热力图换指标：只重画它自己
    $('sel-heat').addEventListener('change', function (e) {
      state.heatMetric = e.target.value;
      chartHeatCat();
    });

    // 词云在「标题 / tags」之间切换
    var segs = document.querySelectorAll('.seg__btn');
    function markSeg(active) {
      Array.prototype.forEach.call(segs, function (b) {
        b.classList.toggle('is-active', b === active);
      });
    }
    Array.prototype.forEach.call(segs, function (btn) {
      btn.addEventListener('click', function () {
        var v = btn.getAttribute('data-words');
        if (v === state.words) return;
        state.words = v;
        markSeg(btn);
        chartWordcloud();
        updateBadges();
      });
    });

    // 重置：回到「全部国家 / 标题 / 视频数量」
    $('btn-reset').addEventListener('click', function () {
      state.focus = '';
      state.words = 'title';
      state.heatMetric = 'count';
      $('sel-country').value = '';
      $('sel-heat').value = 'count';
      Array.prototype.forEach.call(segs, function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-words') === 'title');
      });
      renderAll();
    });

    // 窗口大小变了要通知 ECharts 重算尺寸（加防抖，避免拖动时狂算）
    var timer = null;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        Object.keys(state.charts).forEach(function (k) {
          state.charts[k].resize();
        });
      }, 160);
    });
  }

  /* ======================================================================
   * 8. 加载与启动
   * ==================================================================== */

  function showOverlay(title, detail, isError) {
    var o = $('overlay');
    o.hidden = false;
    o.classList.toggle('overlay--error', !!isError);
    $('overlay-spinner').hidden = !!isError;
    $('overlay-title').textContent = title;
    $('overlay-detail').textContent = detail || '';
  }

  function hideOverlay() { $('overlay').hidden = true; }

  /** 国家下拉项 */
  function fillCountrySelect() {
    var sel = $('sel-country');
    state.meta.countries.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.cc;
      o.textContent = c.zh + '（' + c.cc + '）';
      sel.appendChild(o);
    });
  }

  function boot() {
    showOverlay('正在加载数据并绘制图表…', '读取 data/aggregates.json 与 data/meta.json');

    Promise.all([
      fetch('data/aggregates.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('aggregates.json 请求失败：HTTP ' + r.status);
        return r.json();
      }),
      fetch('data/meta.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('meta.json 请求失败：HTTP ' + r.status);
        return r.json();
      }),
      // 世界地图 GeoJSON：依赖可能在各条路径下，依次试。
      // 用 catch 兜底成 null —— 地图拿不到不应该让整页图表都出不来。
      fetch(LIB + 'world.json', { cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }),
    ]).then(function (res) {
      state.agg = res[0];
      state.meta = res[1];
      state.hasMap = !!res[2];

      if (state.hasMap) {
        echarts.registerMap('world', res[2]);
      } else {
        console.warn('[week56 大屏] world.json 未取到，世界地图显示占位提示，其余图表不受影响。');
      }

      fillCountrySelect();
      initCharts();
      bindEvents();      // 必须在 initCharts 之后，事件里要用 state.charts
      renderSummary();
      renderAll();

      hideOverlay();
      console.info('[week56 大屏] 图表已渲染：' + CHARTS.length + ' 个');
    }).catch(function (err) {
      console.error('[week56 大屏] 加载失败：', err);
      var isFile = location.protocol === 'file:';
      showOverlay(
        isFile ? '需要通过本地服务器打开页面' : '数据加载失败',
        isFile
          ? 'file:// 协议下浏览器会阻止 fetch 读取本地文件。\n'
            + '请用 VS Code Live Server 打开，或起任意静态服务器，\n'
            + '并把网站根目录指向 study（然后访问 /week56/）。'
          : '无法读取 data/aggregates.json。\n'
            + '请确认 study/week56/data/ 下有 aggregates.json、meta.json 与各国 CSV。\n'
            + '错误信息：' + (err && err.message ? err.message : String(err)),
        true
      );
    });
  }

  /*
   * 本文件由 index.html 的加载器用 <script> 动态插入，插入时 ECharts 已经就绪。
   * 所以这里不自己调 boot()，而是挂到 window.__W56_BOOT__ 上，由加载器调用。
   */
  window.__W56_BOOT__ = boot;
})();
