# ARCHITECTURE v0.2 —— 「一元知命」（暂名）技术方案

> 依据：CLAUDE.md、docs/PRD.md **v0.4**、rules/ v2（calendar.md v2、strength.md v2、yongshen.md v1、shensha.md v1.1、report-sections.md v2、texts/README.md v1、cases.json v2）。编写日期 2026-10-29。
> 产品形态：**只做 Web 端（电脑浏览器）和 H5（手机浏览器、微信内置浏览器）**，暂不考虑小程序（2026-10-29 用户决定）。
> **命理口径、槽位、素材格式一律以 rules/ 为准**，本文只定义代码怎么实现、怎么验证。两者冲突时以 rules/ 为准，并回报修改本文。
> 查不到可靠来源的数字一律标「未核实」，来源见第 15 节。

---

## 0. 一页结论

| 项 | 选择 | 一句话理由 |
|---|---|---|
| 语言 / 框架 | TypeScript + Next.js（App Router，Node 运行时，standalone 输出），单进程，前后端同一仓库 | Web + H5 一套页面；后端只有几个 API，放在同一进程里最省事，一个人能维护（方案比较见 2.1） |
| 核心引擎 | 排盘 / 规则 / 素材库 / 拼装做成**与框架无关的纯 TS 包** `packages/core`（不依赖 Next、React、Node IO） | 便于测试；以后换框架或换部署方式不用改引擎 |
| 后端职责 | 只做四件事：免费结果计算、下单与支付签名、支付回调与订单校验、**服务端拼装报告**；素材库只在服务端 | 素材是付费内容，不能下发到浏览器 |
| 免费结果 | **后端计算**（理由见 4.9） | 免费页和付费报告用同一份引擎代码、同一版本，结论不会对不上 |
| 报告生成 | 确定性代码按规则结论从 rules/texts/ 素材库选段拼装，运行时不调用大模型；润色接口只留接口、默认关闭、MVP 不实现调用 | PRD v0.4：同输入逐字一致、服务端 < 1 秒、零变动成本 |
| 排盘库 | **tyme4ts**（MIT）主库，显式设置 `LunarSect2EightCharProvider`（早晚子时）和 `LunarSect2ChildLimitProvider`（按分钟起运）；**lunar-javascript**（MIT，`setSect(2)`）只在测试里做差分对照 | 寿星天文历节气算法；库调用集中在一个适配文件 |
| 数据库 | **SQLite 单文件（WAL）+ 每 10 分钟在线备份到腾讯云 COS**；ORM 用 Drizzle（日后可切 PostgreSQL） | 只有一张订单表，数据量极小；零额外月费、零运维；托管 PG 价格未核实，量级约每月百元以上 |
| 出生信息 | 不落库、不进日志；报告链接 `/r/{订单号}#{Base64url 出生信息}`，片段不发给服务器，前端取出后用 POST body 提交；服务器只存 HMAC-SHA256 指纹（密钥在 `.env`） | PRD P0-8 / P0-10 |
| 支付 | 微信内置浏览器 → 微信 JSAPI；其他手机浏览器 → 支付宝手机网站支付；电脑 → 微信 Native 扫码 / 支付宝电脑网站支付 | 个体户能开的产品里覆盖最全（第 8 节） |
| 长图 | 前端把报告 DOM 渲染成图片（候选 modern-screenshot，需先预研），微信内用 `<img>` 浮层让用户长按保存 | PRD P0-9：在用户端完成，不经服务器 |
| 部署 | **腾讯云轻量应用服务器**（国内地域）+ Docker Compose（web + caddy + backup）+ ICP 备案；不用云函数（对比见 9.3） | 国内访问快、可备案、无冷启动；SQLite 需要持久磁盘 |
| 月成本 | 固定约 **¥75～¥85/月**（服务器 ¥45～¥50 + 服务号认证约 ¥25 + 域名 / 备份几元）+ 每单手续费约 ¥0.06～¥0.10；**没有大模型费用** | 第 11 节 |

---

## 1. 相对 v0.1 的变化

| 方面 | v0.1（已作废） | v0.2 |
|---|---|---|
| 报告怎么来 | 支付后由 worker 调大模型分章并行生成，失败重试 3 次、最终失败自动退款 | 打开报告时即时现算：排盘 → 规则 → 从素材库选段 → 填变量 → 校验，< 1 秒；**删除任务队列、worker、重试、自动退款、模型评测、提示词目录、大模型客户端** |
| 存储 | Order + Report（加密出生信息、报告正文）+ Job + GenerationAttempt + PaymentEvent | **只有 orders 一张表**：订单号、金额、状态、时间、出生信息指纹、素材库版本号（及支付流水号等支付字段）；不存出生信息、不存报告 |
| 报告访问 | `/r/{token}`，凭随机 token 查库读报告 | `/r/{订单号}#{编码后的出生信息}`，校验「已付款 + 指纹匹配」后现算 |
| 代码结构 | 引擎放在 Next.js 的 `src/lib` 下 | 引擎抽成纯 TS 包 `packages/core`，Next.js 应用只做页面和薄 API |
| 数据库 | 推荐腾讯云托管 PostgreSQL（需要做任务队列） | 推荐 SQLite + COS 备份（不再需要队列） |
| 免费页 | 含一句话性格画像 | 只有四柱、五行强弱图、日主旺衰、喜用 / 忌神 + 付费引导 |
| 子时 | 待定 | 早晚子时派，代码显式设置，用案例 C05 锁定 |
| 导出 | 长图 P1 | 长图 P0，PDF P1 |
| 隐私 | 字段加密、365 天过期删除、自助删除按钮 | 根本不存，所以不需要加密、过期清理、自助删除；改为保证日志里没有出生信息 |
| 合规 | 需评估生成式 AI 登记、AI 生成内容标识 | 运行时不调用大模型，生成式 AI 登记大概率不适用，不需要 AI 标识（启用润色前再评估） |
| 月成本 | 服务器 + 托管数据库 + 每单大模型 ¥0.2～¥0.8 | 服务器 + 小额固定费，无大模型费用 |

保留的部分：排盘库选型（tyme4ts + lunar-javascript 对照）、腾讯云国内部署 + ICP 备案、支付渠道组合与手续清单、类目风险应对、来源与「未核实」标注。

---

## 2. 技术栈

### 2.1 方案比较（只针对 Web + H5）

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **A. Next.js 全栈（页面 + Route Handlers 在一个进程），引擎为独立纯 TS 包** | 一个仓库、一种语言、一次部署；SSR 首屏快（H5 首屏对转化重要）；后端 API 只有几个，不值得单独起服务；生态和文档最多 | 绑定 React；Next.js 版本升级偶有破坏性变更 | **推荐** |
| B. Vite + React/Vue 单页 + 独立后端（Fastify / Express） | 前后端解耦、各自简单 | 两个工程、两套部署和 CORS 配置；单页首屏要等 JS 下载，弱网 H5 体验差一些 | 可行，但对一个人来说多一份维护 |
| C. uni-app（Vue）编译 H5 + 独立后端 | 用户熟悉 uni-app；以后若做小程序可复用页面 | 本项目已确定不做小程序，uni-app 的主要价值用不上；它的 H5 产物是单页，SEO / 首屏不如 SSR；电脑端（Web）适配不是它的强项；仍需单独写后端 | 不选；如果将来重新考虑小程序，因为引擎是纯 TS 包，可以直接被 uni-app 工程或云函数引用 |
| D. 云函数 / Serverless（腾讯云开发 CloudBase、SCF 等）+ 静态前端 | 按量计费，几乎零运维 | SQLite 不能用（没有持久磁盘），要换云数据库；冷启动可能拖慢「1 秒出结果」（未核实）；Next.js 在国内云函数上部署链路复杂 | 不选，详见 9.3 |

**推荐 A**。关键在于把真正有价值的部分（排盘、规则、素材库、拼装）放进与框架无关的 `packages/core`：前端框架或部署方式以后想换，引擎和它的全部测试都不用动。

### 2.2 选型清单

