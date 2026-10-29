# ARCHITECTURE v0.1 —— 「一元知命」（暂名）技术方案

> 依据：CLAUDE.md、docs/PRD.md v0.3。编写日期 2026-10-27。
> **rules/ 现状**：编写本文时 rules/ 下只有 README.md，strength.md / yongshen.md / report-sections.md / calendar.md / cases.json 还在由命理专家 agent 编写。本文对规则的部分只定义「接口和机制」，**具体规则内容、权重、案例字段一律以 rules/ 最终版本为准**。
> 本文中查不到可靠来源的数字一律标「未核实」，来源 URL 见第 13 节。

---

## 0. 一页结论

| 项 | 选择 | 一句话理由 |
|---|---|---|
| 语言 / 框架 | TypeScript + Next.js（App Router，Node 运行时，standalone 输出） | 前后端一个仓库一种语言，一个人能维护 |
| 数据库 | PostgreSQL（推荐腾讯云托管 PostgreSQL；备选：同机 Docker PG + 每日备份） | 成熟；`SELECT … FOR UPDATE SKIP LOCKED` 可直接做任务队列，不用再引入 Redis |
| ORM / 测试 | Prisma；Vitest（单元）+ Playwright（手机视口 E2E） | 主流、文档多 |
| 排盘库 | **tyme4ts**（MIT，6tail，活跃维护）做主库；**lunar-javascript**（MIT，同作者）只在测试里做交叉对照 | 节气用寿星天文历算法；TS 类型完整；包在适配层后面可替换 |
| 规则引擎 | 自研纯函数，每条规则一个函数，规则编号与 rules/*.md 一一对应，有「规则覆盖测试」 | 满足「每条结论输出规则编号和依据」 |
| 大模型 | 主：DeepSeek（`deepseek-v4-pro`，质量优先）；备：阿里云百炼千问（`qwen3.7-plus`）；两家都走 OpenAI 兼容接口 | 国内直连、已有大模型备案、单份成本约 ¥0.2～¥0.8（计算见第 7 节） |
| 支付 | 微信内置浏览器 → 微信 JSAPI 支付；其他手机浏览器 → 支付宝手机网站支付；PC → 微信 Native 扫码 / 支付宝 | 个体户能开的产品里，这个组合覆盖最全（见第 6 节） |
| 部署 | 腾讯云轻量应用服务器（国内地域）+ Docker Compose + ICP 备案；Vercel 只用于开发预览 | 国内访问快、可备案、微信生态同家；固定成本低 |
| 月成本 | 固定约 ¥50～¥100（服务器）+ 托管数据库（未核实）+ 每单变动约 ¥0.25～¥0.9 | 见第 9 节 |

---

## 1. 技术栈及理由

| 层 | 选型 | 理由 / 备注 |
|---|---|---|
| 运行时 | Node.js 22 LTS | Next.js 官方支持；镜像小 |
| Web 框架 | Next.js（App Router，`output: 'standalone'`），**不用 Edge / Serverless** | 支付回调、长时间生成报告都需要常驻进程；standalone 便于打成 Docker 镜像跑在国内云 |
| 样式 | Tailwind CSS | 无运行时，适合手机端；微信内置浏览器兼容好 |
| 图表 | 手写 SVG React 组件（命盘图、五行图、大运时间轴共 3～4 张） | 图形简单，不值得引入 ECharts（体积大）；SVG 在 iOS Safari 和微信 XWeb 内核都稳定，长按保存图片也方便后续 P1 导出 |
| 数据库 | PostgreSQL 15+ | 见第 4 节；队列、JSONB 存报告都够用 |
| ORM | Prisma | 迁移、类型生成成熟；一个人维护最省心 |
| 校验 | Zod | 表单、API、大模型 JSON 输出统一校验 |
| 测试 | Vitest + Playwright | 排盘 / 规则是纯函数，Vitest 跑得快；Playwright 模拟 iPhone 和微信 UA |
| 大模型 SDK | `openai` npm 包（OpenAI 兼容模式，分别指向 DeepSeek / 百炼 base URL） | 两家都提供 OpenAI 兼容接口，一套代码切换供应商（兼容性开发时以官方文档为准） |
| 支付 SDK | 支付宝：官方 `alipay-sdk`；微信支付 APIv3：自写签名 / 验签 / 解密（约 200 行，依赖 Node `crypto`），或社区库 `wechatpay-axios-plugin` | 微信支付官方 Node SDK 是否存在：未核实；APIv3 规则公开，自写可控 |
| 部署 | Docker Compose（web + worker + caddy），GitHub Actions 构建镜像 | 一台机器跑完；Caddy 自动 HTTPS |

**为什么不用 Vercel / Serverless 做生产**：Vercel 在国内访问不稳定，且无法为境外服务器办 ICP 备案；而微信支付要求接入网站完成 ICP 备案（见第 6 节来源），境外部署会直接卡住支付。Vercel 只作为开发期预览环境（可选）。

---

## 2. 排盘库选型

### 2.1 候选比较（数据取自 npm registry / GitHub API，2026-10-27）

| 库 | 许可证 | 维护情况 | 能力 | 结论 |
|---|---|---|---|---|
| **tyme4ts**（6tail） | MIT | 最新 1.5.4，2026-10-26 仍有提交；GitHub ★519；npm 月下载约 4.3 万 | 公历 / 农历（含闰月）、节气（寿星天文历算法）、干支四柱、藏干、十神、起运 / 大运 / 流年；有可替换的「八字计算 provider / 起运 provider」，可切换早晚子时等流派 | **主库** |
| lunar-javascript（6tail） | MIT | 最新 1.7.7，最后提交 2025-11；★1719；npm 月下载约 13 万；作者已把新功能转向 tyme | 同上（`EightChar`、`Yun`、`DaYun`、`LiuNian`，`setSect` 切换子时流派），使用者多、被大量网站验证过 | **只做测试对照** |
| lunar-typescript（6tail） | MIT | lunar-javascript 的 TS 版，同步更新 | 同上 | 不用（与 lunar-javascript 重复） |
| 其他 npm 八字包（bazi、zhiji-bazi、xuantian-bazi、ziping-bazi 等） | 各异 | 多数为个人新项目或多年未更新，下载量小 | 质量未核实 | 不用 |

注：tyme4ts 与 lunar-javascript 出自同一作者、共用寿星天文历节气算法，**二者交叉对照只能发现移植 / 调用错误，不能证明天文算法本身正确**；独立正确性靠 rules/cases.json + 权威节气表（见 2.3）。

### 2.2 库负责什么、我们自己负责什么

| 项 | 由谁负责 |
|---|---|
| 公历 ↔ 农历（含闰月）、节气交接时刻、年 / 月 / 日 / 时柱干支 | tyme4ts |
| 藏干、十神 | tyme4ts 提供，规则引擎按 rules/ 复核取值（如藏干主次气） |
| 起运岁数、大运、流年 | tyme4ts 计算；起运算法（按天折算方式）**选哪个 provider 以 rules/calendar.md 为准** |
| 时区 / 历史夏令时（中国 1986–1991 年夏令时）、真太阳时（经度差 + 均时差） | **我们自己写**（库不处理）；口径以 rules/calendar.md 为准 |
| 子时归属（早子 / 晚子） | 库的 provider 切换；采用哪种以 rules/calendar.md 为准 |
| 不知道时辰 → 三柱 | 我们自己控制：不调用时柱，输出 `hourPillar: null`，下游所有依赖时柱的规则 / 章节跳过 |
| 五行力量、旺衰、喜用神 | **规则引擎**（不用库自带的任何「旺衰 / 用神」功能） |

所有对库的调用只出现在 `src/lib/bazi/calendar-adapter.ts` 一个文件里，对外暴露自己的类型。以后换库只改这一个文件。依赖版本**锁死精确版本号**（不用 `^`），升级必须跑完全部对照测试。

### 2.3 用 rules/cases.json 验证（以及其他验证手段）

1. **cases.json 对照（P0-2 验收）**：测试读取 rules/cases.json，对每个案例：输入出生信息 → 排盘 → 断言四柱 100% 相同；若案例带大运 / 起运岁数，一并断言。字段名以 cases.json 最终格式为准，测试里写一个小的 loader 把它映射到内部输入类型（loader 本身也有测试）。
2. **节气边界**：PRD 要求节气交接当天前后各一个案例。除 cases.json 中的案例外，测试再自动生成：对 1950–2050 年每个「节」（立春、惊蛰……），取交接时刻前 1 分钟、后 1 分钟各一个时间点，断言月柱（立春还有年柱）正好切换。
3. **权威节气时刻抽查**：从香港天文台公布的节气时刻表 / 紫金山天文台《中国天文年历》中抽取若干年份的节气时刻写成固定测试数据（数据来源 URL 写在测试文件头），断言库算出的时刻误差 ≤ 1 分钟。
4. **差分测试**：随机生成 1 万个 1900–2100 年的出生时间，tyme4ts 与 lunar-javascript 四柱必须完全一致；不一致的样例打印出来人工核对。
5. **确定性**：同一输入跑两次结果深度相等；排盘结果做快照测试（`engineVersion` 变化才允许更新快照）。
6. **三柱模式**：cases.json 中若无，自行补充「不知道时辰」案例，断言时柱为空、其余三柱不变。

---

## 3. 模块划分

```
src/
  lib/
    bazi/            # ① 排盘引擎：纯函数，无 IO
    rules/           # ② 规则引擎：纯函数，无 IO，实现 rules/*.md
    report/          # ③ 报告生成：拼数据 → 调大模型 → 校验 → 存库
      prompts/       #    （提示词不放这里，见 prompts/）
    llm/             #    大模型客户端（供应商抽象、重试、计费）
    payment/         # ④ 支付：wechat / alipay / mock 三个实现，同一接口
    orders/          # ⑤ 订单存储与状态机（Prisma）
    privacy/         #    字段加密、日志脱敏、过期清理
  app/               # ⑥ 前端页面 + Route Handlers（API）
  worker/            #    报告生成 worker（同一镜像，独立进程）
prompts/             # 提示词文件（Markdown，带版本号）
prisma/              # schema 与迁移
rules/               # 命理专家维护（代码只读）
```

### ① 排盘引擎 `lib/bazi`（纯函数）
- 输入：`BirthInput { calendar: 'solar'|'lunar', year, month, day, isLeapMonth?, hour?: {h, m} | null, gender, location?: {lng, lat, regionCode} }`
- 步骤：输入归一化（农历→公历、校验非法日期）→ 时区 / 夏令时 → 可选真太阳时 → 调 calendar-adapter 得到四柱、藏干、十神、起运、大运、流年。
- 输出：`Chart`（JSON 可序列化，含 `engineVersion`、`calendarRulesVersion`、所有中间量如校正后时间，便于报告页展示「依据」）。
- 城市经纬度：内置一份行政区划 + 经纬度静态表（区县级即可）；数据来源和许可证在实现任务里核实后写进文件头。

### ② 规则引擎 `lib/rules`（纯函数，规则驱动）
- 输入：`Chart`；输出：`Analysis { elementScores, strength: {level, score, fired: RuleHit[]}, yongshen: {yong, xi, ji, fired: RuleHit[]}, personaLine: {templateId, text} }`，`RuleHit = { ruleId, text, evidence }`。
- **规则与代码的对应方式**：
  - rules/*.md 是唯一真相来源，供人审查；每条规则有编号（编号格式以 rules/ 最终版本为准）。
  - 代码中每条规则一个函数，`ruleId` 与 md 中编号相同；规则中的数值表（藏干权重、月令系数、旺衰阈值等）放在 `lib/rules/config/*.json`，文件头注明对应的 md 章节。若专家在 md 中提供机器可读的 JSON/YAML 块，则直接由脚本抽取生成，避免手抄。
  - **规则覆盖测试**：测试用正则扫描 rules/*.md 中所有规则编号，断言每个编号都有实现、代码里没有 md 里不存在的编号。规则改了而代码没跟上，CI 就会红。
  - `rulesVersion` = rules/ 目录内容的 hash，写进每份报告，可追溯。
- 一句话性格画像：由规则选模板拼出（不调大模型），保证免费页 < 1 秒、零成本、同输入同输出。
- 验收：cases.json 中带人工标注的案例，旺衰 / 喜用结论一致率 ≥ 90%；测试输出一份不一致清单（案例 ID、我们的结论、标注结论、触发的规则），供专家逐条判断。

### ③ 报告生成 `lib/report` + `lib/llm` + `worker/`
- 支付成功后由 worker 异步执行，详见第 7 节。
- **图表和逐年卡片的数据（年份、干支、大运区间、五行分数）全部来自 Chart/Analysis，由前端直接渲染**；大模型只为每张卡片 / 每章写解读文字。这样「年份、干支与排盘 100% 一致」从结构上就有保证，再加文本校验兜底。

### ④ 支付 `lib/payment`
- 接口：`createPayment(order, env) → 前端调起参数`、`verifyNotify(req) → PaidEvent`、`queryOrder(outTradeNo)`、`closeOrder`、`refund(order, reason)`。
- 实现：`wechat-jsapi`、`wechat-native`、`alipay-wap`、`mock`（开发 / 测试用，模拟回调）。

### ⑤ 订单存储 `lib/orders`
- 订单状态机（只允许以下迁移，代码里集中校验）：
  `created → paid → generating → completed`
  `created → closed`（30 分钟未支付，调用关单）
  `generating → failed → refunding → refunded`

  `completed → refunding → refunded`（用户人工退款）
- 所有回调、查单都按 `out_trade_no` 幂等处理；一个订单只会创建一个 report 和一个生成任务。

### ⑥ 前端 `app/`
- 页面：`/` 首页表单 → `/result` 免费结果（计算在服务端 Route Handler，结果不落库）→ 付费按钮 → `/pay/[orderId]` 支付中 / 生成中 → `/r/[token]` 报告页；`/privacy`、`/disclaimer`。
- 环境识别：根据 UA 判断微信内置浏览器 / 其他手机浏览器 / PC，决定展示哪种支付方式（见 6.3）。
- 续看：订单创建后把 `report token` 存进 localStorage，用户中途关掉页面再回来能继续；同时提示「请收藏 / 保存本页链接」。
- 交互细节以 docs/UI.md（designer 产出）为准。

---

## 4. 数据模型（Prisma 草案，开发时可微调字段名）

```prisma
model Order {
  id              String   @id @default(uuid())
  outTradeNo      String   @unique          // 发给支付渠道的商户订单号
  status          OrderStatus
  amountFen       Int                       // 990，服务端写死，不信任前端
  channel         PayChannel?               // WECHAT_JSAPI / WECHAT_NATIVE / ALIPAY_WAP
  channelTradeNo  String?                   // 渠道流水号
  payerOpenid     String?                   // 微信 JSAPI 需要
  birthEnc        Bytes                     // 出生信息，AES-256-GCM 加密后的 JSON
  hourKnown       Boolean
  engineVersion   String
  rulesVersion    String
  paidAt          DateTime?
  closedAt        DateTime?
  refundedAt      DateTime?
  refundReason    String?
  createdAt       DateTime @default(now())
  report          Report?
  events          PaymentEvent[]
}

model Report {
  id              String   @id @default(uuid())
  orderId         String   @unique          // 一个订单只有一份报告 → 不会重复调用大模型
  tokenHash       String   @unique          // sha256(访问 token)；token 本身 ≥128 位随机，只出现在 URL 中
  status          ReportStatus              // PENDING / GENERATING / READY / FAILED / DELETED
  chartJson       Json                      // 排盘 + 规则结论快照（报告页渲染图表用）
  contentJson     Json?                     // 各章节正文 + 逐年卡片文字
  promptVersion   String?
  model           String?
  tokensIn        Int      @default(0)
  tokensOut       Int      @default(0)
  costMilliYuan   Int      @default(0)      // 记录大模型花费（厘）
  validation      Json?                     // 一致性校验 / 敏感词检测结果
  generatedAt     DateTime?
  expiresAt       DateTime                  // 到期自动删除（见第 10 节）
  attempts        GenerationAttempt[]
}

model GenerationAttempt {                   // 每章每次调用一行：用于重试、排错、算成本
  id          String @id @default(uuid())
  reportId    String
  section     String
  attempt     Int
  provider    String
  model       String
  status      String                        // OK / TIMEOUT / INVALID_JSON / VALIDATION_FAILED / API_ERROR
  error       String?
  tokensIn    Int
  tokensOut   Int
  latencyMs   Int
  createdAt   DateTime @default(now())
}

model Job {                                 // 简单任务队列：worker 用 FOR UPDATE SKIP LOCKED 取任务
  id          String   @id @default(uuid())
  type        String                        // GENERATE_REPORT / REFUND / CLEANUP
  refId       String
  status      String                        // QUEUED / RUNNING / DONE / FAILED
  runAfter    DateTime @default(now())
  tries       Int      @default(0)
  lastError   String?
  @@unique([type, refId])                   // 同一订单不会被重复排队
}

model PaymentEvent {                        // 原始回调 / 查单记录（不含出生信息），对账和排错用
  id          String   @id @default(uuid())
  orderId     String
  kind        String                        // NOTIFY / QUERY / REFUND_NOTIFY / CLOSE
  payload     Json
  createdAt   DateTime @default(now())
}
```

要点：
- **不落库**：免费结果（每次实时计算）、用户姓名（根本不收集）、手机号（不收集）。
- 「同一份报告不重复扣费」：金额和订单由服务端生成；支付回调幂等；一个订单唯一一份报告（`orderId @unique`）；`Job @@unique([type, refId])` 防重复生成。
- 报告页查询：`sha256(token)` 命中 Report 且所属 Order 状态为 paid/generating/completed 才返回内容；否则 404（不区分「不存在」和「未支付」，避免枚举）。

---

## 5. 关键流程

```
首页提交 ──POST /api/chart──▶ 排盘+规则（<50ms）──▶ 免费结果页（不落库）
   │
   └─点「¥9.9 查看完整报告」─POST /api/orders（带出生信息）
         服务端重新排盘（不信任前端结果）→ 建 Order(created) + Report(PENDING) → 生成 token
         → 按环境返回支付参数（微信内先走静默网页授权拿 openid）
               │
   用户支付 ───┤──▶ 渠道回调 /api/pay/notify/{channel}：验签→解密→幂等更新 paid→入队 GENERATE_REPORT
               └──▶ 前端轮询 /api/orders/{id}；若 10 秒未收到回调，服务端主动查单兜底
   worker 取任务 → 并行生成各章 → 校验 → 存 contentJson → completed
   前端跳转 /r/{token}，生成中显示进度；失败 → 自动退款并提示
   定时任务：关闭 30 分钟未支付订单；清理到期报告
```

---

## 6. 支付方案

### 6.1 渠道比较（个体工商户）

| 渠道 / 产品 | 个体户能否开 | 关键条件 | 费率 | 来源 |
|---|---|---|---|---|
| 微信支付 · JSAPI（公众号网页支付，微信内置浏览器） | 可以（PC 网站接入指引单列了个体户材料） | 营业执照、法人身份证、对公账户或法人个人账户；**网站域名须完成 ICP 备案**；JSAPI 需绑定**已认证的服务号**以获取 openid；审核 1～2 个工作日 | 官方说明「交易服务费通常为 0.6%～1%，取决于经营类目」 | [1][2] |
| 微信支付 · Native（PC 扫码） | 可以（PC 网站场景获得 JSAPI + Native 能力） | 同上 | 同上 | [1] |
| 微信支付 · H5 支付（微信外手机浏览器） | **官方开通条件列出的主体为企业、事业单位、政府机关、社会组织，未列个体户 → 个体户大概率不能开（未核实，需咨询）**；且 H5 支付**不能在微信内置浏览器使用** | 已认证服务号 / 小程序 / 移动应用 | — | [3] |
| 支付宝 · 手机网站支付（WAP） | 可以（第三方文档称个体户有营业执照即可申请，官方原文未核实） | 实名认证的支付宝商户账户 + 营业执照；网站域名需备案 | 0.6%（第三方文章，官方费率未核实） | [4][5] |
| 支付宝在微信内 | **不可用**（微信内置浏览器屏蔽支付宝跳转，业内共识，官方说明未核实） | 需引导「在浏览器中打开」 | — | — |
| 持牌聚合支付（拉卡拉、汇付天下、易宝等持牌机构或其服务商） | 一般支持个体户 | 条件、费率、是否接受该类目：**未核实** | 未核实 | — |
| 「个人免签」类收款（非持牌，二维码转发 / 代收） | — | **不建议**：存在「二清」合规风险、资金冻结风险 | — | — |

费率优惠：有报道称财付通对小微经营主体的手续费 9 折优惠延续至 2027-09-30，是否适用本商户：未核实 [6]。

### 6.2 推荐方案
- **主方案**：个体户同时开通 **微信支付商户号（JSAPI + Native）** 和 **支付宝商户（手机网站支付 + 电脑网站支付）**，并注册、认证一个**微信服务号**（用于 JSAPI 获取 openid、配置网页授权域名）。
- **每单手续费**：¥9.9 × 0.6% ≈ ¥0.06；按 1% 上限 ≈ ¥0.10。

### 6.3 不同环境下用什么支付

| 用户所在环境 | 支付方式 | 说明 |
|---|---|---|
| 微信内置浏览器（主要流量） | 微信 JSAPI | 先走 `snsapi_base` 静默网页授权拿 openid（用户无感知、不需要「登录」） |
| iOS Safari / 安卓浏览器 | 支付宝手机网站支付（主）；微信：若个体户能开 H5 支付则加上，否则提示「复制链接到微信打开」 | |
| PC 浏览器 | 微信 Native 扫码 + 支付宝电脑网站支付 | 非重点 |

### 6.4 「算命 / 占卜」类目风险的应对（PRD 9.2，未核实）
本次检索**没有找到**微信支付、支付宝或 ICP 备案明确禁止 / 允许「算命、占卜」的官方条文（检索记录见第 13 节），因此结论是**未核实，必须在开发前由你向渠道和备案服务商咨询**。应对：
1. **产品表述**：全站定位为「传统文化参考 / 娱乐」，页面不出现「算命、改运、化解、消灾、开运物品」等字眼；栏目和报告标题使用「八字命盘」「五行性格分析」「传统文化报告」这类表述。申报经营类目时**如实描述业务**（不要隐瞒实际内容，隐瞒可能导致商户号冻结、资金无法结算），并向客服确认适用类目。
2. **备选渠道**（按优先级）：① 只开下来其中一家（微信或支付宝）也可以上线；② 咨询持牌聚合支付服务商是否接受该类目；③ 若均不通过，调整为「免费 + 其他变现」或改为小程序形态再评估（需重新立项，不在本次范围）。
3. **代码上**：支付层是可插拔接口，换渠道只新增一个实现，不动业务代码。

### 6.5 你需要办的支付手续（清单）
1. 办理**个体工商户营业执照**（经营范围建议含「信息技术咨询服务 / 文化咨询」等，具体以当地市场监管部门为准）。
2. 开立对公账户（可选；个体户可用经营者个人银行卡结算）。
3. 注册**微信服务号**（主体选个体工商户）并完成**微信认证**（第三方资料称认证费 ¥300/年，未核实官方现价）。
4. 申请**微信支付商户号**，开通 JSAPI、Native；咨询 H5 支付是否对个体户开放；在商户平台配置 JSAPI 支付授权目录、APIv3 密钥、商户证书；商户号与服务号 AppID 绑定。
5. 在支付宝开放平台注册商家账号，签约**手机网站支付、电脑网站支付**，创建应用、配置密钥。
6. 第 3～5 步都需要**已备案的域名**和可访问的网站，因此在 ICP 备案下来后、网站有基本页面时提交。
7. 向两家客服确认「八字 / 传统文化分析」的可用类目和费率（PRD 9.2）。

---

## 7. 大模型调用方案

### 7.1 候选与价格（元 / 百万 token）

| 模型 | 输入（未命中缓存） | 输出 | 国内可用性 | 来源 |
|---|---|---|---|---|
| DeepSeek `deepseek-v4-pro` | 4.5（空闲）/ 9（高峰） | 13.5 / 27 | 国内直连 | [7] |
| DeepSeek `deepseek-flash` | 1 / 2 | 4 / 8 | 国内直连 | [7] |
| 千问 `qwen3.7-plus`（北京地域，原价，页面标「限时 8 折」） | 2（≤256K） | 8 | 阿里云百炼 | [8] |
| 千问 `qwen-plus`（非思考） | 0.8（≤128K） | 2 | 阿里云百炼 | [8] |
| Claude Sonnet 5.5 | $2 ≈ ¥14.4 | $10 ≈ ¥72 | **中国大陆不在 Anthropic 官方支持地区**；且需把用户出生信息传到境外 | [9][10] |
| Claude Haiku 5.5 | $0.10 ≈ ¥0.72 | $0.50 ≈ ¥3.6 | 同上 | [9][10] |

DeepSeek 高峰时段：北京时间工作日 9:00–12:00、14:00–18:00，其余为空闲价（半价）[7]。汇率按 1 USD ≈ ¥7.2 估算（假设）。

### 7.2 单份报告成本估算（按 PRD：正文 5,000～8,000 字）

报告按章节**并行**生成（原因见 7.4），假设 8 个章节调用：

- **输出**：正文上限 8,000 字 + JSON 结构和逐年卡片短评约 25% → 约 10,000 字。国内模型按**保守 1 字 ≈ 1 token**（DeepSeek 文档给的经验值约 1 字 ≈ 0.6 token，未逐一核实各家，取保守值）→ **约 10,000 输出 token**。
- **输入**：每章 = 系统提示词约 3,000 + 命盘数据 JSON 约 3,000 + 本章写作要求约 1,000 = 7,000 token；× 8 章 = **约 56,000 输入 token**（保守按全部未命中缓存；实际系统提示词 + 命盘数据是相同前缀，DeepSeek 等会命中缓存，便宜很多）。

| 模型 | 计算 | 单份成本 |
|---|---|---|
| deepseek-v4-pro（高峰价，最坏情况） | 56,000×9/10⁶ + 10,000×27/10⁶ = 0.504 + 0.270 | **≈ ¥0.77** |
| deepseek-v4-pro（空闲价） | 0.252 + 0.135 | ≈ ¥0.39 |
| deepseek-flash（高峰） | 56,000×2/10⁶ + 10,000×8/10⁶ = 0.112 + 0.080 | ≈ ¥0.19 |
| qwen3.7-plus（原价） | 56,000×2/10⁶ + 10,000×8/10⁶ | ≈ ¥0.19 |
| qwen-plus（非思考） | 56,000×0.8/10⁶ + 10,000×2/10⁶ = 0.045 + 0.020 | ≈ ¥0.07 |
| Claude Sonnet 5.5（中文按 1 字 ≈ 1.3 token：输入 73K、输出 13K） | 0.073×$2 + 0.013×$10 = $0.276 | ≈ ¥2.0（超预算，且不可在国内合规使用） |
| Claude Haiku 5.5（同上） | 0.073×$0.1 + 0.013×$0.5 = $0.014 | ≈ ¥0.10（同样受地区限制） |

**重试的影响**：重试按「章」进行，单章失败只重跑该章（约整份的 1/8）。最坏情况 v4-pro 高峰价所有章都重试 3 次 = ¥0.77 × 4 ≈ ¥3.1，会超 ¥2；因此规定**第 2 次重试起改用备用模型（deepseek-flash 或 qwen3.7-plus）**，最坏情况约 ¥0.77 + 3 × ¥0.19 ≈ ¥1.34 < ¥2。每份报告记录真实 token 和花费（`Report.costMilliYuan`），运维看板统计。

### 7.3 推荐
- **主模型：`deepseek-v4-pro`**（质量优先，单份 ¥0.4～¥0.8）；**备用：`deepseek-flash` / `qwen3.7-plus`**（跨供应商容灾，DeepSeek 整体故障时也能出报告）。
- **最终选型由 TASKS 中的「模型评测」任务决定**：用 5 个案例分别让 2～3 个模型生成整份报告，记录实际 token、成本、耗时，由你和命理专家盲评质量后拍板。所有模型名、base URL 都是环境变量，切换不改代码。
- 不推荐 Claude：大陆不在官方支持地区，且涉及个人信息出境，合规成本高。
- 免费页的「一句话性格」用规则模板，不调大模型。

### 7.4 调用设计
- **为什么并行分章**：8,000 字一次性输出，按常见的几十 token/秒的生成速度需要数分钟（速度未实测），达不到 PRD「60 秒内生成」；分 8 章并行，每章约 1,000 字，可在约 20～40 秒内完成（需在评测任务中实测）。
- **提示词放哪里**：仓库 `prompts/` 目录，Markdown 文件，纳入 git 版本管理：
  - `prompts/system.md`：角色、语气、合规红线（不做医疗 / 投资 / 法律断言、不恐吓、每条结论引用规则依据）、输出 JSON 格式说明；
  - `prompts/sections/<章节>.md`：每章写作要求，**内容按 rules/report-sections.md 最终版编写**；
  - 文件头写 `version`，生成时把版本号存入 `Report.promptVersion`。
- **输入**：只给结构化数据（Chart + Analysis + 触发规则的编号与依据文字 + 本章需要的流年 / 大运表），**不给出生日期原文以外的个人信息**（本来也没有姓名）。明确要求「只能使用给定数据中的干支和年份，不得自行推算」。
- **输出**：JSON（使用各家的 JSON 输出模式），用 Zod 校验结构；逐年卡片的年份 / 干支由代码填，模型只填文字。
- **校验（自动）**：
  1. 结构：JSON 合法、字段齐全、每章字数在区间内、全文合计 5,000～8,000 字；
  2. 一致性：正则抽取正文中所有「公元年份」「干支」「年份+干支」组合，与 Chart 的流年 / 大运表比对，出现任何不一致即判失败；
  3. 合规：敏感词表（医疗诊断、投资建议、法律断言、恐吓用语，如「血光之灾」等）命中即失败；词表放 `prompts/banned-words.txt`；
  4. 页面上加「本报告文字由人工智能生成」的显式标识（《人工智能生成合成内容标识办法》2025-09-01 起施行 [11]）。
- **失败重试**：每章最多重试 3 次（指数退避 1s / 3s / 8s）；第 2 次起切换备用模型；单次调用超时 40 秒；整份任务硬上限 120 秒（PRD 目标 60 秒，留余量）。仍失败 → 报告标记 FAILED → 自动调用退款接口 → 前端提示「生成失败，已原路退款」。
- **不重复调用**：报告 READY 后再打开链接只读库；worker 开始前检查 Report 状态，已有内容的章节不重跑（重试只补缺）。

---

## 8. 部署方案

### 8.1 推荐：腾讯云轻量应用服务器（国内地域）+ ICP 备案
- 理由：国内访问快；可直接在腾讯云办 ICP 备案（备案需要国内云资源）；与微信生态同一家，文档和工单方便；一台机器 Docker Compose 即可，一个人能运维。阿里云同等可选（百炼在阿里云，二者差别不大），按你已有账号决定。
- 规格：2 核 4GB（¥100/月）起步；预算紧可用 2 核 2GB（¥45～¥50/月），报告生成主要耗时在等待大模型，CPU 压力小 [12]。
- 组件（docker-compose）：
  - `web`：Next.js standalone；
  - `worker`：同一镜像，启动命令不同，负责报告生成、自动退款、关单、过期清理；
  - `caddy`：反向代理 + 自动 HTTPS（Let's Encrypt）；
  - 数据库：**推荐腾讯云托管 PostgreSQL**（自动备份、免运维；价格未核实，请在购买页按最小规格查询）；**备选**：同机 Docker PostgreSQL + 每日 `pg_dump` 上传对象存储（更便宜，但备份 / 升级要自己管）。
- CI/CD：GitHub Actions 跑全部测试 → 构建镜像 → 推送到腾讯云容器镜像服务 → SSH 到服务器 `docker compose pull && up -d`。细节由 devops 写进 docs/DEPLOY.md。
- 监控：结构化日志 + 数据库里的统计（订单数、转化率、生成失败率、大模型花费）+ 失败告警推送到企业微信群机器人。境外 SaaS（如 Sentry）在国内的可达性未核实，MVP 不依赖。

### 8.2 备选与不推荐
| 方案 | 评价 |
|---|---|
| 阿里云 ECS / 轻量 | 与推荐方案等价 |
| 香港服务器（免备案） | 国内访问尚可，但微信支付要求接入网站完成 ICP 备案 [1]，香港服务器无法办国内备案 → 支付走不通。仅在备案受阻、先做免费版时考虑 |
| Vercel / 境外 Serverless | 国内访问不稳定、不能备案、无常驻进程。只用于开发预览 |

### 8.3 合规手续（你需要办）
1. 购买域名（需实名认证）；新网站名定下后再买（PRD 9.3）。
2. **ICP 备案**：主体用个体工商户（与支付主体一致更顺），在腾讯云备案系统提交；网站名称、内容描述**如实填写**，用「传统文化 / 性格分析类资讯」等表述（「算命」类内容能否备案：未核实，需先咨询备案客服）。备案期间网站不能对外访问。
3. 备案下来后 30 日内办理**公安联网备案**（全国互联网安全管理服务平台），页面底部挂备案号。
4. **经营性 ICP 许可证**：本站在线收费提供信息服务，是否需要办增值电信业务经营许可证（ICP 证）：未核实，建议咨询备案服务商 / 当地通信管理局。
5. **生成式 AI 相关**：调用已备案大模型的 API 面向公众提供服务，是否需要在属地网信办做「生成式人工智能服务登记 / 算法备案」：未核实，建议咨询。

---

## 9. 每月成本估算

| 项 | 金额 | 备注 |
|---|---|---|
| 轻量服务器 2C4G | ¥100/月（年付 ¥1,020） | 2C2G 为 ¥45～¥50/月 [12] |
| 托管 PostgreSQL | **未核实** | 购买页查询；若选同机自建则为 ¥0（加对象存储备份约几元，未核实） |
| 域名 | 未核实（按年） | 视后缀 |
| 微信服务号认证 | ≈ ¥25/月（¥300/年，未核实） | |
| SSL / 备案 | ¥0 | Let's Encrypt；ICP 备案不收费 |
| 支付手续费 | ¥0.06～¥0.10/单 | 0.6%～1% |
| 大模型 | ¥0.2～¥0.8/单（重试最坏 ≈ ¥1.34） | 第 7.2 节 |

| 场景 | 月订单 | 收入 | 固定成本（不含数据库） | 变动成本 | 估算毛利 |
|---|---|---|---|---|---|
| 冷启动 | 100 | ¥990 | ≈ ¥125 | ¥26～¥90 | ≈ ¥775～¥840 − 数据库 |
| 有起色 | 1,000 | ¥9,900 | ≈ ¥125 | ¥260～¥900 | ≈ ¥8,875～¥9,515 − 数据库 |

（变动成本 = 每单手续费 + 大模型；未计退款、税费。）

---

## 10. 隐私：出生信息怎么存、存多久

- **收集最少**：只收集出生日期时间、性别、可选出生地（到区县）；不收姓名、手机号、不需要登录。
- **免费结果**：服务端实时计算后直接返回，**不落库、不写日志**。
- **付费订单**：出生信息以 **AES-256-GCM 字段级加密**存入 `Order.birthEnc`，密钥只在 `.env`（`BIRTH_ENC_KEY`）；Report 中的命盘快照必须包含干支等用于渲染，属于派生数据，与订单一起按期删除。
- **日志脱敏**：统一的 logger 过滤出生信息字段；支付回调原文存 `PaymentEvent` 前去掉无关字段；大模型调用日志只记 token 数和状态，不记请求正文。
- **访问控制**：报告只能凭 ≥128 位随机 token 访问；库里只存 token 的 sha256；报告页设置 `noindex`、`Referrer-Policy: no-referrer`。
- **保存期限（建议，待你确认）**：报告及出生信息保存 **365 天**后自动删除（定时任务）；未支付订单 7 天后删除出生信息；财务字段（金额、渠道流水号、时间）不含出生信息，按会计要求单独保留。
- **用户自助删除**：报告页提供「删除我的报告」按钮（凭 token 操作，二次确认），立即删除出生信息和报告内容。
- **出境**：大模型使用国内供应商，数据不出境。
- 隐私说明页写明：收集什么、用途（只用于生成命盘和报告）、交给谁处理（大模型供应商、支付渠道）、保存多久、如何删除、联系方式。

---

## 11. 风险与未决事项

| 风险 | 影响 | 应对 |
|---|---|---|
| 支付 / 备案类目审核不通过（未核实） | 无法收款 | 6.4、8.3；开发前先咨询；支付层可插拔 |
| 个体户不能开微信 H5 支付（未核实） | 微信外浏览器用户只能用支付宝 | 引导到微信内打开；支付宝兜底 |
| rules/ 内容未定稿 | 规则引擎返工 | 规则编号 + 覆盖测试；规则任务标注「以 rules/ 最终版本为准」 |
| 大模型 60 秒内生成不完 | 体验差 | 分章并行；评测任务实测；生成页显示进度 |
| DeepSeek 调价（有报道称将上调）[13] | 成本上升 | 备用模型 + 环境变量切换；成本看板 |
| 历史夏令时 / 真太阳时口径争议 | 时柱错 | 口径以 rules/calendar.md 为准，报告中显示「校正后时间」 |

---

## 12. 环境变量清单（只列名字）
`DATABASE_URL`、`BIRTH_ENC_KEY`、`REPORT_TOKEN_PEPPER`、`LLM_PRIMARY_BASE_URL`、`LLM_PRIMARY_API_KEY`、`LLM_PRIMARY_MODEL`、`LLM_FALLBACK_BASE_URL`、`LLM_FALLBACK_API_KEY`、`LLM_FALLBACK_MODEL`、`WECHAT_APPID`、`WECHAT_APP_SECRET`、`WECHAT_MCH_ID`、`WECHAT_API_V3_KEY`、`WECHAT_MCH_SERIAL_NO`、`WECHAT_MCH_PRIVATE_KEY`、`WECHAT_PLATFORM_CERT`（或平台公钥）、`ALIPAY_APP_ID`、`ALIPAY_PRIVATE_KEY`、`ALIPAY_PUBLIC_KEY`、`PAYMENT_MODE`（mock/live）、`SITE_URL`、`ALERT_WEBHOOK_URL`。全部只放 `.env`，`.env` 已在 `.gitignore`。

---

## 13. 来源

1. 微信支付 · PC 网站接入指引（个体户材料、ICP 备案要求、0.6%～1% 费率、1～2 工作日审核）：https://pay.weixin.qq.com/static/applyment_guide/applyment_detail_website.shtml
2. 微信支付 · 接入场景总览（各场景对应的支付产品）：https://pay.weixin.qq.com/static/applyment_guide/applyment_index.shtml
3. 微信支付 · H5 支付产品介绍（不能在微信内置浏览器使用；开通主体类型）：https://pay.weixin.qq.com/doc/v3/merchant/4012791832
4. 华为云 · 支付宝对接说明（个体户可申请、域名需备案；第三方资料）：https://support.huaweicloud.com/adaptive-cloudsite/adaptive_8002.html
5. 阿里云开发者社区 · 支付宝手机网站支付 0.6% 费率（第三方，发布时间不明）：https://developer.aliyun.com/article/308823
6. 财付通小微商户降费延续至 2027-09-30（媒体报道）：https://stock.10jqka.com.cn/20260929/c680374918.shtml
7. DeepSeek 官方价格页：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
8. 阿里云百炼计费说明（千问 Plus / Flash 价格）：https://help.aliyun.com/zh/model-studio/billing/
9. Claude 模型价格（Anthropic 官方 API 价格，2026-10 缓存数据）：https://www.anthropic.com/pricing
10. Anthropic 支持的国家和地区：https://www.anthropic.com/supported-countries
11. 《人工智能生成合成内容标识办法》2025-09-01 起施行（科技日报）：https://www.stdaily.com/web/gdxw/2025-09/01/content_393211.html
12. 腾讯云轻量应用服务器价格：https://cloud.tencent.com/product/lighthouse/pricing
13. DeepSeek 计划上调 API 价格的报道：https://technews.tw/?p=1598689
14. 排盘库：https://github.com/6tail/tyme4ts 、https://github.com/6tail/lunar-javascript 、https://www.npmjs.com/package/tyme4ts 、https://www.npmjs.com/package/lunar-javascript ；节气算法出处 寿星天文历 https://github.com/sxwnl/sxwnl
15. 微信服务号认证 ¥300/年（第三方博客，未核实官方现价）：https://www.cnblogs.com/ybbit/p/16209225.html

检索过但**未找到**官方结论的问题（因此在正文标「未核实」）：微信支付 / 支付宝对「算命、占卜」类目的准入规定；ICP 备案对此类内容的审核口径；个体户能否开微信 H5 支付；腾讯云托管 PostgreSQL 最小规格价格；是否需要经营性 ICP 许可证和生成式 AI 登记。
