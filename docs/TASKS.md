# TASKS v0.2 —— H5 / Web MVP 开发任务拆分

> 依据：docs/ARCHITECTURE.md v0.2、docs/PRD.md v0.4、rules/ v2。编写日期 2026-10-29。
> 范围：只做 Web（电脑浏览器）+ H5（手机浏览器、微信内置浏览器）。不做小程序。
> 规则：每个任务半天内完成；dev agent 每次只做一个任务，完成后跑全部测试、**单独 git commit**、在此打勾。
> 标记：
> - **【rules】** 以 rules/ 为准，发现 rules/ 有歧义或矛盾时停下，交 mingli-expert，不自行决定口径；
> - **【UI】** 以 docs/UI.md 为准（若已产出）；
> - **【需你】** 依赖你在线下办好的手续（见 U 组），真实联调前先问你；
> - **【付费】** 会产生费用或涉及生产环境，执行前先问你。
> 顺序：排盘引擎和测试最前；素材库工具链可与排盘并行；真实支付联调放最后，之前一律用 mock 渠道。
> 素材撰写（K 组）由 mingli-expert 并行进行，**不阻塞**引擎开发：引擎测试只用 `packages/core/test/fixtures/texts/`（含 rules/texts 的 10 条样板）。

## 阶段总览

| 阶段 | 任务 | 内容 | 执行者 |
|---|---|---|---|
| A 脚手架 | T01–T02 | workspaces、Next.js、测试与 CI | dev |
| B 排盘引擎 | T03–T13 | cases 对照框架、四柱、时区 / 夏令时、真太阳时、早晚子时、农历、大运流年、三柱、边界与差分测试 | dev |
| C 规则引擎 | T14–T21 | 规则注册、五行力量、旺衰 / 真从、喜用、三柱扫描、吉神、大运流年评分、**cases.json 代码复核** | dev（T21 含 mingli-expert 裁定） |
| D 素材库工具链 | T22–T26 | schema / 槽位注册表 / 字段字典、条件树、lint L1–L12、批次抽检 | dev（可与 B、C 并行） |
| E 拼装引擎 | T27–T38 | ctx、选段与变体、占位符与术语加注、章节拼装、R-CHECK、覆盖率（静态 / 动态）、确定性 / 性能 / 润色接口、预览与抽检单、发布与快照 | dev |
| F 出生信息与订单 | T39–T42 | 载荷编解码、地区经纬度表、指纹与日志、SQLite 订单 | dev |
| G 免费流程 | T43–T46 | 免费 API、首页、免费结果页、免责 / 隐私 | dev |
| H 支付 | T47–T52 | 支付抽象 + mock、前端支付流程、微信 JSAPI / Native、支付宝、订单维护与退款标记 | dev（T49–T51 部分【需你】） |
| I 报告页 | T53–T58 | 报告 API、报告页、命盘表与图表、逐年卡片、长图预研与实现 | dev |
| J 隐私、安全与上线准备 | T59–T65 | 安全头 / CSP、日志哨兵测试、Docker、备份、CI 门禁、E2E、运营脚本 | dev |
| K 素材撰写（并行） | K01–K15 | 三批素材起草、自检、提交抽检 | mingli-expert |
| U 你的线下事项 | U01–U09 | 执照、域名、备案、服务号、商户号、类目咨询、批次抽检 | 你 |

---

## A 脚手架

- [x] **T01 项目初始化（workspaces）**
  依赖：无
  内容：npm workspaces：`packages/core`（纯 TS，独立 tsconfig strict）+ `apps/web`（Next.js App Router、TypeScript strict、`output: 'standalone'`、Tailwind）；ESLint / Prettier；core 的 `no-restricted-imports`（禁止 next、react、node:*、数据库、支付）；目录按 ARCHITECTURE 第 4 节建空模块；`.env.example`（只列变量名）；确认 `.gitignore` 含 `.env`。
  验收：`npm run dev` 能打开空首页；`npm run build` 通过；在 core 里故意 import `node:fs` 时 lint 报错；仓库无密钥。

- [ ] **T02 测试与 CI 基础**
  依赖：T01
  内容：两个 workspace 的 Vitest 配置、根目录 `npm test`；GitHub Actions 跑 lint + typecheck + test；`packages/core/test/fixtures/` 约定。
  验收：示例测试本地与 CI 都通过；CI 失败时显示红叉。

## B 排盘引擎（`packages/core/src/bazi`，纯函数）

- [ ] **T03 cases.json loader + 对照测试骨架** 【rules】
  依赖：T02
  内容：定义 `BirthInput` / `Chart` 初版类型；读取 rules/cases.json v2，映射 `input` → `BirthInput`；按 `_meta.test_guidance` 写参数化断言工具（容差、rules_hit 前缀比对、shensha_ji 全等）；尚未实现的字段用显式「待实现」清单跳过，并在输出中列出，不能静默通过。
  验收：loader 单元测试通过；19 个案例全部解析成功；跳过清单在测试输出中可见。

- [ ] **T04 历法适配层 + 年柱 / 月柱** 【rules】
  依赖：T03
  内容：安装 tyme4ts（锁精确版本）；`calendar-adapter.ts` 是唯一 import tyme4ts 的文件，模块加载时显式设置 `LunarHour.provider = new LunarSect2EightCharProvider()`、`ChildLimit.provider = new LunarSect2ChildLimitProvider()`；用北京标准时间（绝对时刻）与节气比较得到年柱、月柱，输出 `jieqi_prev / jieqi_next`（名称 + 时刻）。
  验收：C01 / C02（立春前后）、C03（春节后立春前）、C16（公历 1 月）年月柱正确；测试断言 provider 已设置为 Sect2；`grep` 确认其他文件不 import tyme4ts。