| 层 | 选型 | 理由 / 备注 |
|---|---|---|
| 运行时 | Node.js 22 LTS | 官方 Docker 镜像带 full-icu，`Intl` 的时区数据含 1986–1991 中国夏令时（以测试为准） |
| 仓库结构 | npm workspaces：`packages/core`（纯 TS）+ `apps/web`（Next.js） | core 有自己的 tsconfig 和测试，Next 只依赖它的公开 API |
| Web 框架 | Next.js（App Router，`output: 'standalone'`，Route Handlers 全部 `runtime = 'nodejs'`） | 不用 Edge / Serverless（SQLite 本地文件、支付回调需要常驻进程） |
| 样式 | Tailwind CSS，系统字体（不加载网络字体） | 手机优先，同时适配电脑宽屏（内容区限宽居中）；系统字体保证长图截图字形一致 |
| 图表 | 手写 SVG React 组件（五行力量图、大运时间轴、流年趋势线；第 4 张见 4.3.9） | 不引入 ECharts；SVG 在 iOS Safari 和微信内核稳定，截图成长图也最可靠 |
| 哈希（core 内） | `@noble/hashes`（纯 JS、同步 SHA-256） | core 不依赖 Node `crypto`，浏览器和 Node 都能跑；变体选择用它 |
| 数据库 | SQLite（WAL 模式）+ `better-sqlite3` | 见第 5 节 |
| ORM / 迁移 | Drizzle ORM + drizzle-kit | 轻量、类型安全；同一份 schema 可切到 PostgreSQL |
| 校验 | Zod | 表单、API、素材 YAML schema、Chart 输出统一校验 |
| YAML | `yaml` 包（解析成 AST，遇到锚点 / 别名 / 自定义 tag 直接报错） | 素材库规范要求只用 YAML 标准子集；只在构建脚本里用，运行时加载编译好的 JSON |
| 时区 | Luxon（基于 `Intl`） | calendar.md CAL-TZ 要求用 IANA 时区库，不手写 +8 |
| 日志 | pino（JSON 行日志，配置 `redact`） | 第 6.4 节日志策略 |
| 测试 | Vitest（单元 / 属性 / 集成）+ Playwright（iPhone 视口、Android 微信 UA、桌面 Chrome） | 引擎全是纯函数，Vitest 跑得快 |
| 支付 SDK | 支付宝：官方 `alipay-sdk`；微信支付 APIv3：自写签名 / 验签 / 解密（约 200 行，只用 Node `crypto`） | 微信官方 Node SDK 是否存在：未核实；APIv3 规则公开，自写可控 |
| 长图 | modern-screenshot（候选）/ html2canvas（备选） | 两者在微信内核的表现和维护状况**未核实**，由 TASKS 中的预研任务决定 |
| 部署 | Docker Compose（web + caddy + backup），GitHub Actions 构建镜像推到腾讯云容器镜像服务 | 一台机器跑完；Caddy 自动 HTTPS |

**为什么不用 Vercel / 境外 Serverless 做生产**：国内访问不稳定；无法为境外服务器办 ICP 备案，而微信支付要求接入网站完成 ICP 备案 [1]，境外部署会卡住支付。

---

## 3. 排盘库选型

### 3.1 候选比较（数据取自 v0.1 调研，2026-10-27；版本号以安装时为准）

| 库 | 许可证 | 维护情况 | 能力 | 结论 |
|---|---|---|---|---|
| **tyme4ts**（6tail） | MIT | 最新 1.5.4，2026-10-26 仍有提交；GitHub ★519；npm 月下载约 4.3 万 | 公历 / 农历（含闰月）、节气（寿星天文历）、干支四柱、童限（起运）/ 大运 / 流年；子时流派、起运算法均有可替换的 provider | **主库** |
| lunar-javascript（6tail） | MIT | 最新 1.7.7，最后提交 2025-11；★1719；npm 月下载约 13 万；作者新功能转向 tyme | `EightChar.setSect(1/2)`、`getYun(gender, sect)`；使用者多 | **只做测试对照（devDependency）** |
| lunar-typescript | MIT | lunar-javascript 的 TS 版 | 同上 | 不用（重复） |
| 其他 npm 八字包 | 各异 | 多为个人小项目或多年未更新 | 质量未核实 | 不用 |

注：两者同一作者、同一节气算法，**交叉对照只能发现调用 / 移植错误，不能证明天文算法正确**；独立正确性靠 cases.json（v1 已用 sxtwl、PyEphem 独立核对过）和权威节气表抽查。

### 3.2 必须显式设置的 provider（重要）

tyme4ts 官方文档 [14]：

| 设置 | 含义 | 本项目 |
|---|---|---|
| `LunarHour.provider = new DefaultEightCharProvider()` | 23:00–23:59 算次日（= lunar 流派 1，**库默认**） | **不用** |
| `LunarHour.provider = new LunarSect2EightCharProvider()` | 23:00–23:59 算当日（= lunar 流派 2，早晚子时派） | **用** |
| `ChildLimit.provider = new LunarSect2ChildLimitProvider()` | 按分钟差折算起运：3 天 = 1 年、1 天 = 4 个月、1 小时 = 5 天、1 分钟 = 2 小时，精确到时 | **用**（对应 calendar.md CAL-YUN 与 lunar `getYun(gender, 2)`） |
| `DefaultChildLimitProvider` / `China95ChildLimitProvider` / `LunarSect1ChildLimitProvider` | 按秒 / 精确到天 / 按天和时辰 | 不用 |

- provider 是**全局静态属性**：只在 `calendar-adapter.ts` 模块加载时设置一次，其他文件禁止修改（ESLint `no-restricted-syntax` + 测试断言）。
- lunar-javascript 对照时同样**显式** `setSect(2)`、`getYun(gender, 2)`，不依赖默认值（calendar.md 要求）。
- 用 **C05**（1995-03-15 23:30 → 乙巳日戊子时）、C04（00:30 → 乙巳日丙子时）做锁定测试；升级库版本必须先过这两条。

### 3.3 库负责什么、我们自己负责什么

| 项 | 负责方 | 说明 |
|---|---|---|
| 农历 → 公历（含闰月） | tyme4ts | CAL-INPUT |
| 十二节交节时刻（精确到分钟）、年柱、月柱 | tyme4ts | 用**北京标准时间（绝对时刻）**比较，**不用真太阳时**（CAL-YM-2） |
| 本地钟表时间 → UTC（含 1986–1991 夏令时、海外时区） | 我们（Luxon / IANA） | CAL-TZ；夏令时重复时刻取较晚一次并提示，不存在的时刻报错 |
| 真太阳时（经度 × 4 分钟 + NOAA 均时差） | 我们 | CAL-TST；只在选了出生地时校正，输出 `tst_status` |
| 日柱、时柱 | **我们自己算**（60 甲子连续计数 + 五鼠遁），用 CAL-TST 得到的当地时间 | 年月柱用绝对时刻、日时柱用当地时间，库的「一个时刻出四柱」不适用于校正后的情形；无真太阳时校正时与 tyme4ts（Sect2）交叉校验 |
| 早晚子时（CAL-DH-ZI）、A 派日柱 `alt.zi_huanri_day_pillar` | 我们 | 晚子时日柱不换、时干按次日日干起 |
| 起运、大运 8 步 | tyme4ts（Sect2 起运）+ 我们输出周岁 | CAL-YUN；对外一律周岁 |
| 流年 5 年 | 我们（以立春为界，起始年 = 参考日期所在干支年） | 参考日期：免费页 = 当前时间；报告 = **订单创建时间** |
| 藏干比例、十神 | 我们（strength.md S-HIDE 表 + 阴阳规则） | 计分与展示用同一张表，避免口径不一 |
| 三柱模式、交节日无时辰 | 我们 | CAL-NOHOUR；默认 12:00，输出 `uncertain.month_pillar` |
| 旺衰、喜用、吉神、评分 | 规则引擎 | 不用任何库自带的「旺衰 / 用神 / 神煞」功能 |

所有对 tyme4ts 的调用只出现在 `packages/core/src/bazi/calendar-adapter.ts`；依赖锁精确版本（不用 `^`），升级必须跑完全部对照测试。

### 3.4 怎么用 rules/cases.json 验证

1. **loader**：读取 cases.json（v2 字段：`input`、`expected.pillars / dayun / strength / yongshen / shensha_ji / alt_zi_huanri_school / rules_hit_expected`），映射到内部 `BirthInput`；loader 自身有单元测试。
2. **按 `_meta.test_guidance` 的容差逐字段断言**：四柱、大运方向、前三步大运干支、yong / xi / ji、level、special 完全一致；S ±0.001；power / gods ±0.01；`qiyun_date` ±1 天；`rules_hit_expected` 按冒号前编号包含；`shensha_ji` 名称、hits、by、顺序完全一致；23:00–23:59 案例校验 `alt.zi_huanri_day_pillar`。
3. **人工手算数值的处理**：cases.json `_meta.verification_note_v2` 注明 **C05 的旺衰 / 喜用、C18 / C19 新增晚子时扫描结果、全部 19 个案例的 `shensha_ji`** 是 mingli-expert 手算、未经代码复核。引擎实现后若代码与这些值不一致，**不得直接改期望值也不得迁就代码**，输出差异清单交 mingli-expert 裁定（TASKS T21）。
4. **节气边界**：1950–2050 年每个「节」交接前、后 1 分钟自动生成用例，断言月柱（立春含年柱）正好切换。
5. **权威节气抽查**：从香港天文台 / 紫金山天文台公布的节气时刻抽若干年份写成固定数据（文件头注明来源），误差 ≤ 1 分钟。
6. **差分测试**：随机 ≥ 1,000 个时刻（1900–2100，**其中至少 100 个落在 23:00–23:59**），与 lunar-javascript（`setSect(2)`）比对四柱；不一致样例打印出来人工核对。
7. **确定性 + 快照**：同输入两次深度相等；`engineVersion` 不变时快照不变。
8. **规则一致率**：带人工标注的案例，旺衰 / 喜用一致率 ≥ 90%（P0-3），不一致逐条列出；假从案例（C03、C07）不得判为从格。

