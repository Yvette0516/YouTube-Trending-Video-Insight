# Trending Video Insight —— 学习文档

> **这是什么**
>
> 这是一份**学习文档**，记录我用 YouTube 热门视频数据集做的两组练习：
>
> | 练习 | 位置 | 内容 |
> |---|---|---|
> | **第三周** | `study/week3/` | 用 `fetch` 读 CSV/JSON + DOM 操作，做一个可搜索/筛选/排序的**榜单页** |
> | **第五·六周** | `study/week56/` | 用 ECharts 做**静态数据大屏**，分析十国视频观看偏好 |
>
> `study` 文件夹用来放平时的练习，以后 week7、week8 会依次排下去。
>
> **两个页面的入口**（都不是项目根目录那个 `index.html`）：
> - week3 榜单：`study/week3/index.html`
> - week56 大屏：`study/week56/index.html`

---

## 目录

- [1. 目录结构](#1-目录结构)
- [2. 怎么运行](#2-怎么运行)
- [3. week3：榜单页](#3-week3榜单页)
- [4. week56：数据大屏](#4-week56数据大屏)
- [5. 数据从哪来](#5-数据从哪来)
- [6. 重新生成数据](#6-重新生成数据)
- [7. 已知限制](#7-已知限制)

---

## 1. 目录结构

```
Trending Video Insight/                 ← 项目根
├── index.html            0 字节空占位（不参与运行）
├── css/main.css          0 字节空占位
├── js/main.js            0 字节空占位
├── README.md             本文档
├── .vscode/settings.json Live Server 网站根配置 → study
│
├── data/                 ← 最初放进去的原始数据集
│   ├── archive.zip                          210 MB，10 国原始 CSV + 类别 JSON
│   └── YouTube视频分类映射表.csv              category_id → 中文类别名
│
└── study/                ← 练习都在这里
    ├── lib/              ★ 第三方库（放在 week56 之外）
    │   ├── echarts.min.js              ECharts 5.5.1
    │   ├── echarts-wordcloud.min.js    词云扩展
    │   └── world.json                  世界地图 GeoJSON（1 MB）
    │
    ├── week3/            ← 第三周：榜单页
    │   ├── index.html
    │   ├── css/style.css
    │   ├── js/app.js
    │   └── data/         KR 原始 CSV/JSON（页面 fetch 读取）
    │
    └── week56/           ← 第五·六周：数据大屏
        ├── index.html
        ├── css/style.css
        ├── js/app.js
        └── data/         10 国裁剪 CSV（84 MB）+ 聚合 JSON
```

**依赖为什么放 `study/lib/`**：要求是「依赖下载到外部文件夹，不放进练习文件夹」。
所以 week56 里只有自己写的 html/css/js 和数据，ECharts 在它的上一级。

> 代价：`study/week56/` 单独拷走**不能**运行（缺 `../lib/`）。
> 要整包搬走请带上整个 `study/`。

---

## 2. 怎么运行

两个页面都必须通过 **http 协议**访问 —— `file://` 下浏览器会禁止 `fetch` 读本地文件。

### 方式一：VS Code Live Server（推荐）

项目根的 `.vscode/settings.json` 已经把 Live Server 的网站根设成 `study`：

```json
{ "liveServer.settings.root": "/study" }
```

**打开项目根**，右键任意页面的 `index.html` → *Open with Live Server*，然后访问：

- week3 榜单 → `http://127.0.0.1:5500/week3/`
- week56 大屏 → `http://127.0.0.1:5500/week56/`

> **为什么根要设成 `/study` 而不是 `/study/week3`**
>
> ECharts 库放在 `study/lib/`，两个练习分别在 `study/week3/`、`study/week56/`。
> 只有把根设在 `study`，**一个服务器才能同时服务两个页面 + 依赖目录**。
>
> 如果根设成 `/study/week3`，点 week56 的 html 时 Live Server 仍从 week3 开始服务，
> 浏览器就会显示 week3 的页面或用 `Cannot GET /week56/index.html` 报错 —— 这是最容易踩的坑。

> 改完 `.vscode/settings.json` 后必须**重启 Live Server**（Stop 再 Start）。
> 该设置在**启动时**读取，改完只刷新页面是不生效的。

#### week56 会自动适配网站根

`week56/index.html` 里有一段加载器，会按顺序试探依赖位置，**哪种根都能跑**：

| 网站根 | 加载路径 | 结果 |
|---|---|---|
| `/study`（推荐） | `lib/` 命中 | ✅ 9 图 + 世界地图，**完全离线** |
| `/week56` | `lib/` 与 `../lib/` 都出不了根 | ✅ 9 图，但 ECharts 走 **CDN**（需联网），世界地图显示占位提示 |

所以**推荐把根设在 `study`** —— 那是唯一能完全离线、且世界地图可用的方式。

> 加载顺序是**串行**的：`echarts.min.js` 必须先加载完，再加载
> `echarts-wordcloud.min.js`。并发加载会因为词云扩展找不到 ECharts 核心而报
> `Cannot read properties of undefined (reading 'extendSeriesModel')`。

### 方式二：直接把 `study` 当工作区打开

不想依赖配置的话：VS Code → 打开文件夹 → 选 `study`，然后右键 html →
*Open with Live Server*。根自然就是 `study`，上表两个地址同样可用。

### 方式三：只用 Windows 自带功能

在项目根执行（`TcpListener` 流式发送，不需要管理员权限）：

```powershell
$root = (Resolve-Path "study").Path
$l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 5500)
$l.Start(); "已启动: http://localhost:5500/   按 Ctrl+C 停止"
while ($true) {
  $c = $l.AcceptTcpClient(); $s = $c.GetStream()
  try {
    $buf = New-Object byte[] 8192; $null = $s.Read($buf, 0, 8192)
    $req = ([Text.Encoding]::ASCII.GetString($buf) -split "`r`n")[0]
    $rel = ($req -split ' ')[1].TrimStart('/'); if (-not $rel) { $rel = 'index.html' }
    $p = Join-Path $root ([Uri]::UnescapeDataString($rel))
    $ct = switch ([IO.Path]::GetExtension($p)) {
      '.html' {'text/html; charset=utf-8'} '.css' {'text/css; charset=utf-8'}
      '.js' {'text/javascript; charset=utf-8'} '.json' {'application/json; charset=utf-8'}
      '.csv' {'text/csv; charset=utf-8'} default {'application/octet-stream'} }
    if (Test-Path $p -PathType Leaf) {
      $len = (Get-Item $p).Length
      $h = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: $ct`r`nContent-Length: $len`r`nConnection: close`r`n`r`n")
      $s.Write($h, 0, $h.Length)
      $fs = [IO.File]::OpenRead($p)
      $chunk = New-Object byte[] 65536
      while (($n = $fs.Read($chunk, 0, $chunk.Length)) -gt 0) { $s.Write($chunk, 0, $n) }
      $fs.Close(); $s.Flush()
    } else {
      $b = [Text.Encoding]::UTF8.GetBytes('404')
      $h = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 404 Not Found`r`nContent-Length: $($b.Length)`r`nConnection: close`r`n`r`n")
      $s.Write($h, 0, $h.Length); $s.Write($b, 0, $b.Length); $s.Flush()
    }
  } catch { } finally { $c.Close() }
}
```

然后访问 `http://localhost:5500/week3/` 或 `/week56/`。

### 打不开时怎么排查

1. **空白页 / 一直显示加载中** → 多半是双击打开的（`file://`）。改用 http。
2. **打开 week56 却显示 week3 的页面** → `.vscode/settings.json` 的
   `liveServer.settings.root` 被设成了 `/study/week3`（或别的单页目录）。
   应设成 `/study`，然后**重启 Live Server**（Stop → Start）。
3. **大屏图表全空 / 只有一部分** → F12 Console 看是否有 `../lib/` 的 404。
   说明网站根不是 `study`，ECharts 加载不到。
4. **提示端口占用** → 换端口，或先找出占用进程：
   ```powershell
   netstat -ano | findstr :5500
   taskkill /PID <PID> /F
   ```
   > 结束前先确认那个 PID 确实是本项目的服务器，VS Code 也可能占用 5500。

---

## 3. week3：榜单页

### 做了什么

韩国热门视频播放量 TOP10 榜单，支持搜索、类别筛选、三种排序、重置。

**技术核心：`fetch` 读取本地 CSV/JSON + DOM 操作 + 事件绑定。**

### 数据流（全在浏览器里）

```
fetch data/KRvideos.csv (34.8 MB)、KR_category_id.json、YouTube视频分类映射表.csv
  → TextDecoder 容错解码（处理原始数据的损坏字节）
  → 引用感知 CSV 解析
  → 清洗：类型转换 / 缺字段丢弃 / 类别映射（中文名）
  → 按 video_id 去重（保留播放量最高的一条）
  → 三段排序：播放量 ↓ → 点赞 ↓ → video_id ↑
  → 过滤 → 排序 → 取前 N → 渲染
```

**页面不使用任何预生成的 JSON**，打开时现场解析。实测解析 34.8 MB 约 **1.0 秒**。

### 代码怎么读（week3/js/app.js，按这个顺序看）

代码按「读数据 → 加工 → 画出来 → 绑交互」的顺序排列，从上往下读就是执行顺序：

| 区块 | 做什么 |
|---|---|
| 1. 配置与 DOM 引用 | 文件路径、TOP10 / 100 条上限，以及把用到的元素一次性取好 |
| 2. 格式化 | 千分位、百分比、时间、文本转数字 |
| 3. **`parseCsv()`** | 引用感知的 CSV 解析器（本项目最容易踩坑的地方） |
| 4. **`loadData()`** | 读三个文件 → 建类别映射 → 清洗 → 按 video_id 去重 → 排序 |
| 5. 状态提示区 | 加载中 / 加载失败 / 无结果三种提示 |
| 6. 渲染 | 顶部元数据、统计条、表格 |
| 7. 事件绑定 | 搜索（150ms 防抖）、类别、排序、重置 |
| 8. 启动 | `fillCategorySelect()` 建下拉，`boot()` 串起来 |

全文 **620 行**，其中注释约占四分之一。没有复杂的模块嵌套，就是一个 IIFE
里面一串普通函数，函数名即功能。


### 关键处理决策

| 决策 | 取值 | 原因 |
|---|---|---|
| 数据条数 | 全部 15,876 条（去重后） | 完整统计，不截断 |
| 类别名 | 中文 | 原始 JSON 只有英文名，中文取自映射表 |
| 同视频多日上榜 | 按 `video_id` 去重，保留播放量最高 | 原始是每日快照，54% 是重复 |
| 播放量相同时 | 再比点赞，取数值更完整的 | 数据集存在 views 相同、likes 差 1 的重复快照 |
| 平局排序 | 追加 `video_id` 升序作第三排序键 | 避免依赖内部枚举顺序，保证结果可复现 |
| `trending_date` | 原样展示 | 格式是 `YY.DD.MM`，非标准 ISO 日期 |
| 默认显示 | 无筛选 TOP10，有筛选前 100 条 | 用户主动搜索时想看更多 |

### 数据概况（实测）

原始 34,567 行 → 去重 **15,876 个**唯一视频；播放量区间 2,050 ~ 113,876,217；
含韩文标题 14,451 条；无法解码的字节 66 处（占比 < 0.001%）。

### 三个必须记住的坑

**① CSV 不能用 `split(',')` 解析**

`tags` / `description` 字段里含**带引号的逗号和换行符**。朴素按行切分会产生
**2,163 行字段错位**，而且**不报错** —— 数据是错的但你不知道。所以写了状态机解析器。

**② 原始数据本身有损坏字节**

`KRvideos.csv` 有 114 处非法 UTF-8 序列（合法前导字节后跟非法后继字节）。
`TextDecoder(fatal: true)` 会直接抛错导致整个文件读不了，必须用 `fatal: false` 容错。

**③ `fetch` 不会因 404 报错**

必须在 `.then` 里检查 `res.ok`。不检查的话，`res.json()` 会去解析 404 页面的 HTML，
抛出难懂的 `Unexpected token '<'`。

### 代码逐行讲解

见 `_external/说明文档/week3代码讲解.md`（项目文件夹之外）。

---

## 4. week56：数据大屏

### 做了什么

静态「热门视频数据大屏」，分析方向是**不同国家的视频观看偏好**。
覆盖 10 国：美国、英国、加拿大、德国、法国、俄罗斯、墨西哥、日本、韩国、印度。

**技术：ECharts 5.5.1 静态渲染，无后端、无数据库。**

> **配色：白底 + 酒红块状主色；奶黄与浅紫只在图表里当数据系列色**（与 week3 同一套）
>
> **两条硬规则：**
>
> 1. **文字只有黑 / 白 / 灰三种**，彩色一律不参与文字；
> 2. **奶黄与浅紫只出现在图表内部**，页面上的色块、按钮、边框、图标一律不用它们。
>
> | 用途 | 色值 |
> |---|---|
> | 浅底上的文字 | 黑 `#111111` / 灰 `#434343` / `#767676` |
> | 酒红块上的文字 | 白 `#FFFFFF` |
> | 酒红（唯一的块状主色） | `#BC4059`（标题栏、表头、统计卡、选中按钮） |
> | 深酒红 | `#94293C`（细线、极淡胶囊的文字与边框） |
> | 极淡酒红 | `#FDF2F5`（控件底色、表头底色、悬停色） |
> | 奶黄（图表系列 + 呼吸灯） | `#F2D06B` |
> | 浅紫（仅图表系列） | `#9B7FD4` |
>
> **唯一的一处例外**：大屏标题栏右上角那个会呼吸的小圆点（`.dot-live`）用的是奶黄
> `#F2D06B`，配酒红底对比度约 3.9。它只有 7px、不承载数据、不参与文字，
> 所以不破坏整页的稳重感。审计脚本里把它列进了白名单，运行时会打印
> 「已豁免：.dot-live 呼吸灯」。
>
> **为什么黄与紫不进页面**（这一条仍然成立，只是呼吸灯除外）：这两种颜色本身没问题，
> 问题在用法。试过两版都被否掉：
>
> - 奶黄当文字配白底只有 **1.50:1**，完全看不清；
> - 奶黄当大面积底块（统计卡数字底色、面板标题底色）虽然对比度够，
>   但观感很跳、显得廉价 —— 换成了**酒红块 + 白字**。
>
> 现在页面上的"彩色面积"只有酒红一种，黄与紫退回到图表内部做数据系列色
> （加一个呼吸灯），整页因此更**稳重和谐**，不会这里一块黄、那里一块紫地打架。
> 图表内部也做了收敛：
>
> - 词云：从"青蓝 + 亮紫"改成**酒红为主、黄紫少量点缀**的单色阶家族。
>   配色也从 `Math.random()` 改成了**按词序走的固定转盘** ——
>   8 个色位里 6 个属于酒红家族，黄与紫各只占 1 个，所以整张词云恒定为
>   约 73% 酒红 / 15% 黄 / 12% 紫，刷新多少次都一样、截图可复现；
> - 周内热力图（⑨）：改成**浅粉 → 粉 → 酒红 → 深红 → 暖金**的五级阶梯，
>   金色只留给"本国这一周最热的那几天"；
> - 点赞率柱状图、头部频道条形图：从金黄色系改成**酒红单色阶**（值越高越深）。

> 实测 15 个关键元素的对比度**全部达到 WCAG AA（≥4.5）**，
> 用 `开发工具/tests/contrast_check.mjs` 可直接复测。
> 该脚本会**逐层混合半透明背景**后再算对比度 —— 否则会把
> `rgba(255,255,255,0.05)` 这类半透明层误当成最终背景，得出假结论。
>
> 另外还有一个专门的审计脚本 `开发工具/tests/palette_audit.mjs`：
> 它把页面上每个元素的文字色 / 背景色 / 边框色换算成 HSL，
> 命中的黄系（色相 32~72）与紫系（色相 240~310）如果**不在图表容器里**就报错。
> 现在两个页面都是「命中 0 处」，可以随时复测，防止以后改色时手滑。
>
> 图表配色定义在 `js/app.js` 顶部的 `C` 对象与 `PALETTE` 数组里，
> 页面样式定义在 `css/style.css` 的 `:root` 变量里 —— 想再换色改这两处即可。

> **图表里的国家名统一用中文**（美国 / 英国 / …），不用 `US` / `GB` 这类缩写。
> 提示框里会带上代码（如「韩国 (KR)」），方便对照原始数据。
> 实现上由 `zhOf()` / `ccLabel()` / `ccFull()` 三个小函数统一处理，
> 中文名取自聚合数据里每国自带的 `zh` 字段。

### 九个图表

| # | 图表 | 类型 | 看什么 |
|---|---|---|---|
| ① | 各国平均播放量 | **世界地图** 着色图 | 哪个国家的榜单视频"体量"最大 |
| ② | 国家 × 类别 偏好 | **热力图** | 哪个国家偏爱哪类视频（可切换 数量/均播放/占比） |
| ③ | 高频词云 | **词云** | 各国观众关注什么词（可切换 标题 / tags） |
| ④ | 发布时间趋势 | 折线 + 面积 | 上榜视频按月分布 |
| ⑤ | 头部频道 | 横向条形 | 各国播放量最高的频道 |
| ⑥ | 点赞率分布 | 柱状 | 点赞率集中在哪个区间 |
| ⑦ | 类别构成占比 | 堆积条形 | 各国类别"指纹"对比 |
| ⑧ | 跨国同榜热度 | 横向条形 | 两国同时上榜的视频数 → 口味接近度 |
| ⑨ | 国家 × 星期 观看热度 | **热力图** | 各国视频在哪天的平均播放量最高 |

共 **9 个图表**，含 **2 个热力图**、**1 个词云**、**1 个世界地图**。

### 代码怎么读（week56/js/app.js）

同样是从上往下读就是执行顺序：

| 区块 | 做什么 |
|---|---|
| 1. 常量与配色 | 库路径、星期名、GeoJSON 国家名映射、`C` 调色板、`PALETTE` 系列色 |
| 2. 页面状态 | `state`：当前聚焦的国家、词云数据源、② 号图指标、九个 ECharts 实例 |
| 3. 小工具 + **公共配置片段** | `fmt` / `fmtBig` / `zh` / `shade`，以及 `tip()` `catAxis()` `valueAxis()` |
| 4. `Data` | 把「按国家存的聚合数据」翻成「各图表要的形状」，每个函数对应一两张图 |
| 5. 九个 `chartXxx()` | 每个都是「取数据 → `setOption`」，长度 35~70 行 |
| 6. 渲染编排 | `CHARTS` 表格 + `initCharts()` / `renderAll()` |
| 7. 事件绑定 | 聚焦国家、词云切换、热力图指标、重置、窗口 resize |
| 8. 加载与启动 | `boot()`：读 JSON → 注册地图 → 建实例 → 绑事件 → 画 |

**最值得看的一处简化**是第 3 区的三个「公共配置片段」。
ECharts 每个图表都要写一遍提示框样式和坐标轴样式，九个图写九遍既啰嗦、
改一处颜色要翻九个地方。抽成函数之后，每个 `chartXxx()` 都只剩
「这个图的数据长什么样、用哪种图型」，读起来干净很多：

```js
// 以前：每个图表里都重复这一整段
tooltip: {
  backgroundColor: 'rgba(255,255,255,0.97)',
  borderColor: 'rgba(188,64,89,0.36)',
  textStyle: { color: C.text, fontSize: 12 },
  formatter: ...
}

// 现在：一行
tooltip: tip({ trigger: 'axis' })
```


> **⑨ 号图的口径换过三次，最后一次才对**，过程记下来当参考：
>
> | 版本 | 口径 | 为什么不行 |
> |---|---|---|
> | v1 | 各天上榜**条数** | 各国上榜总量差 4 倍（加拿大 2.4 万、美国 6 千），美国最高的格子才 1,097 条，比加拿大的普通格子还"浅"，**结论完全相反** |
> | v2 | 各天**发布占比** | 公平了，但差距太小：10 国的单日占比全挤在 13%~17%，极差只有 **3.8 个百分点**（变异系数 0.07），画出来一片糊 |
> | v3 | 各天**平均播放量** + 行内相对热度 | ✅ 见下 |
>
> **为什么是"平均播放量"**：它一步解决了 v1 的可比性问题 ——
> "每条视频平均被看了多少次"本身就把各国上榜总量的差异除掉了，不用再除以总量。
> 换算后极差从 3.8 个百分点变成 **775.9 万次**。
> 而且口径含义更贴合本页主题：占比讲的是"上传习惯"，平均播放量讲的是"观看偏好"。
>
> **为什么着色还要按行归一化**：各国量级差 45 倍（英国 320~793 万，
> 日本 17.5~26.8 万）。若用全局同一把色标，英国会整行顶格、
> 日俄等 5 国会整行垫底，同样没有信息量。所以每行按
> **"本国这一周最冷的一天 → 最热的一天"** 拉伸成 5 档
> （浅粉 → 粉 → 酒红 → 深红 → 暖金），这样每行都看得出自己的节奏，
> 而绝对数值放进提示框，信息不丢。
>
> 换完立刻能读出的结论：**周五是 8 个国家的最高点**（英国 793 万、
> 美国 286 万），**周六普遍最冷**；例外是韩国与印度，**周三最高**。
>
> 实现上没用 ECharts 的 `visualMap` 着色，原因是 `heatmap` 的
> `series.itemStyle.color` 会盖掉**分段型** `visualMap` 的着色（连续型才盖得过去），
> 之前踩过这个坑，整张图会变成白的。现在改为在数据层逐条写 `itemStyle.color`，
> `visualMap` 只当图例用（`pieces` 里给 `value` 而不是 `min/max`，就只显示色块、不筛选数据）。

### 交互

- **聚焦国家**：下拉选某国后，词云、热力图、趋势、频道等图表都切换为该国的数据
- **词云文本源**：标题分词 ↔ tags 标签，随时切换（附提示说明两者区别）
- **热力图指标**：视频数量 / 平均播放量 / 占该国比重
- **重置视图**：一键恢复全部对比

### 数据流

```
data/aggregates.json (0.26 MB)  →  九张图表直接渲染（瞬时）
data/<cc>.csv (84 MB 合计)      →  各国裁剪明细，供后续下钻分析
```

聚合文件把「国家 × 类别」「国家 × 月份」「国家 × 星期」「跨国矩阵」
「词频表」等维度都预先算好，所以图表加载后立刻出图，不必等 84 MB。

### 数据规模

| 指标 | 值 |
|---|---|
| 覆盖国家 | 10 |
| 去重后视频合计 | 207,148 个 |
| 播放量合计 | 约 1,099 亿 |
| 跨国同榜视频（≥2 国） | 60+ 个样本 |
| 类别数 | 18 |
| 聚合文件 | 0.26 MB |
| 各国裁剪 CSV | 合计 84 MB |

### 几个有意思的发现

- **口味最接近的组合**：加拿大 ↔ 美国（同榜 5,236 个视频），其次德国 ↔ 法国、美国 ↔ 加拿大
- **10 国全部同榜的"全球通吃"视频**：《复仇者联盟 3》预告、《碟中谍 6》预告、
  Taylor Swift《Delicate》、VENOM 预告、Ed Sheeran《Happier》—— 清一色好莱坞预告片与欧美流行音乐
- **平均播放量差异极大**：英国 481 万 / 美国 196 万 vs 日本 22.6 万 / 墨西哥 27.9 万
  （注意：这是「去重后所有视频」的均值，小语种市场长尾视频更多，会把均值拉低）
- **词云对比**：标题高频词偏"内容题材"（first / game / show / makeup），
  tags 高频词偏"平台分类"（show / funny / news / comedy）—— 说明 tags 更像官方分类标签，
  而标题才真正反映观众点开了什么
- **一周里周五最能打**：10 国里有 8 国的"单日平均播放量"最高点落在周五
  （英国 793 万、美国 286 万），周六普遍最冷；例外是韩国与印度，峰值在周三。
  注意这是 trending 快照数据，越接近抓取日期的视频越容易上榜，
  所以"周五高峰"里含有一部分数据本身的采样特性，不能当成纯粹的观众作息

### 已知的取舍

- 页面用**聚合数据**渲染图表，不直接读 84 MB 原始 CSV。想看逐条明细需要另做下钻页面。
- 世界地图只对 10 个有数据的国家着色；其余国家为深灰底色。
- 词云用轻量分词（按非字母数字切分 + 停用词表），没有做词干还原，
  所以 `game` / `games` 会被算成两个词。

### 视觉验证

用 Chrome 无头模式 + DevTools Protocol 实测：

```
canvas 数        : 9 / 9 全部出图
网络请求         : 9 个全部成功，0 失败
顶部统计         : 10 国 / 207,148 视频 / 1099.1 亿播放
国家下拉         : 11 项（含"全部国家对比"）
聚焦韩国         : 词云范围切换为「韩国 (KR)」，图表全部重绘
词云切 tags      : 生效，提示文案同步更新
重置             : 国家/指标/词源全部回到默认
页面运行时异常   : 无
```

> 两个页面都加了一枚**内联 SVG 图标**（`<link rel="icon" href="data:image/svg+xml,...">`），
> 免得浏览器自动请求 `favicon.ico` 而在控制台留下 404 —— 该 404 无害，但会干扰排查。

---

## 5. 数据从哪来

Kaggle 数据集 **Trending YouTube Video Statistics**，含 10 国的每日热门榜快照：

| 文件 | 说明 |
|---|---|
| `data/archive.zip` | 原始压缩包，内含 `<CC>videos.csv` 与 `<CC>_category_id.json` |
| `data/YouTube视频分类映射表.csv` | `category_id, english_name, chinese_name` |

各国规模（原始行数 → 去重后唯一视频 → 裁剪后体积）：

| 国家 | 原始行 | 唯一视频 | 裁剪 CSV |
|---|---|---|---|
| US 美国 | 40,949 | 6,351 | 2.2 MB |
| GB 英国 | 38,916 | 3,272 | 1.1 MB |
| CA 加拿大 | 40,881 | 24,427 | 9.3 MB |
| DE 德国 | 40,840 | 29,627 | 11.0 MB |
| FR 法国 | 40,724 | 30,581 | 11.0 MB |
| RU 俄罗斯 | 40,739 | 34,282 | 20.4 MB |
| MX 墨西哥 | 40,451 | 33,513 | 12.6 MB |
| JP 日本 | 20,523 | 12,912 | 5.0 MB |
| KR 韩国 | 34,567 | 15,876 | 6.5 MB |
| IN 印度 | 37,352 | 16,307 | 8.7 MB |

> **为什么 US/GB 的唯一视频特别少**：这两个榜的重复上榜率极高
> （US 40,949 行只对应 6,351 个视频），说明英美榜单长期被同一批头部视频占据。

---

## 6. 重新生成数据

数据已生成好并随包提供，**只做演示不需要这一步**。

生成脚本都在项目之外的 `_external/开发工具/`（依赖不进项目文件夹），全部是**纯 JavaScript**，
不需要 Python、不需要 pandas。

### week3 数据

```powershell
cd "C:\Users\moyve\Desktop\Trending Video Insight"
node ..\_external\开发工具\prepare_data.mjs
```

它自己起一个临时本地服务器，再用 `fetch` 读取 `study/week3/data/` 下的 CSV/JSON，
处理后写回同目录。

### week56 数据

需要先把 `archive.zip` 里的 10 国 CSV 解压出来（约 514 MB）：

```powershell
# 1) 解压到外部临时目录
Add-Type -AssemblyName System.IO.Compression.FileSystem
$tmp = "C:\Users\moyve\Desktop\_external\_tmp_csv"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$z = [System.IO.Compression.ZipFile]::OpenRead("data\archive.zip")
$z.Entries | Where-Object { $_.Name -like '*videos.csv' -or $_.Name -like '*_category_id.json' } |
  ForEach-Object { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($_, (Join-Path $tmp $_.Name), $true) }
$z.Dispose()

# 2) 裁剪 + 聚合
node "C:\Users\moyve\Desktop\_external\开发工具\build_week56_data.mjs"
```

第二步会输出到 `_external\_tmp_out/`，再复制到 `study/week56/data/`。

---

## 7. 已知限制

1. **week56 不是自包含的** —— ECharts 在 `study/lib/`，单独拷 `week56` 跑不起来。
2. **两个页面都依赖 http 协议**，`file://` 下 `fetch` 会被浏览器拦截（页面会给出提示，不会白屏）。
3. **week56 的 84 MB 各国 CSV 目前只用于留存**，图表读的是 0.26 MB 聚合文件；
   逐条明细的下钻页面还没做。
4. **week3 的类别名是中文**，不是韩文 —— 数据源与映射表都没有韩文对照。
5. **week3 的 `trending_date` 是原始 `YY.DD.MM` 格式**，未转标准日期，不能用于日期排序。
6. **week56 的日期维度只能到"月"与"星期"** —— 原始 `trending_date` 格式不规范，
   所以趋势图用的是 `publish_time` 的日期部分。
7. 词云分词很轻量，没做词干还原，`game` / `games` 会分开计数。
8. 项目根目录的 `index.html`、`css/main.css`、`js/main.js` 是 0 字节占位文件，按设计不参与运行。
9. 窄屏（手机）布局只做了 CSS 规则层面的核对，**未在真实窄屏设备上验证过**。