- [ ] **T05 时区与夏令时（CAL-TZ）** 【rules】
  依赖：T04
  内容：Luxon 把本地钟表时间 → UTC（默认 Asia/Shanghai，支持海外时区）；1986–1991 夏令时；夏令时结束日重复时刻取较晚一次并返回提示标记；开始日不存在的时刻返回错误码 `E_DST_GAP`；输出 `clock_to_utc`。错误信息不含输入值。
  验收：每年夏令时起止前后用例通过（含 1988 年以 tzdata 为准）；重复 / 不存在时刻各有用例；一个海外时区用例。

- [ ] **T06 真太阳时（CAL-TST）** 【rules】
  依赖：T05
  内容：经度 × 4 分钟 + NOAA 均时差；只在传入出生地时校正，输出 `tst_status`（已校正 / 未校正）与 `true_solar_time`（北京时间 → 真太阳时、经度修正、均时差）；未校正且距时辰边界 < 30 分钟时输出提示标记。出生地暂用测试用小表（几个城市），正式表见 T40。
  验收：均时差全年极值在 −14.2～+16.4 分钟范围；C08（乌鲁木齐 00:40 → 前一日 22:19）校正值正确；未选出生地用例 `tst_status = 未校正`。

- [ ] **T07 日柱、时柱与早晚子时（CAL-DH）** 【rules】
  依赖：T06
  内容：用 CAL-TST 得到的当地时间自己计算日柱（60 甲子计数，2000-01-01 戊午）和时柱（五鼠遁）；23:00–23:59 日柱不换、时干按次日日干起；输出 `alt.zi_huanri_day_pillar`（23:00 换日派）；未校正时与 tyme4ts Sect2 结果交叉校验。
  验收：**C05（23:30 → 乙巳日戊子时）、C04（00:30 → 乙巳日丙子时）锁定测试**通过；C08 跨午夜日柱、时柱都变；校正后跨 23:00 只改时柱；cases.json 全部有时辰案例四柱 100% 一致。

- [ ] **T08 农历输入、闰月与非法日期（CAL-INPUT）** 【rules】
  依赖：T04
  内容：农历（含闰月）→ 公历；非法日期（农历小月三十、不存在的闰月、公历 2 月 30 日）返回错误码；提供「某年是否有闰月、闰几月」查询供表单使用。
  验收：C07（闰二月）正确；闰月、非法日期各至少 3 个用例；错误码有中文提示映射。

- [ ] **T09 起运与大运（CAL-YUN）** 【rules】
  依赖：T05, T07
  内容：阳男阴女顺、阴男阳女逆（年干以立春为界）；起运用 Sect2（按分钟折算）；8 步大运（干支、起止年份）；对外周岁、内部保留虚岁。
  验收：cases.json 全部案例 `dayun.direction`、`first3` 干支与起始年一致，`qiyun_date` ±1 天；顺 / 逆各 2 个手工用例。

- [ ] **T10 流年表与参考日期**
  依赖：T09
  内容：输入参考日期 `refDate`，从其所在干支年（立春为界）起连续 5 年：年份、干支、立春时刻、所在大运（跨两步时取立春当天所在）。
  验收：参考日期在立春前后各一个用例；同一出生信息、不同 refDate 输出不同起始年；流年年份与干支一一对应。

- [ ] **T11 三柱模式与交节日（CAL-NOHOUR）** 【rules】
  依赖：T07, T09
  内容：`time = null` 时只排三柱、时柱相关字段为 null、`hourKnown = false`；默认按 12:00 算年月柱和起运（「约 X 岁起运」标记）；出生日当天有节交接时输出 `uncertain.month_pillar` 与交节时刻；支持 `jieqiChoice = before / after / unsure`。
  验收：C18、C19 及至少 3 个「有时辰案例去掉时辰」用例：前三柱一致、时柱为空；C19 输出两组年月柱和交节时刻；before / after 分别得到对应年月柱。

- [ ] **T12 节气边界、权威节气抽查、lunar-javascript 差分**
  依赖：T07
  内容：① 1950–2050 年每个「节」前 / 后 1 分钟自动用例，断言月柱（立春含年柱）切换；② 香港天文台 / 紫金山天文台若干年份节气时刻固定数据（文件头注明来源 URL），误差 ≤ 1 分钟；③ lunar-javascript（devDependency，显式 `setSect(2)`）随机 ≥ 1,000 个时刻四柱比对，其中至少 100 个在 23:00–23:59。
  验收：三类测试全部通过；不一致样例为 0（若有，列出后停下交 mingli-expert / 用户）。

- [ ] **T13 Chart 输出定稿 + 确定性 / 快照 / 性能**
  依赖：T08, T10, T11, T12
  内容：Chart 用 Zod schema 定义并导出，字段按 calendar.md §9（`input_echo`、`clock_to_utc`、`true_solar_time`、`tst_status`、`jieqi_*`、`rules_hit`、`alt`、`uncertain`）；`engineVersion`；`computeChart(input, refDate)` 作为公开 API；快照测试；性能测试。
  验收：全部排盘测试通过；同输入两次深度相等；单次排盘 p95 < 20 ms。

## C 规则引擎（`packages/core/src/rules`，纯函数）—— 全部 【rules】