---

## 4. 模块划分

```
packages/core/                 纯 TS 包：不依赖 Next / React / Node IO（fs、http、crypto 都不用）
  src/bazi/                    ① 排盘引擎（calendar-adapter.ts 是唯一 import tyme4ts 的文件）
  src/rules/                   ② 规则引擎：strength / yongshen / shensha / 评分 / 三柱扫描
  src/texts/                   ③a 素材库运行时：schema、条件求值、字段字典、槽位注册表
  src/report/                  ③b 拼装引擎：ctx → 选段 → 变体 → 占位符 → 术语加注 → 依据 → R-CHECK → (润色接口)
  src/birth/                   ④a 出生信息载荷：规范化、Base64url 编解码（指纹 HMAC 不在这里，见 apps/web）
  src/geo/                     出生地 → 经度 / 时区静态表
  test/                        单元 / 属性 / cases.json 对照测试；test/fixtures/texts/ 是引擎测试专用小素材库
apps/web/                      Next.js 应用（薄层）
  app/                         ⑦ 页面 + Route Handlers
  server/orders/               ⑤ 订单存储与状态机（Drizzle + SQLite）
  server/payment/              ⑥ 支付：wechat-jsapi / wechat-native / alipay-wap / alipay-page / mock
  server/birth-fp.ts           ④b 指纹 HMAC（Node crypto + .env 密钥）
  server/texts-store.ts        加载素材库发布快照（只在服务端）
  server/log.ts                日志（pino + redact）、错误码映射
  texts-releases/              素材库发布快照 v{N}.json（脚本生成、提交进仓库、永久保留；不放 public/）
scripts/                       texts:lint / texts:coverage / texts:batch / texts:preview / texts:release / order:* / stats
rules/                         命理专家维护（代码只读）
```

**core 的边界规则**（ESLint `no-restricted-imports` + 测试检查）：
- core 不得 import `next`、`react`、`node:*`、数据库、支付相关模块；只允许 tyme4ts、luxon、zod、@noble/hashes。
- core 只做纯计算：输入数据 → 输出数据；读文件（rules/ 的 YAML / JSON）由脚本或 apps/web 完成后把数据传进来。
- core 对外公开的 API 只有几个函数：`computeChart(input, refDate)`、`analyze(chart)`、`buildCtx(chart, analysis, refDate)`、`assembleReport(ctx, textsSnapshot, options)`、`buildFreeResult(chart, analysis, freeTemplates)`、`encodeBirth / decodeBirth / canonicalizeBirth`、`lintTexts`、`coverage*`。
- **素材快照只在服务端加载**：`texts-releases/` 不在 `public/`，也不会被任何客户端组件 import（构建后检查客户端 bundle 中不含素材特征串）。

依赖方向：`apps/web → packages/core`；core 内部 `report → rules → bazi`，`report → texts`。

### 4.1 ① 排盘引擎 `core/bazi`（纯函数）

- 输入 `BirthInput`：`{ calendar: 'solar'|'lunar', date, isLeapMonth?, time: 'HH:MM' | null, gender, placeCode: string | null, jieqiChoice: 'before'|'after'|'unsure'|null }`。
- 流水线：CAL-INPUT（农历→公历、非法日期错误码）→ CAL-TZ → CAL-YM（绝对时刻 vs 节气）→ CAL-TST（可选）→ CAL-DH（日时柱、早晚子时）→ CAL-YUN → 流年表（需传入参考日期）→ CAL-NOHOUR。
- 输出 `Chart`（Zod schema，JSON 可序列化）：四柱、藏干、十神、`input_echo`、`clock_to_utc`、`true_solar_time`、`tst_status`、`jieqi_prev / jieqi_next`、`alt.zi_huanri_day_pillar`、`uncertain`、大运、流年、`rules_hit`（CAL 编号）、`engineVersion`。
- 错误一律用错误码（如 `E_LUNAR_NO_LEAP`、`E_DST_GAP`），**错误信息里不带输入值**（避免进日志）。
- 出生地表 `core/geo`：区县级行政区划代码 → 经度（0.01°）+ IANA 时区，另含少量海外城市；数据来源与许可证在 TASKS 中核实后写在文件头。**代码只增不删**（老链接里的地区代码必须永远能解析）。

### 4.2 ② 规则引擎 `core/rules`（纯函数）

- 输入 `Chart`，输出 `Analysis`：`power / power_display_pct / gods / S / de_* / level / special / borderline / confidence / notes`、`yongshen { yong, xi, ji, xian, rules_hit, basis }`、`shensha { jishen, jishen_display }`、大运 / 流年评分与 tier、三柱扫描结果。
- 实现顺序严格按 rules/：S-POWER（含 S-ROOT、S-COMBO）→ S-LEVEL（S-CONG 只认真从、S-ZHUANWANG）→ Y（格局 → 扶抑 → Y-SWAP → 调候 → 通关 → 闲神）→ SS（天乙 / 文昌 / 太极日干、年干兼查，月德按月支，去重）→ R-YUN-SCORE / R-LN-SCORE。三柱时 S-NOHOUR 扫 13 个时柱（早子 + 丑…亥 + 晚子）求置信度，交节日两组年月柱结论不同则置信「低」。
- **吉神与判定解耦**：shensha 输出不进入 strength / yongshen / 评分的任何输入（回归测试：改 shensha 不影响旺衰喜忌，反之亦然）。
- **规则与代码对应**：每条规则一个函数，`ruleId` 与 md 编号相同；测试扫描 rules/*.md 中的 `CAL- / S- / Y- / SS- / R-` 编号，断言每个编号有实现或在「仅文档编号」白名单里，代码里没有 md 不存在的编号。strength.md 里的 JSON 参数块（藏干比例、位置权重）由测试解析后与代码常量比对，防止手抄漂移。
- `rulesVersion` = rules/ 下规则文件内容的 SHA-256 前 8 位，写进报告第 8 章。

### 4.3 ③ 素材库与拼装引擎 `core/texts` + `core/report`

#### 4.3.1 素材格式
完全按 rules/texts/README.md：YAML 条目数组，字段 `id / slot / when / asserts / priority / fallback / requires_hour / length / polish_allowed / quote / variants / status / author / reviewer / updated / notes`。代码侧用 Zod 定义同一 schema。另外三份「代码侧契约」：
- **槽位注册表**：report-sections.md §3 的槽位（id、必需、维度、修饰字段、选几条、字数、依据模板、润色、无时辰处理、拼装顺序）写成 `core/report/slots.ts`；测试解析 md 中以 `| CH` 开头的表格行，与注册表逐个比对。
- **字段字典**：texts/README.md §3 的字段（类型、取值域）写成 `core/texts/fields.ts`，lint 和覆盖率穷举都用它。
- **代码模板**（不走素材）：CH2-SUMMARY、CH3-PERSONA-LINE（R-PERSONA）、CH4-TABLE（yongshen.md §7）、第 0 章命盘表与吉神小表、三柱缺失说明、「未校正真太阳时」灰字、置信「低」的「另一种可能」句。

#### 4.3.2 ctx 构造（R-CTX）
`buildCtx(chart, analysis, refDate)` 生成 report-sections.md §0 的 ctx：百分比四舍五入取整、`direction / paradox / tier_group / stem_role / branch_role`、`ten_gods.persona`（§6 选取顺序，三柱不取时柱）、`career.mode`、`partner.role / pct`、原局冲合 `relations`、`shensha_first`、`chart_key`（四柱 + 性别 + 是否有时辰）。ctx 是拼装引擎的**唯一输入**，不含任何自由文本、不含出生日期。

#### 4.3.3 条件树求值
- 语法：`all / any / not` 组合子 + 叶子运算符 `eq ne in not_in contains not_contains gte gt lte lt exists`；深度 ≤ 3；**不 eval 字符串**。
- 空值语义：字段为 null 时除 `exists:false` 外一律为假（含 `ne / not_in`）。三柱降级就靠这个实现，引擎里不写三柱特殊分支。
- 特异度 = 叶子条件个数（用于排序）。

#### 4.3.4 选取与兜底（texts/README.md §5.1）
```
候选 = 槽位全部条目
     → status ∈ 允许集合（生产：approved；开发/测试：由 TEXTS_ALLOWED_STATUS 配置）
     → when 且 asserts 成立 → requires_hour 过滤 → 占位符全部可解析
排序 = priority 降序 → 特异度降序 → id 升序；取前 k 条
候选为空 → 用该槽位唯一的 fallback 条目，并返回事件 fallback_used{slot}（由 apps/web 记日志，不记 chart_key）
```
必需槽位没有兜底条目 = 启动期错误（进程拒绝启动）。

#### 4.3.5 变体确定性选择（texts/README.md §5.2）
`idx = BigEndianUint64(SHA-256(chart_key + "|" + entry_id + "|" + occurrence)[0..8]) mod 变体数`（SHA-256 用 @noble/hashes）。不含订单号、支付信息、生成时间；`occurrence` 是同一条目在本份报告中第几次被选中，循环槽位重复命中时自动换下一个变体。

#### 4.3.6 拼装步骤
按章节、槽位顺序：选段 → 选变体 → 占位符替换（`|名` 过滤器、列表用「、」连接、百分比整数）→ 全报告术语**首次出现**按 glossary 加注（不进表格、卡片标题、古籍原文、引号）→ 追加槽位依据模板「依据：……」→ 有 quote 的条目原文单独成行（一章最多 1 句、全报告最多 5 句）→ R-CHECK → （润色，默认关）。
输出结构化 JSON（不是 HTML）：`{ meta: { textsVersion, rulesVersion, engineVersion, tstStatus, refDate }, chapters: [{ id, title, blocks: [ para{text, basis, quote?} | table | chart{kind, data} | yearCard{...} | notice ] }], events: [...] }`。图表与卡片的年份、干支、分数全部直接取自 Chart / Analysis，前端只负责渲染。

#### 4.3.7 R-CHECK 成品检查
正文中 `\d{4}年` 与干支 ⊆ ctx 出现过的集合；「有利 / 用 / 喜 + 五行」「节制 / 忌 + 五行」不与 yongshen 冲突；各章与全文字数（5,000–8,000，三柱 4,800–8,000）；第 1–3、7 章每段有依据、第 6 章每卡有十神和 tier；禁用词 / 疾病名 / 金融产品词零命中；同报告任两段 4-gram 相似度 ≤ 0.5。**生产环境不通过 → 报告仍返回（避免已付款用户看不到），但记 `rcheck_failed{rule, slot}` 告警日志**；测试环境不通过 → 测试失败。（用户 2026-10-29 已确认：告警放行。素材已全部通过 lint 和覆盖率测试，成品检查是回归保险。）

#### 4.3.8 素材 lint（L1–L12）、覆盖率、批次、发布

| 工具 | 命令 | 内容 |
|---|---|---|
| lint | `npm run texts:lint` | texts/README.md §7 的 L1–L12 全部实现：schema / id / slot（L1）、when 字段范围与维度限制（L2）、占位符字段（L3）、禁用词 + 疾病名 + 金融产品词（L4，词表在 `rules/texts/wordlists/`）、无 4 位年份 & 干支字面需 asserts 锁定（L5）、五行喜忌共现需 asserts（L6）、时柱用语需 `requires_hour`（L7）、字数与变体数（L8）、无「依据：」& 术语后不紧跟全角括号（L9）、4-gram Jaccard ≤ 0.6（L10）、approved 的 reviewer / quote.verified / edition（L11）、绝对化用语与人称（L12） |
| 静态覆盖率 | `npm run texts:coverage` | 对每个必需槽位穷举维度取值组合（修饰字段取默认值），每个组合至少命中 1 条非兜底条目；不可能出现的组合在注册表中显式声明并写理由（由 mingli-expert 认可）；输出缺口清单 |
| 动态覆盖率 | 同上 `--dynamic` | cases.json 全部案例 + 随机 10,000 个出生时刻（1940–2030，男女各半，10% 无时辰）+「有时辰案例去掉时柱」跑完整拼装：必需槽位兜底命中 = 0；字数在范围内比例 ≥ 99%；R-CHECK 全过；**when 成立而 asserts 不成立的组合报为素材缺陷**；输出各案例字数分布（P0-7 要求列入测试报告） |
| 批次抽检 | `npm run texts:batch -- sample|approve|reject B1` | 读写 `rules/texts/batches.yaml`；抽样 = 本批 10% 向上取整、至少 5 条，种子 = 批次号 + 轮次（可复现）；重抽时换样本且必含上次不通过的条目；生成抽检单（被抽条目全部变体 + 能触发它的 cases.json 案例 + 本批覆盖率表 + lint 结果）；approve 批量改 `status: approved`、`reviewer: 用户（批次号、日期）`；reject 整批退回 draft |
| 预览 | `npm run texts:preview` | 用 cases.json 全部案例生成完整报告 HTML（本地文件，供成品通读；允许 reviewed / draft） |
| 发布 | `npm run texts:release` | 只收 approved 条目；要求 lint 全过、静态 + 动态覆盖率 100%；`texts_version` + 1；编译成 `apps/web/texts-releases/v{N}.json` 提交进仓库，并打 git tag `texts-v{N}` |

`batches.yaml` 格式（建议，写入前与 mingli-expert 对齐）：
```yaml
- batch: B1
  scope: [CH1, CH2, CH6]
  entries: [CH1-DAYMASTER-YI, ...]
  submitted: 2026-11-xx
  rounds:
    - round: 1
      seed: B1-r1
      sample: [CH1-..., ...]
      result: pass | fail
      comments: {CH1-...: "意见"}
      date: 2026-11-xx
  status: drafting | submitted | approved | rejected
```

**素材库版本与重看**：订单记录 `texts_version`。服务器启动时加载 `texts-releases/` 下**所有**发布快照（每个约 1～2 MB，常驻内存）；报告页按订单上的版本拼装，参考日期取订单创建时间，因此重看文字与首次一致。approved 条目只允许追加变体、不改不删（texts/README.md §5.2），发布脚本对比上一快照自动检查。
**不冻结的部分**：排盘 / 规则代码的修正（bug fix）会作用于所有报告，这是有意的——算错了应该改对。改动规则参数时按 rules/README.md 重跑 cases.json 并记录结论变化。

**开发期策略**：引擎单元测试只用 `packages/core/test/fixtures/texts/`（含 rules/texts 的 10 条样板），不依赖正式素材进度；正式素材的覆盖率测试在 CI 中按批次逐步「转为强制」：已批准批次涉及的章节缺口 = 失败，未批准章节只输出缺口清单。**上线前提：三批全部 approved、古籍引用全部 verified、`texts:release` 成功。**

#### 4.3.9 第 4 张图（四领域评分条）
report-sections.md 标为「可选」，但没有给出四领域的评分口径。MVP 先做 3 张图（满足 PRD「3～4 张」，用户 2026-10-29 已确认）；若 mingli-expert 在 rules/ 补充评分规则，再加一个任务实现。

#### 4.3.10 大模型润色接口（R-POLISH，默认关闭，MVP 不实现调用）
- core 中定义 `interface Polisher { polish(segment: { text, lockedTerms[] }): Promise<string> }`，MVP 只有 `NoopPolisher`（原样返回）。
- 配置 `REPORT_POLISH_ENABLED=false`（默认）；为 true 但没有真实实现时启动报错，防止误开。
- 约定（来自 report-sections.md §9 / texts/README.md §10，留给 P1 实现）：只送「润色 = 可」的槽位段落；quote、结论段、表格、卡片字段、do / watch、健康、吉神、免责声明不送；只传单段文字 + 锁定词清单，不传 ctx 和出生信息；锁定词多重集合前后相等、字数变化 ±15%、R-CHECK 全过，否则丢弃；按（chart_key、条目 id、变体序号、texts_version）缓存；单段 3 秒、全报告 20 秒超时用原文。
- 测试：关闭状态下拼装全过程**零外部网络调用**（测试中把 `fetch` / `http` 替换成抛错桩）。
- 启用前需重新评估：成本、生成式 AI 登记、AI 生成内容标识、「同输入同报告」承诺（PRD P1）。

### 4.4 ④ 出生信息载荷与指纹

- **载荷**（v1，紧凑 JSON，键顺序固定；`core/birth`）：
  `{"v":1,"c":"s","d":"1994-01-09","lp":0,"t":"14:30","g":"f","p":"110105","j":null}`
  `c` 公历 s / 农历 l；`lp` 闰月；`t` 为 null 表示不知道时辰；`p` 出生地代码或 null；`j` 交节日无时辰时用户的选择（before / after / unsure / null）。
- **编码**：UTF-8 → Base64url（无填充），约 100 字符。**只编码不加密**（PRD Q11，用户已确认风险）。
- **规范化**：服务端解析后用 Zod 校验，再按固定键序重新序列化得到 canonical 串；指纹和后续计算都基于 canonical 串，同义的不同写法得到同一指纹。
- **指纹**（`apps/web/server/birth-fp.ts`）：`birth_fp = HMAC-SHA256(BIRTH_FP_KEY, "v1|" + canonical)`，hex 存库；同时存 `fp_key_id` 以便将来轮换密钥。密钥只在 `.env`。因为是带密钥的 HMAC，数据库单独泄露时无法靠穷举出生日期反推（出生信息空间只有约百万量级，普通哈希可被穷举，所以必须加密钥）。比较用 `crypto.timingSafeEqual`。

### 4.5 ⑤ 订单 `apps/web/server/orders`

- 订单号 = `crypto.randomBytes(16)`（128 位）→ base62，约 22 字符；**同时作为发给支付渠道的商户订单号**（微信要求 6–32 位字母数字，支付宝 ≤ 64 位），这样 P1「链接找回」时用户在账单里看到的商户订单号就是它。
- 状态机（集中校验）：`created → paid`、`created → closed`（30 分钟未付）、`paid → refunded`（人工退款后标记）。回调与查单按订单号幂等，金额必须等于服务端写死的 990 分。
- 退款：MVP 不写退款接口。运营在微信商户平台 / 支付宝后台人工退款，再执行 `npm run order:refund -- <订单号> "<原因>"` 标记并记录原因（PRD 5.4）。退款后报告链接失效（用户 2026-10-29 已确认）。
- 后台任务（进程内定时器，每 5 分钟）：关闭 30 分钟未付订单（调渠道关单）；删除 7 天前的未付 / 已关闭订单（数据最小化）。已付款订单长期保留（报告链接靠它校验，也是财务记录）。

### 4.6 ⑥ 支付 `apps/web/server/payment`
接口：`createPayment(order, ctx) → 前端调起参数`、`verifyNotify(req) → PaidEvent`、`queryOrder(orderNo)`、`closeOrder(orderNo)`。实现：`wechat-jsapi`、`wechat-native`、`alipay-wap`、`alipay-page`、`mock`（开发 / 测试用，模拟支付页和回调）。商品描述固定为「八字命盘报告」；**不使用 attach / passback_params 等附加字段**，出生信息永远不发给支付渠道。渠道选择见第 8 节。

### 4.7 ⑦ 前端 `apps/web/app`

| 路径 | 说明 |
|---|---|
| `/` | 首页表单（UI 以 docs/UI.md 为准）；手机优先，电脑端内容区限宽居中 |
| `/result#<载荷>` | 免费结果页：前端从片段取载荷，POST `/api/chart` |
| `/pay/done?o=<订单号>` | 支付返回页（支付宝 return_url），从 localStorage 取回载荷，轮询订单状态后跳报告页 |
| `/r/<订单号>#<载荷>` | 报告页（静态外壳，前端取片段后 POST `/api/report`） |
| `/privacy`、`/disclaimer` | 隐私说明、免责声明 |

### 4.8 后端 API（保持最小）

| API | 方法 | 说明 |
|---|---|---|
| `/api/chart` | POST | body 带载荷 → 免费结果 JSON（不落库） |
| `/api/orders` | POST | body 带载荷 + 渠道 → 建单 → 返回订单号与调起参数（签名在服务端） |
| `/api/orders/<订单号>/status` | GET | 只返回状态；10 秒内未收到回调则服务端主动查单 |
| `/api/pay/notify/<渠道>` | POST | 支付回调：验签 → 解密 → 校验金额 → 幂等置 paid |
| `/api/wx/oauth` | GET | 微信 `snsapi_base` 静默授权回调，换 openid 后写入短期签名 Cookie（不入库），跳回原页 |
| `/api/report` | POST | body `{orderNo, payload}` → 校验订单与指纹 → 服务端拼装报告 JSON |
| `/api/health` | GET | 健康检查 |

除此之外没有任何后端功能（无登录、无账号、无后台管理页面；运营操作用命令行脚本）。

### 4.9 免费结果：前端算还是后端算

| | 前端算（core 打包进浏览器） | 后端算（推荐） |
|---|---|---|
| 隐私 | 免费页出生信息完全不离开设备 | 出生信息经 POST 到服务器但不落库、不进日志（已有保证措施，见 6.4） |
| 与付费报告的一致性 | 浏览器可能缓存旧版 JS，旧引擎算出的旺衰 / 喜忌与服务端报告不一致 → 「免费说喜火、付费说喜木」的投诉 | 免费和付费用同一进程、同一版本的代码，必然一致（PRD 第 8 节「同一输入的免费结果和付费报告完全一致」） |
| 页面体积 | 要下发 tyme4ts + 规则引擎 + 地区表（体积未实测，估计数百 KB），弱网 H5 首屏变慢 | 页面只有表单和渲染代码 |
| 速度 | 无网络往返 | 一次请求，服务端计算 < 100 ms，满足 1 秒 |
| 规则暴露 | 规则引擎代码被下载（规则本身不算机密，但取用逻辑可被直接拿走） | 不暴露 |
| 服务器负载 | 0 | 纯计算，2C2G 足够 |

**结论：后端算**。一致性是硬要求，后端算从结构上保证；隐私方面已有「不落库、不进日志」措施。因为 core 是纯 TS 包，以后若想改成前端算（例如为了「出生信息不出设备」做宣传），只需在前端调用同一个包，并加版本号校验。付费报告和下单时的排盘**永远在服务端**（素材库只在服务端；下单时要算指纹）。

---

## 5. 数据模型与数据库选型

### 5.1 表结构（唯一一张业务表）

```ts
// Drizzle (SQLite)；时间一律 Unix 毫秒
orders = sqliteTable('orders', {
  orderNo:       text('order_no').primaryKey(),        // 128 位随机，base62；也是商户订单号
  amountFen:     integer('amount_fen').notNull(),      // 990，服务端写死
  status:        text('status').notNull(),             // created | paid | closed | refunded
  birthFp:       text('birth_fp').notNull(),           // HMAC-SHA256(BIRTH_FP_KEY, canonical) hex
  fpKeyId:       text('fp_key_id').notNull(),          // 指纹密钥版本
  textsVersion:  integer('texts_version').notNull(),   // 素材库发布版本，重看时用同版本拼装
  channel:       text('channel'),                      // wechat_jsapi | wechat_native | alipay_wap | alipay_page | mock
  channelTxnId:  text('channel_txn_id'),               // 渠道交易流水号（对账、人工退款用）
  createdAt:     integer('created_at').notNull(),      // 也是报告的参考日期（流年起始年、当前大运）
  paidAt:        integer('paid_at'),
  closedAt:      integer('closed_at'),
  refundedAt:    integer('refunded_at'),
  refundReason:  text('refund_reason'),                // 运营填写，规定不得写入出生信息
}, t => ({ byStatusCreated: index('idx_status_created').on(t.status, t.createdAt) }));
```

- PRD 要求的字段：订单号、金额、状态、时间、指纹；rules/ 要求的 `texts_version`；其余三项（渠道、流水号、退款原因）是支付与售后必需的字段，**不含出生信息和报告内容**。
- **不存**：出生日期 / 时间 / 性别 / 出生地（任何形式，含编码形式）、四柱、chart_key、报告正文、微信 openid、IP。
- 「表结构评审」自动化：测试读取实际 schema，断言列名集合等于上面的白名单，新增列必须同时改测试（并说明理由）。

### 5.2 数据库选型：SQLite（推荐）vs 腾讯云托管 PostgreSQL

| 维度 | SQLite 单文件 + 定时备份（推荐） | 腾讯云托管 PostgreSQL | 同机 Docker PostgreSQL |
|---|---|---|---|
| 数据量匹配 | 每单约 200 字节；日 1,000 单一年约 70 MB，远在能力范围内 | 能力严重过剩 | 过剩 |
| 并发 | 写操作只有「建单」「置 paid」，WAL 模式下单进程毫秒级 | 无压力 | 无压力 |
| 月费 | **¥0**（备份到 COS 每月几毛到几元，未核实） | **未核实**；参考：天翼云 PostgreSQL 主备 1 核 2 GB 2021 年标价 ¥210/月 [16]，腾讯云同档量级应在每月百元以上 | ¥0 |
| 运维 | 无服务；备份脚本 + 恢复演练 | 免运维、自动备份、高可用 | 升级、备份、调优都要自己管 |
| 主要风险 | 单机磁盘损坏 → 用 COS 备份恢复，最多丢失最近一个备份间隔的订单 | 价格；多一个云资源 | 运维负担，无实际好处 |
| 扩展 | 要多实例时换 PostgreSQL：Drizzle schema 基本不变，只有一张表，迁移成本低 | — | — |

**推荐 SQLite**：本项目没有队列、没有报告存储，数据库只剩一张小订单表，托管数据库的好处（高可用、免运维）对一个人的小站不值每月百元级的固定成本。
**备份方案**：
- backup 容器每 10 分钟用 SQLite 在线备份 API（`better-sqlite3` 的 `.backup()`）生成快照 → gzip → 上传腾讯云 COS（S3 兼容接口），保留 30 天；每日额外保留一份长期快照。
- 可选：Litestream 持续复制（秒级 RPO）。它对腾讯云 COS 的兼容性**未核实**，预研通过再用。
- 轻量服务器系统盘快照作第二道保险（免费额度未核实）。
- 每月一次恢复演练（脚本化）。
**数据丢失的兜底**（极端情况）：已付款用户的链接无法校验时，运营可根据商户平台账单（商户订单号 = 订单号、金额、支付时间）手工补建订单行，`birth_fp` 置为「首次提交时绑定」状态（用户下次打开链接时写入指纹）。该流程只用于灾备，需人工执行。

---

## 6. 关键流程

### 6.1 免费结果
```
首页填表 → 前端生成载荷 → 跳到 /result#<载荷>（片段不发给服务器）
  → 前端 POST /api/chart {payload}
  → 服务端：解析校验 → 排盘 → 规则 → free.yaml 模板 → 返回 4 个模块的数据（不落库）
  → 页面渲染；刷新页面仍可从片段重新请求
```
交节日无时辰：返回交节提示，用户选「之前 / 之后 / 不确定」后更新载荷中的 `j` 字段并重新请求。

### 6.2 下单与支付
```
点「¥9.9 查看完整报告」
  ├ 微信内：若无 openid Cookie → 先把载荷写入 localStorage → 跳 snsapi_base 静默授权
  │         （redirect_uri / state 中不放出生信息）→ /api/wx/oauth 换 openid → 写短期签名 Cookie → 跳回结果页
  → POST /api/orders {payload, channel}
     服务端：规范化 → 排盘（验证输入合法）→ 计算 birth_fp → 建单(created, 990, texts_version=当前发布版)
     → 调渠道下单（服务端签名）→ 返回 {orderNo, payParams}
  → 前端：localStorage['pending:'+orderNo] = 载荷（只在用户设备上）
  → 微信 JSAPI：WeixinJSBridge 调起；支付宝 WAP：表单跳转，return_url = /pay/done?o=<订单号>；
    电脑：微信 Native 显示二维码 / 支付宝电脑网站支付跳转
  → 渠道回调 /api/pay/notify/<渠道>：验签 → 金额 = 990 → 幂等置 paid
  → 前端轮询 status（服务端 10 秒未收到回调则主动查单）→ paid
  → 跳到 /r/<订单号>#<载荷>，清除 localStorage 中的 pending 记录
```

### 6.3 打开 / 重看报告
```
/r/<订单号>#<载荷>（服务器只收到 /r/<订单号>，返回静态外壳）
  → 前端读取 location.hash → POST /api/report {orderNo, payload}
  → 服务端：
     ① 按订单号限流（同一订单号每小时校验失败 ≥ 20 次即临时锁定）
     ② 查订单：不存在 / 未付款 / 已退款 → 统一「链接无效或订单未支付」（不区分原因）
     ③ HMAC(载荷) 与 birth_fp 做 timingSafeEqual：不匹配 → 同上
     ④ 排盘 + 规则（参考日期 = 订单创建时间）→ 按订单 texts_version 选素材快照拼装 → R-CHECK
     ⑤ 返回报告 JSON（Cache-Control: no-store）
  → 前端渲染章节、图表、逐年卡片；顶部常驻两条提示：
     「链接丢失无法找回，请收藏本页或保存为长图」「链接含出生信息（仅编码、未加密），请勿公开分享」
```
关掉浏览器、换浏览器、换设备打开都可以（不依赖 Cookie / localStorage）。篡改载荷 → 指纹不匹配 → 拒绝。

### 6.4 日志里为什么不会出现出生信息

出生信息只会出现在三个地方：① URL 片段（`#` 之后，浏览器**不会**把片段发给服务器，也不会放进 Referer）；② POST 请求体（`/api/chart`、`/api/orders`、`/api/report`）；③ 用户设备的 localStorage。保证措施：

| 位置 | 措施 |
|---|---|
| URL | 出生信息**永远不进路径和查询串**；微信授权的 redirect_uri / state、支付宝 return_url、支付渠道下单参数都不带出生信息（代码评审 + 测试断言） |
| Caddy 访问日志 | 只记时间、方法、路径、状态码、耗时、字节数；**不记请求体**，不记 Referer 和 User-Agent |
| 应用日志（pino） | 全局禁止记录请求体；`redact` 兜底屏蔽 `payload / birth / b` 等键；Zod 校验错误先映射成错误码再记录（**Zod 默认错误信息会带上收到的值，这是最容易漏的地方**）；排盘 / 规则抛出的错误只含错误码；`fallback_used` / `rcheck_failed` 只记槽位 id 和版本号，不记 chart_key 或四柱 |
| Next.js 自身 | 生产模式不打印请求日志；未捕获异常由统一错误处理器记录（只记错误码与堆栈，不记请求） |
| 支付回调日志 | 只记订单号、渠道流水号、金额、状态；渠道报文中本来就没有出生信息（下单时没发） |
| 前端 | **全站不引入任何第三方脚本**（统计、广告、客服插件都不加——它们通常会上报含片段的完整 URL）；CSP `script-src 'self'`、`connect-src 'self'` 强制执行；`Referrer-Policy: no-referrer`；`/r/*` 加 `X-Robots-Tag: noindex` |
| 自动化验证 | 「哨兵」测试：用特征明显的出生信息（如 1987-06-15 13:47、某个地区代码）跑完免费、下单、mock 支付、打开报告、篡改链接、非法输入全流程，收集应用 stdout / stderr 与 Caddy 日志，搜索日期的多种写法（`1987-06-15`、`19870615`、`1987/6/15`、`13:47`）、载荷 Base64url 全串及其任意 16 字符子串、canonical 串，命中即失败。上线前 QA 再用真实请求抽查（P0-10 验收） |

---

## 7. 隐私

- **收集最少**：出生日期时间（可不填时辰）、性别、可选出生地；不收姓名、手机号，不登录。
- **不落库**：免费结果和报告都是每次现算；数据库只有第 5 节的订单字段。
- **链接中的出生信息**：Base64url 只是编码，任何人拿到链接都能解出出生日期。如实告知：报告页顶部提示「链接含出生信息，请勿公开分享」，隐私说明页写明「链接中的出生信息仅编码、未加密」。降低风险的措施：放在片段里（不进服务器日志）、无第三方脚本、no-referrer、noindex。
- **指纹**：带服务器密钥的 HMAC，仅用于核对「链接里的出生信息是否就是下单时那份」。
- **openid**：只存在用户浏览器的短期签名 Cookie 里，用于微信 JSAPI 下单，不入库。
- **保存期限**：未付 / 已关闭订单 7 天后删除；已付款订单长期保留（报告链接依赖它；也是财务记录）。
- **隐私说明页**写明：收集什么、用途（只用于现算命盘和报告）、服务器保存哪些字段（逐项列出第 5 节字段）、交给谁（支付渠道：只有订单号和金额）、链接的风险、联系方式。
- **数据不出境**：服务器在国内，无任何境外服务调用。

---

## 8. 支付方案

### 8.1 渠道比较（个体工商户）

| 渠道 / 产品 | 个体户能否开 | 关键条件 | 费率 | 来源 |
|---|---|---|---|---|
| 微信支付 · JSAPI（微信内置浏览器） | 可以（PC 网站接入指引单列了个体户材料） | 营业执照、经营者身份证、对公账户或经营者个人账户；**网站域名须完成 ICP 备案**；需绑定**已认证的服务号**获取 openid；审核 1～2 个工作日 | 官方说明「交易服务费通常为 0.6%～1%，取决于经营类目」 | [1][2] |
| 微信支付 · Native（电脑扫码） | 可以 | 同上 | 同上 | [1] |
| 微信支付 · H5 支付（微信外手机浏览器） | 官方开通条件列出的主体为企业、事业单位、政府机关、社会组织，**未列个体户 → 大概率不能开（未核实，需咨询）**；且 H5 不能在微信内使用 | 已认证服务号 / 小程序 / App | — | [3] |
| 支付宝 · 手机网站支付 / 电脑网站支付 | 可以（第三方资料称个体户有营业执照即可，官方原文未核实） | 实名商家账号 + 营业执照；网站需备案 | 0.6%（第三方资料，官方费率未核实） | [4][5] |
| 支付宝在微信内 | **不可用**（微信内屏蔽支付宝跳转，业内共识，官方说明未核实） | 引导「在浏览器打开」 | — | — |
| 持牌聚合支付（拉卡拉、汇付天下、易宝等或其服务商） | 一般支持个体户 | 条件、费率、是否接受该类目：**未核实** | 未核实 | — |
| 「个人免签」类收款（非持牌） | — | **不采用**：「二清」合规风险、资金冻结风险 | — | — |

费率优惠：有报道称财付通对小微经营主体手续费 9 折优惠延续至 2027-09-30，是否适用：未核实 [6]。

### 8.2 推荐与环境匹配

- 个体户同时开通**微信支付商户号（JSAPI + Native）**和**支付宝（手机网站支付 + 电脑网站支付）**，并注册、认证**微信服务号**（JSAPI 获取 openid、配置网页授权域名）。
- 每单手续费：¥9.9 × 0.6% ≈ ¥0.06；按 1% ≈ ¥0.10。

| 用户环境 | 支付方式 |
|---|---|
| 微信内置浏览器（主要流量） | 微信 JSAPI（`snsapi_base` 静默授权，用户无感、不需登录） |
| iOS Safari / 安卓浏览器 | 支付宝手机网站支付；微信：若个体户能开 H5 支付再加，否则提示「复制链接到微信打开」 |
| 电脑浏览器 | 微信 Native 扫码 + 支付宝电脑网站支付 |

只开下来一家也可以上线：只有微信 → 微信外用户引导到微信打开（电脑端可扫 Native 码）；只有支付宝 → 微信内引导「在浏览器打开」。

### 8.3 「算命 / 占卜」类目风险（PRD 9.2，未核实）
没有找到微信支付、支付宝或 ICP 备案明确允许 / 禁止此类目的官方条文，**必须在开发真实支付前由你咨询**。应对：
1. 全站定位「传统文化参考 / 娱乐」，页面不出现「算命、改运、化解、消灾、开运物品」；申报类目时**如实描述业务**（隐瞒可能导致冻结资金），向客服确认适用类目（如「传统文化 / 性格分析」）。
2. 备选：只开一家；咨询持牌聚合支付服务商；都不通过则需重新评估产品形态（不在本次范围）。
3. 代码上支付层可插拔，换渠道只新增一个实现。

### 8.4 你需要办的支付手续
1. **个体工商户营业执照**（经营范围建议含「信息技术咨询服务 / 文化咨询」等，以当地市场监管部门为准）。
2. 对公账户（可选；个体户可用经营者个人银行卡结算）。
3. **微信服务号**（主体选个体工商户）并完成**微信认证**（第三方资料称 ¥300/年，未核实官方现价）。
4. **微信支付商户号**：开通 JSAPI、Native；咨询 H5 是否对个体户开放；配置 JSAPI 授权目录、APIv3 密钥、商户证书；与服务号 AppID 绑定。
5. **支付宝开放平台**商家账号：签约手机网站支付、电脑网站支付，创建应用、配置密钥（开发期先用支付宝沙箱，不需要这一步）。
6. 第 3～5 步需要**已备案域名**和可访问的网站，所以在 ICP 备案下来、网站有基本页面后提交。
7. 向两家确认「八字 / 传统文化分析」的可用类目和费率。

---

## 9. 部署方案

### 9.1 推荐：腾讯云轻量应用服务器（国内地域）+ ICP 备案
- 规格：**2 核 2 GB 入门型**（¥45/月，年付 ¥459，40 GB SSD，200 GB/月流量）或基础型（¥50/月，年付 ¥510）[12]。没有 worker 和大模型等待，镜像在 CI 构建而不是在服务器上构建，2C2G 足够；流量大了再升 2C4G（¥100/月）。
- docker-compose：
  - `web`：Next.js standalone，单进程；SQLite 文件挂载宿主机卷 `/data/app.db`；启动时校验所有素材快照（必需槽位有兜底、生产只含 approved）、校验 `.env` 必填项；
  - `caddy`：反向代理 + 自动 HTTPS，按第 6.4 节配置日志格式；
  - `backup`：定时 SQLite 在线备份 → 上传 COS。
- CI/CD：GitHub Actions 跑 lint / typecheck / 全部测试（含覆盖率门禁）→ 构建镜像 → 推送腾讯云容器镜像服务 → SSH `docker compose pull && up -d`。细节由 devops 写进 docs/DEPLOY.md。
- 监控：结构化日志 + 运维脚本（每日订单数、支付成功数、免费排盘次数（从访问日志统计）、`fallback_used` / `rcheck_failed` 次数）；异常推送企业微信群机器人。境外 SaaS（如 Sentry）国内可达性未核实，不依赖。

### 9.2 备选与不推荐
| 方案 | 评价 |
|---|---|
| 阿里云 ECS / 轻量 | 与推荐方案等价，按你已有账号决定 |
| 香港服务器（免备案） | 微信支付要求接入网站完成 ICP 备案 [1]，香港服务器无法办国内备案 → 支付走不通 |
| Vercel / 境外 Serverless | 国内访问不稳定、不能备案；只可作开发预览 |

### 9.3 云函数 / Serverless vs 轻量服务器

| 维度 | 轻量应用服务器 + Docker（推荐） | 云函数 / Serverless（腾讯云开发 CloudBase、云函数 SCF 等） |
|---|---|---|
| 固定月费 | ¥45～¥50 | 低流量时可能更低（有免费额度或低价套餐，**具体额度与价格未核实**） |
| 冷启动 | 无，常驻进程 | 有冷启动；Node + tyme4ts + 素材快照（数 MB）加载可能需要数百毫秒到秒级（**未实测**），有拖慢「1 秒出结果」的风险，需付费的预置并发才能消除 |
| 数据库 | SQLite 本地文件，零成本 | **不能用 SQLite**（无持久磁盘、多实例并发），要换云数据库（CloudBase 文档型数据库或托管 MySQL / PG），多一套 API 和计费 |
| 素材快照常驻内存 | 进程启动加载一次 | 每个冷启动实例都要重新加载 |
| Next.js 部署 | standalone + Docker，成熟 | Next.js 在国内云函数上的部署链路复杂、文档少（未核实），通常要拆成「静态前端 + 函数 API」 |
| 支付回调 / 定时任务 | 进程内处理、进程内定时器 | 可以做（HTTP 触发 + 定时触发器），但要分别配置 |
| 日志控制 | 自己配置 Caddy 和应用日志，能保证不含出生信息 | 平台网关会自动记录请求日志，**是否会记录请求体、能否关闭需核实**，增加 P0-10 验证难度 |
| ICP 备案 | 需要 | 同样需要（域名绑定国内资源都要备案） |
| 运维 | 偶尔升级系统、Docker；备份脚本 | 几乎免运维 |
| 可移植性 | Docker 镜像到哪都能跑 | 和平台绑定 |

**推荐轻量服务器**：本项目的硬指标（1 秒出结果、日志不含出生信息、只存一张小表）都更适合常驻进程 + 本地 SQLite；每月 ¥45～¥50 的固定成本很低，换来的是可控、无冷启动、可移植。云函数的省钱优势在本项目里不明显，反而要多引入一个云数据库。若以后流量极低想进一步省钱，因为 core 是纯 TS 包，迁到云函数只需重写 apps/web 的那几个 API。

---

## 10. 合规手续（你需要办）

1. **域名**（需实名）：网站改名定下后再买（PRD 9.3）。
2. **ICP 备案**：主体用个体工商户（与支付主体一致更顺），在腾讯云备案系统提交；网站名称、内容描述**如实填写**，用「传统文化 / 性格分析类资讯」等表述（此类内容能否备案：未核实，先咨询备案客服）。备案期间网站不能对外访问。
3. **公安联网备案**：ICP 备案下来后 30 日内，页面底部挂备案号。
4. **经营性 ICP 许可证**：在线收费提供信息服务是否需要办增值电信业务经营许可证：未核实，建议咨询备案服务商 / 当地通信管理局。
5. **生成式 AI 服务登记 / 备案**：v0.2 运行时**不调用大模型**，面向用户的文字全部来自人工审核的素材库，**大概率不适用**；也不需要《人工智能生成合成内容标识办法》[11] 要求的 AI 生成标识。建议咨询备案服务商时顺带确认一句。若 P1 启用润色，需重新评估。
6. **个人信息保护**：虽不存出生日期，但指纹和链接中的出生信息仍属个人信息处理，需要隐私说明（第 7 节）；是否需要额外手续建议一并咨询。

（小程序暂不考虑；若以后要做，小程序平台对占卜类内容的类目限制和小程序备案需另行评估。）

---

## 11. 每月成本估算

| 项 | 金额 | 备注 |
|---|---|---|
| 轻量服务器 2C2G | ¥45～¥50/月（年付 ¥459～¥510） | [12] |
| 数据库 | ¥0 | SQLite，同机 |
| COS 备份存储 | 约 ¥0～¥2/月（未核实） | 数据库小于 100 MB，30 天快照 |
| 微信服务号认证 | ≈ ¥25/月（¥300/年，未核实） | JSAPI 必需 |
| 域名 | 约 ¥5/月（按年付，后缀不同差异大，未核实） | |
| SSL / ICP 备案 | ¥0 | Let's Encrypt；备案不收费 |
| 大模型 | **¥0** | 运行时不调用 |
| **固定合计** | **约 ¥75～¥85/月** | |
| 支付手续费 | ¥0.06～¥0.10/单 | 0.6%～1% |

| 场景 | 月订单 | 收入 | 固定成本 | 手续费 | 估算毛利（未计退款、税费） |
|---|---|---|---|---|---|
| 冷启动 | 100 | ¥990 | ≈ ¥80 | ¥6～¥10 | ≈ ¥900 |
| 有起色 | 1,000 | ¥9,900 | ≈ ¥80（或升 2C4G ≈ ¥135） | ¥60～¥100 | ≈ ¥9,700 |

若改用托管 PostgreSQL，固定成本每月再加约百元以上（未核实）。一次性开销（不计入月成本）：营业执照、可能的经营性 ICP 许可证代办费（未核实）。

---

## 12. 性能预算

| 环节 | 目标 | 说明 |
|---|---|---|
| 排盘（含真太阳时） | < 20 ms | 纯计算 |
| 规则（含三柱 13 时柱扫描） | < 50 ms | 扫描 = 13 次四柱计分 |
| 拼装 + R-CHECK | < 200 ms | 素材常驻内存（report-sections.md §11） |
| `/api/chart` 服务端 | p95 < 150 ms | PRD：免费结果 1 秒内 |
| `/api/report` 服务端 | p95 < 400 ms | PRD：服务端 < 1 秒 |
| 长图生成（手机端） | 目标 < 5 秒 | 预研实测 |

性能测试放在单元测试里（cases.json 全部案例各跑 100 次取 p95）。

---

## 13. 风险与待确认

| 风险 / 问题 | 影响 | 应对 |
|---|---|---|
| 支付 / 备案类目审核不通过（未核实） | 无法收款 | 8.3、第 10 节；先咨询；支付层可插拔 |
| 个体户不能开微信 H5（未核实） | 微信外手机浏览器只能用支付宝 | 引导到微信内打开 |
| 素材写作进度（约 500 条、13～15 万字） | 上线时间 | 引擎与素材并行；引擎用样板 / fixture 素材开发；覆盖率测试按批次逐步强制 |
| cases.json 中手算数值与代码不一致 | 规则返工 | TASKS T21 统一复核，交 mingli-expert 裁定 |
| tyme4ts 默认 provider 与本项目口径相反 | 晚子时日柱错 | 显式设置 + C05 锁定测试 |
| iOS / 微信内长图（canvas 面积上限等，未核实） | P0-9 不达标 | 先做预研；必要时降分辨率或分成 2～3 张图 |
| 链接被转发泄露出生日期 | 隐私 | 用户已知悉；提示勿分享；不进日志、无第三方脚本 |
| SQLite 单机磁盘故障 | 丢最近订单 | 10 分钟备份 + 灾备补单流程（5.2） |
| 素材被扒 | 付费内容外泄 | 素材快照只在服务端；报告只在校验通过后按单份返回；按订单号限流 |
| ~~待确认 A~~ 已确认：R-CHECK 成品检查不通过时告警放行 | 已付款用户体验 | 用户 2026-10-29 确认（4.3.7） |
| ~~待确认 B~~ 已确认：已退款订单的报告链接失效 | 售后口径 | 用户 2026-10-29 确认（4.5） |
| 第 4 张图缺评分口径 | 图表数量 | 用户已确认 MVP 先做 3 张，口径补齐后再加（4.3.9） |

---

## 14. 环境变量（只列名字，全部放 `.env`，`.env` 已在 `.gitignore`）

`SITE_URL`、`DATABASE_PATH`、`BIRTH_FP_KEY`、`BIRTH_FP_KEY_ID`、`OPENID_COOKIE_SECRET`、`TEXTS_ALLOWED_STATUS`（生产固定 approved）、`REPORT_POLISH_ENABLED`（默认 false）、`PAYMENT_MODE`（mock / sandbox / live）、`WECHAT_APPID`、`WECHAT_APP_SECRET`、`WECHAT_MCH_ID`、`WECHAT_API_V3_KEY`、`WECHAT_MCH_SERIAL_NO`、`WECHAT_MCH_PRIVATE_KEY`、`WECHAT_PLATFORM_PUBLIC_KEY`（或平台证书）、`ALIPAY_APP_ID`、`ALIPAY_PRIVATE_KEY`、`ALIPAY_PUBLIC_KEY`、`COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`、`COS_REGION`、`ALERT_WEBHOOK_URL`。
（v0.1 的 `BIRTH_ENC_KEY`、`REPORT_TOKEN_PEPPER`、`LLM_*` 全部删除。）

---

## 15. 来源

1. 微信支付 · PC 网站接入指引（个体户材料、ICP 备案要求、0.6%～1% 费率、1～2 工作日审核）：https://pay.weixin.qq.com/static/applyment_guide/applyment_detail_website.shtml
2. 微信支付 · 接入场景总览：https://pay.weixin.qq.com/static/applyment_guide/applyment_index.shtml
3. 微信支付 · H5 支付产品介绍（不能在微信内使用；开通主体类型）：https://pay.weixin.qq.com/doc/v3/merchant/4012791832
4. 华为云 · 支付宝对接说明（个体户可申请、域名需备案；第三方资料）：https://support.huaweicloud.com/adaptive-cloudsite/adaptive_8002.html
5. 阿里云开发者社区 · 支付宝手机网站支付 0.6% 费率（第三方，发布时间不明）：https://developer.aliyun.com/article/308823
6. 财付通小微商户降费延续至 2027-09-30（媒体报道）：https://stock.10jqka.com.cn/20260929/c680374918.shtml
11. 《人工智能生成合成内容标识办法》2025-09-01 起施行（科技日报）：https://www.stdaily.com/web/gdxw/2025-09/01/content_393211.html
12. 腾讯云轻量应用服务器价格（2026-10-29 查询：2C2G 入门型 ¥45/月、年付 ¥459；基础型 ¥50/月；2C4G 通用型 ¥100/月）：https://cloud.tencent.com/product/lighthouse/pricing
13. 排盘库：https://github.com/6tail/tyme4ts 、https://github.com/6tail/lunar-javascript 、https://www.npmjs.com/package/tyme4ts 、https://www.npmjs.com/package/lunar-javascript ；节气算法 寿星天文历 https://github.com/sxwnl/sxwnl
14. tyme 官方文档（`DefaultEightCharProvider` = 23:00 算次日、`LunarSect2EightCharProvider` = 23:00 算当日、`ChildLimit.provider` 各起运算法说明）：https://6tail.cn/tyme.html
15. 微信服务号认证 ¥300/年（第三方博客，未核实官方现价）：https://www.cnblogs.com/ybbit/p/16209225.html
16. 天翼云 PostgreSQL 主备实例包月价目（2021 年旧文档，仅作量级参考，非腾讯云报价）：https://ctyun.cn/document/10034019/10573316
17. 腾讯云 PostgreSQL 计费结构说明（未给出具体规格单价）：https://cloud.tencent.com/developer/information/%E4%BA%91%E6%95%B0%E6%8D%AE%E5%BA%93%20PostgreSQL%E5%AE%9A%E4%BB%B7-article
18. Litestream（SQLite 持续复制到 S3 兼容存储；对腾讯云 COS 的兼容性未核实）：https://litestream.io/getting-started/

（v0.1 的来源 7–10 号大模型价格与地区来源已随大模型方案删除；编号保留原序便于对照。）

检索过但**未找到**官方结论的问题（正文标「未核实」）：微信支付 / 支付宝对「算命、占卜」类目的准入；ICP 备案对此类内容的审核口径；个体户能否开微信 H5 支付；腾讯云托管 PostgreSQL 最小规格价格；COS 小容量存储月费；Litestream 与 COS 的兼容性；云函数冷启动耗时与网关日志是否记录请求体；iOS / 微信内置浏览器的 canvas 尺寸上限；是否需要经营性 ICP 许可证；生成式 AI 登记是否适用（大概率不适用）。