- [ ] **T14 规则注册表 + 编号覆盖测试 + 参数漂移测试**
  依赖：T13
  内容：`RuleHit { ruleId, text, evidence }`；规则注册表；测试扫描 rules/*.md 中 `CAL- / S- / Y- / SS- / R-` 编号，断言每个编号已实现或在「仅文档编号」白名单；解析 strength.md 中的 JSON 参数块（S-HIDE、位置权重）与代码常量比对；`rulesVersion`。
  验收：故意删掉一个实现或改一个藏干比例时测试变红。

- [ ] **T15 五行力量与十神分组（S-POWER / S-ROOT / S-COMBO）**
  依赖：T14
  内容：天干（无根 × 0.6）、地支藏干、三会 / 三合加成；十神分组力量；S；得令 / 得地 / 得势；`power_display_pct`（加日干 1.0 后归一）。
  验收：cases.json 全部案例 power、gods ±0.01，S ±0.001，de_* 一致。

- [ ] **T16 旺衰等级与特殊格局（S-LEVEL / S-CONG / S-ZHUANWANG）**
  依赖：T15
  内容：按顺序判定；从弱只认真从（5 条全满足）、子类型与并列优先级；专旺 / 从强；三柱不判特殊格局；borderline（距阈值 < 0.01）。
  验收：cases.json level、special、borderline 一致；**C03、C07（极弱但不满足真从）不判从格**；C14 从财；阈值两侧各一个构造用例。

- [ ] **T17 喜用神全链（Y-*）**
  依赖：T16
  内容：格局 → 扶抑（6 条）→ Y-SWAP → 调候（AGREE / NEUTRAL-OVERRIDE / ADD-XI）→ 通关（方向一致才采用）→ 闲神；`rules_hit` 与 `basis` 模板句。
  验收：yongshen.md §9 自检清单 6 条全部有测试；cases.json yong / xi / ji / xian 与 rules_hit_expected 一致（C12 互换、C16 调候覆盖、C01 调候一致）。

- [ ] **T18 三柱时辰扫描与置信度（S-NOHOUR）**
  依赖：T17, T11
  内容：13 个时柱（早子按当日、丑…亥、晚子按次日日干）补全后按四柱规则计算（允许从格）；`direction_agree / yong_agree / scan_slots`；置信度比例阈值；交节日另一组年月柱结论不同则置信「低」；从格时辰 notes。
  验收：C18（高）、C19（低，含晚子甲子时结论）与 cases.json 一致；扫描个数恒为 13。

- [ ] **T19 吉神（SS-*）**
  依赖：T13
  内容：天乙、月德、文昌、太极 4 张表；天乙 / 文昌 / 太极日干、年干兼查，月德按月支查天干；去重、`by` 合并（日干在前）、固定顺序；三柱不查时柱；交节日 + 不确定时 `jishen_display` 只取两组共有。
  验收：4 张表全量单元测试（10 干 × 12 支、12 支 × 10 干）；**解耦回归测试**（修改吉神输出不影响旺衰喜忌，反之亦然）；cases.json `shensha_ji` 比对结果进入 T21 清单（期望值为人工手算，不一致不在此任务内改）。

- [ ] **T20 大运 / 流年评分（R-YUN-SCORE / R-LN-SCORE）**
  依赖：T17, T10
  内容：五行分 v(e)；大运分、流年 self + relation（冲日支 −0.3、冲月支 −0.2、合日支 +0.2）+ 所在大运分；tier 与 tier_group；吉神不参与。
  验收：阈值边界用例；手算 2 个案例的大运、流年分数一致；评分函数的输入类型里没有吉神字段（类型层面保证）。

- [ ] **T21 cases.json 全量代码复核 → mingli-expert 裁定** 【rules】【需 mingli-expert】
  依赖：T07, T09, T15–T20
  内容：用代码跑 cases.json 全部字段，重点复核 v2 中**人工手算、未经代码核对**的数值：C05 的旺衰 / 喜用、C18 / C19 新增晚子时扫描结果、全部 19 个案例的 `shensha_ji`。输出差异清单（案例、字段、期望值、代码值、触发规则、计算过程）到 `reports/cases-diff.md`（不进 docs/）。**不得直接改期望值，也不得为了通过测试改代码**；清单交 mingli-expert 逐条裁定：期望值错 → 由 mingli-expert 改 cases.json 并在 verified 字段注明「代码复核」；代码错 → 回到对应任务修复。
  验收：四柱 100% 一致；旺衰 / 喜用一致率 ≥ 90%（P0-3），不一致逐条有结论；mingli-expert 裁定完成后 cases.json 全部测试通过、无跳过项。

## D 素材库工具链（`packages/core/src/texts` + `scripts/`，可与 B、C 并行）

- [ ] **T22 素材 schema、加载器、槽位注册表、字段字典** 【rules】
  依赖：T02
  内容：Zod schema（texts/README.md §2）；YAML 加载（AST 级检查，禁止锚点 / 别名 / 自定义 tag）；`slots.ts`（report-sections.md §3 全部槽位：必需、维度、修饰字段、选几条、字数、依据模板、润色、无时辰、顺序）+ 解析 md 表格行的比对测试；`fields.ts`（texts/README.md §3 字段、类型、取值域）。
  验收：rules/texts 两个样板文件加载通过；md 表格与 `slots.ts` 比对测试通过，故意改一个槽位 id 时变红。

- [ ] **T23 条件树求值器**
  依赖：T22
  内容：`all / any / not` 与 11 个叶子运算符；空值语义（null 时只有 `exists:false` 为真）；深度 ≤ 3；特异度计算；不 eval 字符串。
  验收：每个运算符真 / 假 / null 三种用例；深度超限报错；属性测试：`not(x)` 在非 null 时与 x 相反。

- [ ] **T24 素材 lint（L1–L6）**
  依赖：T22, T23
  内容：L1 schema / id 正则 / slot 存在；L2 when 字段范围与必需槽位维度限制；L3 占位符字段；L4 禁用词 / 疾病名 / 金融产品词（词表读 `rules/texts/wordlists/`，词表未就绪时先用 report-sections.md §7 的禁用词表）；L5 年份与干支字面；L6 五行与喜忌词 8 字窗口共现。`npm run texts:lint` 输出条目 id + 规则编号 + 原因。
  验收：每条规则一个违规样例 + 一个合规样例；样板 10 条的 lint 结果与预期一致（引文 `verified: false` 在 draft 状态下不报错）。

- [ ] **T25 素材 lint（L7–L12）**
  依赖：T24
  内容：L7 时柱用语需 `requires_hour`；L8 字数（占位符按典型长度计）与变体数；L9 「依据：」与术语后全角括号；L10 4-gram Jaccard ≤ 0.6（同槽位条目间、同条目变体间）；L11 approved 的 reviewer / quote.verified / edition；L12 绝对化用语与人称（「您」「命主」「大师」）。
  验收：每条规则违规 / 合规样例；全部 L1–L12 在 CI 中对 rules/texts 运行。

- [ ] **T26 批次清单与抽检脚本**
  依赖：T24
  内容：`rules/texts/batches.yaml` schema（ARCHITECTURE 4.3.8）；`texts:batch sample B1`：10% 向上取整、至少 5 条，种子 = 批次号 + 轮次；重抽换样本且必含上次不通过条目；`approve` 批量改 approved 并写 reviewer「用户（批次号、日期）」；`reject` 整批退回 draft。抽检单内容（触发案例、覆盖率表）在 T37 补全。
  验收：同一种子两次抽样结果相同；第二轮必含上轮不通过条目；approve / reject 对 YAML 的改动正确且不改动其他字段与格式。

## E 拼装引擎（`packages/core/src/report`）—— 全部 【rules】

- [ ] **T27 ctx 构造（一）：基础字段**
  依赖：T17, T18
  内容：`buildCtx` 的 profile、pillars、day、month、el、ten_gods（细分十神）、strength（direction、paradox、百分比取整）、gods（top_yidang / top_tongdang / top）、power_pct、yongshen（含 *_god、swap、th、tg）、`chart_key`。
  验收：C16 的 ctx 与 report-sections.md §0 示例结构一致（数值以代码为准）；ctx 通过 `fields.ts` 校验（字段与取值域）；ctx 中不含出生日期。

- [ ] **T28 ctx 构造（二）：大运 / 流年 / 关系 / 性格 / 领域 / 吉神字段**
  依赖：T27, T19, T20
  内容：dayun / liunian item（stem_ten_god、stem_god、tier、tier_group、stem_role、branch_role、relations、phase）；原局冲合 `relations`；`ten_gods.persona`（R-PERSONA 选取顺序，三柱不取时柱）；`career.mode`；`partner.role / pct`；`shensha` / `shensha_first`；三柱时 hour 字段为 null。
  验收：3 个案例 ctx 快照；三柱用例 hour 相关字段全为 null；persona 选取顺序有单元测试。

- [ ] **T29 槽位选段与变体确定性选择**
  依赖：T23, T22
  内容：texts/README.md §5.1 过滤与排序；fallback 与 `fallback_used` 事件；status 允许集合可配置；§5.2 变体选择（@noble/hashes SHA-256，前 8 字节大端 mod）与 occurrence 顺延；必需槽位缺兜底时抛启动期错误。
  验收：排序规则（priority → 特异度 → id）用例；同输入多次选择结果相同；循环槽位同条目第二次命中换变体；用固定向量测试哈希取模结果。

- [ ] **T30 占位符替换、术语首次加注、依据模板**
  依赖：T29
  内容：`{字段路径}`、`|名` 过滤器、列表「、」连接、百分比整数；无法解析的占位符使条目不可选；glossary 最长优先、全报告首次出现加注，不进表格 / 卡片标题 / 古籍原文 / 引号；槽位依据模板生成「依据：……」。
  验收：每种占位符用例；术语只加注一次；引文和表格内不加注；依据中的数值与 ctx 一致。

- [ ] **T31 章节拼装（一）：第 0–4 章与代码模板**
  依赖：T28, T30
  内容：按 slots 顺序拼第 1–4 章；代码模板：第 0 章命盘表 + 吉神小表（释义常量、固定灰字、无吉神整块不显示）、「未校正真太阳时」灰字、CH2-SUMMARY、CH3-PERSONA-LINE、CH4-TABLE（yongshen.md §7）、三柱缺失说明、置信「低」的「另一种可能」句；quote 输出规则（一章 ≤ 1 句、全报告 ≤ 5 句）；输出结构化 JSON（ARCHITECTURE 4.3.6）。
  验收：用 fixture 素材拼出 C01、C12、C14、C04 的第 0–4 章，结构与顺序正确；三柱用例替换条目生效；吉神只出现在第 0、3 章。

- [ ] **T32 章节拼装（二）：第 5–8 章与循环槽位**
  依赖：T31
  内容：第 5 章（INTRO、PAST 合述、当前步 / 下一步、REL、TRANSITION、FAR）；第 6 章 5 张逐年卡片（HEAD、四领域、DO、WATCH、REL；三柱不算冲时支）；第 7 章各槽位与固定就医提示；第 8 章固定文本（规则版本、子时口径、是否校正真太阳时、已知局限、免责）；`assembleReport` 公开 API。
  验收：卡片年份 / 干支与 Chart 流年表逐一相等；同条目跨年重复命中时变体不同；三柱用例无「冲时支」。

- [ ] **T33 R-CHECK 成品检查**
  依赖：T32
  内容：年份 / 干支 ⊆ ctx；五行喜忌关键词窗口不与 yongshen 冲突；章节与全文字数（三柱下限放宽）；依据存在性；禁用词 / 疾病名 / 金融词；同报告段落相似度 ≤ 0.5；返回检查结果（生产告警放行 / 测试失败，见 ARCHITECTURE 4.3.7）。
  验收：构造错误年份、冲突五行、超字数、含禁用词、重复段落样例都能被检出；合法样例通过。

- [ ] **T34 覆盖率测试（静态穷举）**
  依赖：T29, T22
  内容：按 slots 维度穷举组合（修饰字段默认值），检查非兜底 approved（或配置的状态集合）条目命中；「不可能组合」声明机制（需写理由，mingli-expert 认可）；兜底条目唯一性；输出缺口清单（槽位 + 组合）；按批次强制：已批准批次的章节缺口 = 失败，其余只报告。
  验收：fixture 素材上缺口清单正确；故意删一条素材后对应组合出现在清单中；强制范围可由 batches.yaml 推导。

- [ ] **T35 覆盖率测试（动态抽样）+ 字数分布**
  依赖：T33, T34
  内容：cases.json 全部案例 + 随机 10,000 个出生时刻（1940–2030，男女各半，10% 无时辰）+ 有时辰案例去掉时柱，跑完整拼装：兜底命中数、字数达标比例（≥ 99%）、R-CHECK、**when 成立而 asserts 不成立的素材缺陷**；输出标准案例字数分布表（供 QA_REPORT）。
  验收：报告输出四项指标；故意写一条 asserts 与 when 不一致的 fixture 素材时被报出；随机种子固定、结果可复现；运行时间 < 3 分钟。

- [ ] **T36 确定性、性能、润色接口（默认关闭）**
  依赖：T32
  内容：同输入两次报告 JSON 逐字相等的测试；cases.json 全部案例拼装 p95 < 200 ms；`Polisher` 接口 + `NoopPolisher`；`REPORT_POLISH_ENABLED` 默认 false，设为 true 但无实现时报错；测试中把 fetch / http 替换为抛错桩，验证关闭状态零外部调用。
  验收：三项测试通过（P0-7 「逐字一致」「关闭时不产生外部 AI 调用」）。

- [ ] **T37 预览报告与抽检单生成**
  依赖：T26, T35
  内容：`texts:preview`：cases.json 全部案例生成完整报告 HTML（本地输出目录，不提交）；抽检单：被抽条目全部变体 + 能触发它的 cases.json 案例（及该案例报告片段）+ 本批覆盖率表 + lint 结果（PRD 9.3 建议）。
  验收：对样板批次生成可读的抽检单；预览 HTML 在手机宽度下可读。

- [ ] **T38 素材发布脚本与服务端快照加载**
  依赖：T25, T35
  内容：`texts:release`：只收 approved、lint 全过、静态 + 动态覆盖率 100%，`texts_version` + 1，生成 `apps/web/texts-releases/v{N}.json`，与上一快照比对（approved 条目只许追加变体），提示打 tag `texts-v{N}`；`apps/web/server/texts-store.ts` 启动时加载全部快照并校验（必需槽位有兜底、生产只含 approved）；开发模式可直接加载 rules/texts 工作区（`texts_version = dev`）。
  验收：用 fixture 素材走一遍发布；删除已批准条目的变体时发布失败；启动校验失败时进程退出并给出原因。

## F 出生信息与订单

- [ ] **T39 出生信息载荷编解码**
  依赖：T08, T11
  内容：`core/birth`：载荷 v1 字段（ARCHITECTURE 4.4）、Zod 校验、canonical 序列化、Base64url 编解码、长度上限；错误只返回错误码，不回显输入。
  验收：往返测试（属性测试 1,000 次）；同义不同写法 canonical 相同；非法载荷返回错误码且错误对象中不含输入片段。

- [ ] **T40 出生地经纬度与时区表**
  依赖：T06
  内容：区县级行政区划代码 → 经度（0.01°）+ IANA 时区，另加常用海外城市；**核实数据来源与许可证并写在文件头**（许可证不明确的数据不用）；搜索接口（按名称 / 拼音前缀）供表单使用；代码只增不删的测试（与上一版本比对）。
  验收：覆盖全部省级、地级、区县级单位（数量与来源一致）；抽查 10 个城市经度误差 ≤ 0.05°；许可证说明存在。

- [ ] **T41 指纹 HMAC、日志与错误码**
  依赖：T39
  内容：`apps/web/server/birth-fp.ts`（HMAC-SHA256、`fp_key_id`、timingSafeEqual）；`server/log.ts`（pino、redact 列表、禁止记录请求体）；统一错误处理：Zod 错误映射为错误码后再记录；API 错误响应格式。
  验收：指纹固定向量测试；Zod 校验失败时日志中不出现输入值（测试捕获日志断言）；改动一个字符载荷指纹不同。

- [ ] **T42 SQLite + Drizzle 订单表与状态机**
  依赖：T02
  内容：`orders` 表（ARCHITECTURE 5.1）与迁移；WAL；订单号 128 位随机 base62；状态机集中校验；幂等置 paid（金额必须 990）；**列名白名单测试**。
  验收：合法 / 非法迁移全覆盖；重复置 paid 只生效一次；金额不符拒绝；订单号熵测试；列名集合与白名单完全相等。

## G 免费流程

- [ ] **T43 免费排盘 API `POST /api/chart`**
  依赖：T18, T30, T39, T41
  内容：解析载荷 → 排盘 → 规则 → free.yaml 模板（尚未写好时用 fixture）→ 返回 4 个模块数据（四柱 + 藏干十神、五行强弱图数据、旺衰、喜用忌、未校正 / 置信度 / 交节提示）；按 IP 简单限流（内存）；不落库、不记请求体。
  验收：接口测试通过；返回数据中**没有**性格画像、吉神、大运年份（字段白名单测试）；本地 p95 < 150 ms。

- [ ] **T44 首页表单** 【UI】
  依赖：T43, T40
  内容：公历 / 农历切换、年月日、时辰（含「不知道时辰」）、性别、可选出生地（搜索）；闰月下拉按年份出现；夏令时不存在时刻提示；新疆城市提示「请填北京时间」；生成载荷后跳 `/result#<载荷>`。
  验收：Playwright（iPhone 视口）10 秒内可填完提交；闰月、23:00–01:00、不知道时辰都能提交；非法日期有提示；URL 中出生信息只出现在 `#` 之后。

- [ ] **T45 免费结果页** 【UI】
  依赖：T44
  内容：从片段取载荷 POST；四柱（未校正灰字 / 真太阳时说明）、五行强弱 SVG 图（标日主、同党 / 异党比例）、旺衰一句话、喜用 / 忌神（置信度灰字）；交节日「之前 / 之后 / 不确定」选择；付费按钮「¥9.9 查看完整报告」，无时辰时按钮旁显示缺失说明；电脑端限宽居中。
  验收：页面元素检查：除上述模块外无性格、吉神、神煞文字（P0-4）；无时辰时缺失说明一定显示；无横向滚动；刷新后结果不变。

- [ ] **T46 免责声明、隐私说明页**
  依赖：T45
  内容：页脚免责组件（首页、结果页、报告页）；`/privacy` 按 ARCHITECTURE 第 7 节逐项列出服务器保存的字段、链接只编码未加密的说明、链接丢失无法找回的说明；`/disclaimer`。
  验收：三类页面底部都有声明（E2E 断言）；隐私页字段清单与 `orders` 白名单一致（测试比对）。

## H 支付（先 mock，真实渠道联调放后）

- [ ] **T47 支付抽象 + mock 渠道 + 订单 API**
  依赖：T42, T41, T43
  内容：`PaymentProvider` 接口；mock 实现（模拟支付页 + 模拟回调）；`POST /api/orders`（规范化 → 排盘校验 → 指纹 → 建单，texts_version 取当前发布版）、`GET /api/orders/:no/status`（10 秒未回调时主动查单）、`POST /api/pay/notify/:channel`（幂等）。下单参数中不含出生信息。
  验收：mock 全流程走通；重复回调只处理一次；下单请求发给渠道的参数里搜不到出生信息（测试断言）。

- [ ] **T48 环境识别与前端支付流程** 【UI】
  依赖：T47, T45
  内容：UA 识别微信内 / 其他手机浏览器 / 电脑，按 ARCHITECTURE 8.2 展示支付方式；`localStorage['pending:'+订单号]` 保存载荷；`/pay/done` 返回页；轮询状态后跳 `/r/<订单号>#<载荷>`；微信内选支付宝时引导「在浏览器打开」。
  验收：三种 UA 的 E2E 显示正确的支付方式；mock 支付后自动到达报告页；`/pay/done` 的 URL 中无出生信息。

- [ ] **T49 微信网页授权 openid + JSAPI 下单** 【需你：U02、U04、U05】
  依赖：T48
  内容：`snsapi_base` 静默授权（redirect_uri / state 不带出生信息）、`/api/wx/oauth` 换 openid → 短期签名 Cookie（不入库）；APIv3 JSAPI 下单、签名、前端 `WeixinJSBridge` 调起；私钥只从环境变量读取。
  验收：签名算法用官方文档示例数据单元测试通过；Cookie 签名校验测试；**真实环境联调前停下问你**。

- [ ] **T50 微信回调、查单、关单、Native 扫码** 【需你：U05】
  依赖：T49
  内容：回调验签 + AES-GCM 解密；查单兜底；关单；电脑端 Native 二维码。
  验收：官方示例报文的验签 / 解密单测通过；关单调用有测试；真实联调前停下问你。

- [ ] **T51 支付宝手机网站 + 电脑网站支付** 【沙箱不需要你；生产需你：U06】
  依赖：T47
  内容：官方 `alipay-sdk`；WAP / 电脑网站下单、return_url（`/pay/done?o=`）、异步通知验签、查单、关单；先在支付宝沙箱跑通。
  验收：沙箱完整走通下单 → 通知 → 订单 paid；return_url 中无出生信息。

- [ ] **T52 订单维护任务与退款标记脚本**
  依赖：T47
  内容：进程内定时器：关闭 30 分钟未付订单（调渠道关单）、删除 7 天前未付 / 已关闭订单；`npm run order:refund -- <订单号> "<原因>"`（paid → refunded，记录原因）；`npm run order:show -- <订单号>`。
  验收：时间模拟测试；非 paid 订单不能标记退款；脚本输出中不含指纹以外的个人信息。

## I 报告页

- [ ] **T53 报告 API `POST /api/report`**
  依赖：T47, T32, T33, T38
  内容：按订单号限流（失败 ≥ 20 次 / 小时锁定）；订单不存在 / 未付 / 已退款 / 指纹不符统一返回「链接无效或订单未支付」；参考日期 = 订单创建时间；按订单 `texts_version` 取快照拼装；R-CHECK 不通过告警放行；`Cache-Control: no-store`。
  验收：篡改载荷 → 拒绝；未付款 → 拒绝；同一订单不同时间请求返回逐字相同的报告；服务端 p95 < 400 ms。

- [ ] **T54 报告页框架** 【UI】
  依赖：T53
  内容：`/r/[orderNo]` 静态外壳，前端读 hash 后 POST；章节、段落、依据小字、古籍引文样式；顶部常驻「链接丢失无法找回，请收藏或保存长图」「链接含出生信息（仅编码、未加密），请勿公开分享」；页面内**无任何追加付费按钮**；免责页脚。
  验收：关闭浏览器后用链接可重新打开；换浏览器可打开；无横向滚动；两条提示在首屏可见。

- [ ] **T55 第 0 章命盘表与图 1 五行力量图** 【UI】
  依赖：T54
  内容：命盘表（四柱、十神、藏干、时柱「未知」）、真太阳时说明 / 未校正灰字、吉神小表；五行 SVG 组件（与免费页复用）。
  验收：iPhone SE 宽度完整显示；数据完全来自报告 JSON（组件快照测试）；无吉神时整块不显示。

- [ ] **T56 图 2 大运时间轴、图 3 流年趋势线、逐年卡片** 【UI】
  依赖：T54
  内容：8 步大运时间轴（标当前步、换运年）；5 年流年趋势线（tier）；5 张逐年卡片（年份、干支、立春时刻、十神、tier、四领域、适合做、留意、冲合）。
  验收：卡片年份 / 干支与报告 JSON 一致（断言）；三柱模式正常显示；手机端无横向滚动。

- [ ] **T57 长图预研**
  依赖：T55, T56
  内容：在 iOS Safari、Android 微信内置浏览器、iOS 微信内置浏览器实测 modern-screenshot 与 html2canvas：完整报告能否生成、canvas 尺寸上限（未核实）、耗时、SVG 与文字清晰度；确定方案（单张 / 降分辨率 / 分 2～3 张）。结论写在本任务的 commit 说明和代码注释中。
  验收：给出选定方案和三种环境的实测结果；若需分张，取得用户同意后再进入 T58。

- [ ] **T58 一键保存长图**
  依赖：T57
  内容：按预研方案实现：生成图片 → 微信内显示 `<img>` 浮层提示「长按保存到相册」，其他浏览器提供下载；包含全部章节和图表；全程在用户端完成，不上传服务器。
  验收：iOS Safari、Android 微信内置浏览器都能生成并保存（人工验收清单交 QA）；网络面板确认生成过程无上传请求。

## J 隐私、安全与上线准备

- [ ] **T59 安全响应头与 CSP**
  依赖：T54
  内容：CSP（`script-src 'self'`、`connect-src 'self'` + 支付所需域名、`frame-ancestors 'none'`）；`Referrer-Policy: no-referrer`；`/r/*` 加 `X-Robots-Tag: noindex`；检查全站无第三方脚本。
  验收：E2E 断言响应头；构建产物扫描无外部脚本地址。

- [ ] **T60 日志不含出生信息的哨兵测试**
  依赖：T41, T53, T47
  内容：用特征出生信息跑免费、下单、mock 支付、打开报告、篡改链接、非法输入全流程，收集应用 stdout / stderr（Docker 环境下另含 Caddy 日志，T61 后补上），搜索日期多种写法、载荷全串及任意 16 字符子串、canonical 串。
  验收：零命中；故意在某处 `log(payload)` 时测试变红（P0-10）。

- [ ] **T61 Docker 化**
  依赖：T53
  内容：多阶段 Dockerfile（workspaces、standalone、better-sqlite3 原生模块）；docker-compose：web、caddy（按 ARCHITECTURE 6.4 配置日志格式）、backup；SQLite 数据卷；健康检查；启动时校验 `.env` 与素材快照。
  验收：`docker compose up` 本地跑通 mock 支付全流程；T60 在 Docker 环境下（含 Caddy 日志）通过。

- [ ] **T62 SQLite 备份到 COS + 恢复演练脚本**
  依赖：T61
  内容：backup 容器每 10 分钟在线备份 → gzip → 上传 S3 兼容存储（本地用 MinIO 测试，生产为腾讯云 COS），保留 30 天 + 每日长期快照；`npm run db:restore` 恢复脚本；灾备补单流程（ARCHITECTURE 5.2）的脚本骨架。
  验收：本地 MinIO 上完成「备份 → 删库 → 恢复」演练，订单数据一致；COS 实际接入放在部署阶段（需 U03 后的云账号，【付费】）。

- [ ] **T63 CI 门禁完善**
  依赖：T61, T35, T25
  内容：CI 中强制：全部单元测试、cases.json 对照、素材 lint、按批次的覆盖率门禁、日志哨兵测试；构建后扫描客户端 bundle 不含素材正文特征串（防素材泄露）；测试全部通过才构建镜像。
  验收：故意让一个排盘测试失败或在客户端组件 import 素材时，不会构建镜像。

- [ ] **T64 端到端测试（手机 + 电脑）**
  依赖：T58, T48, T46, T59
  内容：Playwright：iPhone Safari 视口、Android 微信 UA、桌面 Chrome；首页 → 免费结果 → mock 支付 → 报告页 → 生成长图；检查免责声明、无追加付费按钮、无横向滚动、两条链接提示。
  验收：全部 E2E 通过；真实微信内置浏览器的人工验收清单交 QA。

- [ ] **T65 运营统计脚本**
  依赖：T61
  内容：`npm run stats`：按天统计订单创建 / 支付 / 退款数（数据库）、免费排盘次数（从 Caddy 访问日志计 `POST /api/chart`）、转化率、`fallback_used` / `rcheck_failed` 次数（应用日志）；异常时推送企业微信机器人（webhook 用 mock 测试）。
  验收：测试数据上统计正确；输出中无任何出生信息或指纹。

> 生产部署（服务器、域名、COS、正式支付参数）由 devops 在下一阶段写进 docs/DEPLOY.md，【付费】【需你】，不在本清单内。

---

## K 素材撰写（mingli-expert，并行；不阻塞 T 组）

每个 K 任务：按 texts/README.md 写 YAML（status: draft），提交前跑 `texts:lint`（T24 / T25 完成后）与覆盖率（T34 / T35 完成后；之前按 report-sections.md §5.2 的组合表自查）。每条 2～3 个变体。

| 任务 | 内容 | 约条目 | 依赖 |
|---|---|---|---|
| K01 | 词表与术语表：`wordlists/`（禁用词、疾病名词、金融产品词）、`glossary.yaml` | — | 无（**建议最先做**，T24 需要） |
| K02 | 第 1 章：CH1-DAYMASTER（10）、CH1-MONTH（25）、CH1-QUOTE（约 6） | 约 41 | 无 |
| K03 | 第 1 章：CH1-BALANCE（含 special、paradox）、CH1-CONCLUSION（含 borderline / 无时辰 / 置信度条目）、本章兜底 | 约 30 | 无 |
| K04 | 第 2 章全部槽位（METHOD 12 + 置信低、SWAP、TIAOHOU、TONGGUAN、ROLE-YONG / XI / JI 15、NOHOUR-CONG）+ 兜底 | 约 45 | 无 |
| K05 | 第 6 章 CH6-HEAD（10 十神 × 5 tier） | 约 50 | 无 |
| K06 | 第 6 章四领域 CH6-CAREER / WEALTH / LOVE / HEALTH（各 15） | 约 60 | 无 |
| K07 | 第 6 章 CH6-DO、CH6-WATCH（各 15）、CH6-REL（4）+ 兜底 | 约 36 | 无 |
| K08 | **第 1 批提交**：lint + 覆盖率全过 → 按 report-sections.md §10 自审 → 改 reviewed → `texts:batch sample B1` 生成抽检单 → 交你抽检（U09） | 约 260 | K01–K07，T25，T34，T35，T37 |
| K09 | 第 3 章（BASE 10、GOD 20、STYLE 6、TALENT 10、SHENSHA 4）+ 兜底 | 约 52 | 无 |
| K10 | 第 5 章 CH5-STEP（10 十神 × 5 tier） | 约 50 | 无 |
| K11 | 第 5 章其余（INTRO、PAST、REL、TRANSITION、FAR）+ 兜底 | 约 14 | 无 |
| K12 | 第 7 章全部槽位 + 兜底 | 约 60 | 无 |
| K13 | **第 2 批提交**（同 K08 流程） | 约 180 | K09–K12，K08 |
| K14 | 第 4 章（WHY 20、ELEMENT 10、NOTE）、免费页 `free.yaml`、第 8 章固定文本、其余兜底 | 约 60 | 无 |
| K15 | **第 3 批提交** + 全库古籍引文逐字对照底本（`verified: true`、填写 `edition`） | 约 60 | K14，K13 |

上线前提：B1、B2、B3 全部 approved，全部引文 verified，T38 `texts:release` 成功。

---

## U 你的线下事项（越早启动越好，不阻塞开发，但阻塞上线）

| 编号 | 事项 | 阻塞的任务 / 环节 |
|---|---|---|
| U01 | **先咨询**：微信支付、支付宝、备案服务商对「八字 / 传统文化分析」的可用类目；是否需要经营性 ICP 许可证；生成式 AI 登记是否适用（大概率不适用） | 决定整体能否收款，建议开发同时立刻做 |
| U02 | 办理个体工商户营业执照（可选开对公账户） | U03–U06 |
| U03 | 网站定名（PRD 9.3）→ 购买域名（实名）→ 腾讯云购买轻量服务器 → ICP 备案（之后 30 日内公安备案） | T49、T50 联调；生产部署 |
| U04 | 注册微信服务号（主体个体户）并完成微信认证 | T49 |
| U05 | 申请微信支付商户号（JSAPI + Native），绑定服务号，配置授权目录与 APIv3 密钥；咨询 H5 支付 | T49、T50 联调 |
| U06 | 支付宝开放平台：签约手机网站支付、电脑网站支付，创建应用配置密钥 | T51 生产联调（沙箱不需要） |
| U07 | 开通腾讯云 COS 存储桶（备份用） | T62 生产接入 |
| U08 | 拍板 ARCHITECTURE 第 13 节待确认项（R-CHECK 阻断 / 放行、退款后链接是否失效） | T33、T52、T53 |
| U09 | 每批素材随机抽检 10%（至少 5 条），在抽检单上给出通过 / 不通过与意见 | K08 / K13 / K15 之后批次批准；上线 |

---

## 关键路径

T01 → T02 → T03 → T04 → T05 → T06 → T07 → T09 → T11 → T13 → T14 → T15 → T16 → T17 → T18 → T27 → T28 → T31 → T32 → T33 → T53 → T54 → T56 → T57 → T58 → T64

并行线：
- **素材工具链** T22 → T23 → T24 → T25 / T26 可在 T02 之后与排盘同时进行；
- 订单与载荷 T39–T42 可在排盘后半段穿插；
- 真实支付 T49–T51 等你办好 U03–U06 后再做，之前全部 mock；
- 素材撰写 K 组全程并行；**上线时间实际由 K 组三批抽检通过的时间和 U 组手续决定**。

任务数：开发 65 个（T01–T65）、素材 15 个（K01–K15）、你的事项 9 项（U01–U09）。
