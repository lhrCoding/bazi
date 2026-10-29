# rules/texts/ —— 付费报告素材库规范 v1

> 版本：v1（2026-10-29，mingli-expert）
> 配套：report-sections.md（v2）定义“报告由哪些槽位组成、怎么拼”；本文件定义“素材长什么样、怎么被选中、怎么校验”。
> 一句话：**报告里的每一段文字都来自这里的某一条已审核素材的某一个变体，加上由代码填入的数据占位符。** 运行时不生成任何新句子（可选润色接口除外，默认关闭）。

---

## 1. 目录结构

```
rules/texts/
  README.md              本规范
  free.yaml              免费结果页模板（只含四柱、五行图、旺衰、喜忌 4 个模块；1 变体、无分支）
  batches.yaml           批次清单（批次号、条目 id、抽检样本、结果；见 §9）
  ch01_strength.yaml     第 1 章 日主与旺衰          ← 本轮已给样板
  ch02_yongshen.yaml     第 2 章 喜用神详解          ← 本轮已给样板
  ch03_persona.yaml      第 3 章 性格与天赋
  ch04_advice.yaml       第 4 章 行业/颜色/方位/数字
  ch05_dayun.yaml        第 5 章 十年大运
  ch06_liunian.yaml      第 6 章 未来 5 年逐年
  ch07_domains.yaml      第 7 章 分领域
  ch08_fixed.yaml        第 8 章 方法说明与免责声明
  glossary.yaml          术语首次出现自动加注表（§8）
  wordlists/             禁用词、疾病名词、金融产品词（lint 用）
```
- 文件格式：YAML（UTF-8，2 空格缩进）。一个文件是一个条目数组。只用 YAML 的标准子集：不用锚点 / 别名 / 自定义 tag。
- 一个文件可以放多个槽位的条目；槽位以条目的 `slot` 字段为准，文件名只是分组习惯。
- 素材库整体有版本号（`texts_version`，写在 ch08_fixed.yaml 的方法说明里），每次发版 +1。

---

## 2. 条目格式（schema）

```yaml
- id: CH2-METHOD-W-SHA            # 必填。全库唯一；建议 = 槽位 + 触发组合简写；发布后不得改名（变体选择依赖它）
  slot: CH2-METHOD                # 必填。必须是 report-sections.md §3 表格中的槽位 id
  when:                           # 必填。触发条件（§4）；兜底条目写 {}
    all:
      - {f: yongshen.fy_rule, eq: Y-FY-W-SHA}
  asserts: []                     # 选填。正文字面依赖的事实（§4.2）；运行时也会检查
  priority: 50                    # 必填。0–100。普通条目 50；特殊情形（从格、得令却身弱等）80；兜底 0
  fallback: false                 # 选填。true = 兜底条目（每个必需槽位恰好 1 条）
  requires_hour: false            # 选填。true = 内容涉及时柱，三柱时不可选
  length: [150, 230]              # 必填。每个变体的字数区间（汉字 + 标点，占位符按 §3.3 典型长度计）
  polish_allowed: true            # 选填，默认取槽位设置；槽位为“否”时此处不得为 true
  quote:                          # 选填。古籍原文（§6），最多 1 句
    text: "……"
    source: "《书名·篇名》"
    verified: false               # 已对照底本逐字核对 → true；approved 条目必须为 true
    edition: ""                   # 核对所用底本（如“四库全书本”），verified=true 时必填
  variants:                       # 必填。2–3 个（兜底与固定文本可以 1 个）
    - "……{占位符}……"
    - "……"
  status: draft                   # 必填。draft / reviewed / approved / retired（§9）
  author: mingli-expert           # 必填
  reviewer: null                  # approved 时必填
  updated: 2026-10-29             # 必填
  notes: ""                       # 选填。写给审核人的说明（为什么这么写、有无争议），不会出现在报告里
```

字段约束：
- `id`：只用大写字母、数字、连字符；正则 `^CH\d-[A-Z0-9-]+$`（免费页用 `FREE-`）。
- `variants` 中的文本是**一段**（不含换行）；需要分段就拆成两个槽位，不在变体里塞多段。
- 正文中不写“依据：”——依据由槽位的依据模板生成。
- 正文中不手写术语解释括号（如“七杀（压力）”），由引擎按 glossary 首次出现自动加注。

---

## 3. 可用字段字典（触发条件与占位符共用）

只能引用下表字段。字段由代码从排盘 / 规则结果算出，定义见 report-sections.md §0。表中“域”是覆盖率测试穷举时使用的取值集合。

### 3.1 全局字段
| 字段 | 类型 | 域 / 说明 |
|---|---|---|
| profile.gender | 枚举 | 男、女 |
| profile.time_known | 布尔 | 是否有时辰 |
| profile.confidence | 枚举 | 高、中、低（有时辰时恒为“高”） |
| profile.current_age | 整数 | 周岁 |
| profile.tst_status | 枚举 | 已校正、未校正 |
| profile.uncertain_year_month | 布尔 | 交节日无时辰且用户选“不确定” |
| day.stem | 枚举 | 甲乙丙丁戊己庚辛壬癸 |
| day.element | 枚举 | 木火土金水 |
| day.yinyang | 枚举 | 阳、阴 |
| month.branch | 枚举 | 十二地支 |
| month.season | 枚举 | 春（寅卯辰）、夏（巳午未）、秋（申酉戌）、冬（亥子丑） |
| month.main_qi | 枚举 | 月支本气天干 |
| month.main_god | 枚举 | 月支本气对日主的十神组：比劫、印、食伤、财、官杀 |
| el.比劫 / el.印 / el.食伤 / el.财 / el.官杀 | 枚举 | 各十神组对应的五行（恒有值） |
| ten_gods.year_stem / month_stem / hour_stem | 枚举 | 十神细分（10 种）；hour_* 三柱时为 null |
| ten_gods.year_branch / month_branch / day_branch / hour_branch | 枚举 | 地支本气的十神细分 |
| ten_gods.persona | 列表 | report-sections.md §6 选出的 2 个十神 |
| strength.level | 枚举 | 身弱、中和偏弱、中和偏旺、身旺、从弱、从强 |
| strength.direction | 枚举 | 偏弱、偏旺 |
| strength.special | 枚举 / null | 从财、从杀、从儿、从势、专旺、从强、null |
| strength.borderline | 布尔 | |
| strength.paradox | 枚举 / null | 得令却身弱、失令却身旺、null |
| strength.S_pct / strength.yidang_pct | 整数 | 同党 / 异党百分比 |
| strength.de_ling / de_di | 布尔 | |
| strength.de_shi | 整数 | 0–3 |
| gods.比劫_pct … gods.官杀_pct | 整数 | 五个十神组的百分比 |
| gods.top_yidang / gods.top_tongdang / gods.top | 枚举 | 异党最强组（食伤 / 财 / 官杀）、同党较强组（比劫 / 印）、全盘最强组 |
| gods.top_yidang_pct / gods.top_tongdang_pct | 整数 | 上述两组的百分比 |
| power_pct.木 … power_pct.水 | 整数 | 五行百分比（不含日干） |
| yongshen.yong / xi1 / ji1 | 枚举 | 五行 |
| yongshen.xi / ji / xian | 列表 | 五行列表 |
| yongshen.favorable | 列表 | 用神 + 全部喜神（便于写“有利”断言） |
| yongshen.yong_god / xi1_god / ji1_god | 枚举 | 对应的十神组 |
| yongshen.fy_rule | 枚举 | Y-FY-W-SHA、Y-FY-W-SHI、Y-FY-W-CAI、Y-FY-S-YIN、Y-FY-S-BI-GUAN、Y-FY-S-BI-SHI、Y-CONG、Y-ZHUANWANG |
| yongshen.swap | 布尔 | 是否触发 Y-SWAP |
| yongshen.swap_from / swap_to | 枚举 / null | 互换前的用神五行、互换后的用神五行 |
| yongshen.swap_from_god / swap_to_god | 枚举 / null | 对应十神组 |
| yongshen.th | 枚举 / null | AGREE、NEUTRAL-OVERRIDE、ADD-XI、null |
| yongshen.th_element | 枚举 / null | 调候所需五行（冬火、夏水） |
| yongshen.tg / tg_element | 布尔 / 枚举 | 通关是否采用、通关五行 |
| career.mode | 枚举 | 官杀、食伤、印、比劫、财 |
| partner.role | 枚举 | 伴侣星（男财、女官杀）在喜忌中的角色：用、喜、忌、闲 |
| partner.pct | 整数 | 伴侣星百分比 |
| relations | 列表 | 原局冲合，元素 {type, a, b} |
| shensha | 列表 | 吉神名称列表（shensha.md），只用于 CH0、CH3-SHENSHA |
| shensha_first | 枚举 / null | 按固定顺序的第一个吉神 |

### 3.2 循环槽位的 item 字段（CH3-GOD、CH4-ELEMENT、CH5-STEP、CH6-* 等）
| 字段 | 说明 |
|---|---|
| item.ganzhi / item.year / item.start_year / item.end_year | 干支与年份（年份只能通过占位符出现） |
| item.stem_ten_god | 天干十神细分（10） |
| item.stem_god | 天干十神组（5） |
| item.tier / item.tier_group | 评分档位（5）/ 档位组（好 / 平 / 守） |
| item.stem_role / item.branch_role | 用 / 喜 / 忌 / 闲 |
| item.relations | 与原局的冲合 |
| item.phase | past / current / next / far（大运） |
| item.ten_god / item.god / item.is_favorable | CH3-GOD 用：该十神、其组、该组是否在用喜中 |
| item.element / item.role | CH4-ELEMENT 用：五行、角色（用 / 喜） |

### 3.3 占位符
- 写法：`{字段路径}`，如 `{day.stem}`、`{gods.官杀_pct}`、`{el.印}`、`{item.ganzhi}`。
- 列表字段自动用“、”连接（`{yongshen.ji}` → “土、金”）。
- 十神组字段的值是数据名（比劫、印、食伤、财、官杀）。正文里要显示成读者看的名字时加 `|名` 过滤器：`{gods.top_yidang|名}` → 比劫、印星、食伤、财星、官杀。素材正文里手写十神组时，也统一用“印星”“财星”（单字“印”“财”容易与普通词混淆，术语加注也无法可靠匹配）。
- 百分比字段只输出整数，`%` 由作者自己写在占位符后面：“占 {gods.财_pct}%”。
- 年份只能来自 `item.*year*` 占位符；素材里不得手写数字年份。
- **无法解析的占位符**（字段为 null、不存在）→ 该条目视为不可选，而不是输出空白。
- 字数估算时占位符按典型长度计：干支 / 五行组合 2 字，百分比 3 字，十神 2 字，列表 4 字。

---

## 4. 触发条件（when）与组合规则

### 4.1 语法
条件是一棵 JSON/YAML 树，不是字符串表达式（不 eval，杜绝注入与歧义）：
```yaml
when:
  all:                                        # 全部成立
    - {f: strength.direction, eq: 偏弱}
    - {f: gods.top_yidang, in: [官杀, 食伤]}
    - any:                                    # 任一成立
        - {f: month.season, eq: 冬}
        - {f: power_pct.火, lt: 10}
    - not: {f: strength.special, exists: true}
```
叶子运算符：
| 运算符 | 含义 | 适用类型 |
|---|---|---|
| eq / ne | 等于 / 不等于 | 标量 |
| in / not_in | 属于 / 不属于给定列表 | 标量 |
| contains / not_contains | 列表字段包含某值 | 列表 |
| gte / gt / lte / lt | 数值比较 | 整数 |
| exists | 字段非 null（true）/ 为 null（false） | 任意 |

组合子：`all`（与）、`any`（或）、`not`（非），可嵌套，深度 ≤ 3。空条件 `{}` 恒为真（只允许兜底条目使用）。

### 4.2 asserts（正文事实断言）
- 凡正文里**直接写出**而非通过占位符给出的事实（五行字、干支字、“你喜火”“原局没有金”之类），必须在 `asserts` 里用同样语法写明。
- 运行时：`when` 与 `asserts` 都成立才可选。
- 测试：若某组合下 `when` 成立而 `asserts` 不成立，报告为**素材缺陷**（说明作者写了触发条件保证不了的事），覆盖率测试失败。
- 例：调候条目写了“命局里火很少”，就需要 `asserts: [{f: yongshen.th_element, eq: 火}]`。

### 4.3 空值语义
- 字段为 null 时：`eq/in/contains/gte...` 一律为假；`ne/not_in/not_contains` 也为假（避免“null ≠ 甲 → 真”误触发）；只有 `exists: false` 为真。
- 三柱时 hour 相关字段为 null，引用它们的条件自然不成立，这就是槽位降级的实现方式（report-sections.md §4）。

### 4.4 维度与修饰字段（覆盖率可测试的前提）
- 每个必需槽位在 report-sections.md §3 声明“维度”字段；另可声明“修饰字段”（如 strength.borderline、profile.time_known、profile.confidence）。
- 该槽位素材的 `when` **只能**引用维度字段和修饰字段（lint 检查）。这样覆盖率测试只需穷举维度取值、修饰字段取默认值（borderline=false、time_known=true、confidence=高）即可判定是否覆盖完整。
- 非必需槽位不受此限，但同样建议只用少量字段。

---

## 5. 选择算法（确定性）

### 5.1 单个槽位
```
候选 = 该槽位全部条目
     过滤 status ∈ 允许集合（生产：approved；预览环境：approved + reviewed）
     过滤 when 成立 且 asserts 成立
     过滤 requires_hour=false 或 profile.time_known=true
     过滤 全部占位符可解析
排序 = priority 降序 → 特异度降序（when 中叶子条件个数）→ id 升序
取前 k 条（k = 槽位“选几条”）
候选为空：用该槽位兜底条目；必需槽位没有兜底 = 构建期错误（启动时校验，不会拖到运行时）
```

### 5.2 变体选择
```
h   = SHA-256( UTF-8( chart_key + "|" + entry_id + "|" + occurrence ) )
idx = (h 的前 8 字节按大端解释为无符号整数) mod 变体个数
```
- `chart_key` = 四柱干支拼接（无时辰用 `--`）+ `|` + 性别 + `|` + time_known（1/0），由代码生成，例 `癸酉乙丑乙未己卯|女|1`。不含出生日期时间，所以四柱、性别相同的人拿到完全相同的报告文字（这是有意的：结论本来也相同）。
- `occurrence`：同一条目在本份报告里第几次被选中（从 0 开始）。循环槽位里同一条目被选中两次时，第二次自动换到下一个变体，避免一份报告里出现两段一模一样的话。
- 同一槽位内不同条目各自独立取模，不需要协调。
- 注意：给某条目增减变体会改变这条目的选择结果（老用户重看报告文字会变）。因此 approved 条目**只允许追加变体、不允许删除或调整顺序**；确需修改，退役旧条目（status=retired）并新建 id。系统只存订单、不存报告全文：订单记录 `texts_version`，重看时用同一版本素材库重新拼装（每个发布版本在 git 打 tag 保留），保证文字与首次一致（流年起始年、当前大运按**订单创建时间**计算，而不是重看的时间）。
- **变体选择不含订单号、支付信息或生成时间**（用户 2026-10-29 确认）：四柱 + 性别 + 是否有时辰相同的人，同一素材库版本下报告文字完全一样。

### 5.3 拼装
1. 按 report-sections.md §3 的章节、槽位顺序逐个执行 5.1、5.2。
2. 替换占位符。
3. 术语加注：按 glossary.yaml，对整份报告中每个术语的**首次出现**追加括号解释（如“七杀（对你形成压力、也推动你成长的力量）”）。加注只在正文段落中进行，不在表格、卡片标题、古籍原文中进行。
4. 追加槽位依据模板生成的“依据：……”。
5. 有 `quote` 的条目：原文单独成行，格式“> 原文 ——《出处》”，放在该段之后；一章最多 1 句。
6. 跑 R-CHECK 成品检查。
7. （可选）润色接口（report-sections.md §9），默认关闭。

---

## 6. 古籍引用规范

1. **可以引用**：古籍原文（公共领域），如《渊海子平》《三命通会》《滴天髓》原文、《子平真诠》原文、《穷通宝鉴》（《栏江网》）原文；以及清代及以前的注本原文（如任铁樵《滴天髓阐微》注）。
2. **不引用**：民国以后的评注（即使已过保护期，也不引用，避免版本与观点争议）；**现代白话译本、现代注释、网络解读一律不得照搬或改写式照搬**。素材里对原文的解释必须是作者自己的话，并且服务于本项目规则的口径。
3. 每句引用必须写出处到篇名（如《滴天髓·天干论》），并在 `quote.edition` 写明核对用的底本；`verified=true` 才能进入 approved。
4. 引用必须**与该条目触发条件一致**：不要引用隐含特定喜忌的句子（例：“甲木参天，脱胎要火”含“甲木喜火”之意，若挂在所有甲日主条目上，会与“忌火”的甲日主矛盾）。可以截取不含喜忌暗示的前半句，或把条目的 `asserts` 收紧。
5. 一句引用 ≤ 40 字；一章最多 1 句；全报告最多 5 句。
6. 引用只做“出处感”，不得用来加强吓人的语气（不引用“主夭”“主贫”之类断语）。

---

## 7. 素材 lint（入库前自动执行，任一不过即拒）

| 编号 | 检查 |
|---|---|
| L1 | schema 合法：必填字段齐全、id 唯一且符合正则、slot 存在于 report-sections.md §3 |
| L2 | `when` 只引用 §3 字段；必需槽位只引用其维度 + 修饰字段（§4.4） |
| L3 | 占位符只引用 §3 字段 |
| L4 | 禁用词表（report-sections.md §7）、疾病名词表、金融产品词表零命中（变体与 quote 都查） |
| L5 | 正文无 4 位数字年份；干支字面（`[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]`）只出现在 asserts 锁定该干支的条目里 |
| L6 | 五行字与“喜 / 用 / 有利 / 忌 / 节制 / 不利”在 8 字窗口内共现时，该五行必须被 asserts 锁定 |
| L7 | 正文出现“时柱 / 时干 / 时支 / 出生时辰”的条目必须 `requires_hour: true` |
| L8 | 每个变体字数在 `length` 区间内；变体个数 2–3（兜底、固定文本除外） |
| L9 | 正文不含“依据：”；glossary 术语后面不得紧跟全角括号（无论括号里写解释、五行还是百分比），否则与自动加注冲突。要说明术语对应的五行，用“印星对应的五行是{el.印}”这类句式 |
| L10 | 同槽位任两条素材的变体之间 4-gram Jaccard ≤ 0.6；同条目变体之间 ≤ 0.6（变体要真的不同） |
| L11 | approved 条目：reviewer 非空；有 quote 时 verified=true 且 edition 非空 |
| L12 | 绝对化用语（一定、必然、注定、肯定会）零命中；第二人称用“你”，不出现“您”“命主”“大师” |

---

## 8. 术语加注表（glossary.yaml，示例）

```yaml
- term: 日主
  note: 你出生那天的天干，代表你自己
- term: 比劫
  note: 和你同类、能帮你的力量
- term: 印星
  note: 生扶你、给你支持的力量
- term: 食伤
  note: 你向外输出的才华与表达
- term: 财星
  note: 你能掌握和运用的资源
- term: 官杀
  note: 外部的规则、要求与压力，也是推动力
- term: 七杀
  note: 力度较强的压力与挑战，也逼你成长
- term: 用神
  note: 对你最有帮助的五行
- term: 喜神
  note: 次一级、同样有利的五行
- term: 忌神
  note: 过多时容易让你失衡、需要节制的五行
- term: 调候
  note: 按出生季节的冷暖做的调整
- term: 通关
  note: 用第三种五行化解两种力量的对立
- term: 大运
  note: 每十年一段的整体运势背景
- term: 流年
  note: 某一年的运势
```
只收两字及以上的术语；匹配按最长优先；加注不进入引号、括号、表格、古籍原文内部。

---

## 9. 审核状态

| 状态 | 含义 | 能否上生产 |
|---|---|---|
| draft | 作者写完，未审 | 否（仅开发预览） |
| reviewed（已审） | lint 全过、mingli-expert 已按清单自审 | 否（预览环境可用） |
| approved（已批准） | 所在批次经用户抽检通过 | 是 |
| retired | 退役，保留 id 不再使用 | 否 |

### 9.1 审核流程（用户 2026-10-29 确认）
1. **起草**：mingli-expert 按批次起草素材，状态 draft。
2. **自动检查**：跑 §7 全部 lint 和 report-sections.md §5 覆盖率测试（静态穷举 + cases.json 拼装）。任一不过就修改，不得带缺陷进入下一步。
3. **自审 → 已审**：mingli-expert 按 report-sections.md §10 清单逐条自审，通过后把本批条目改为 `reviewed`，`reviewer` 暂填 `mingli-expert`，并提交批次说明：条目数、覆盖的槽位与组合、lint/覆盖率结果、有争议的写法。
4. **用户抽检**：用户从本批随机抽 **10%**（向上取整，至少 5 条）。抽样由脚本按固定种子（批次号）生成清单，保证可复现；抽中的条目连同 cases.json 中能触发它的案例一起给用户看。
5. **批量批准**：抽检全部通过 → 本批全部条目批量改为 `approved`，`reviewer` 记为“用户（批次号、抽检日期）”。
   抽检有任何一条不通过 → 整批退回 `draft`；mingli-expert 修改后从第 2 步重来，下一次抽检**换样本**，并且必须包含上次不通过的条目。
6. 只有 `approved` 条目进入生产。批次号写在条目的 `notes` 或单独的批次清单文件（`texts/batches.yaml`）里。

### 9.2 批次计划
| 批次 | 范围 | 估算条目 | 状态 |
|---|---|---|---|
| 第 1 批 | 第 1、2、6 章（含这三章的兜底条目） | 约 260 | **待开始**（本轮只写了规范和 10 条样板，样板会并入第 1 批重新走流程） |
| 第 2 批 | 第 3、5、7 章 | 约 180 | 未开始 |
| 第 3 批 | 第 4 章、免费页模板、第 8 章固定文本、其余兜底 | 约 60 | 未开始 |

### 9.3 已批准条目的修改
approved 条目修改正文 = 退役 + 新建（见 §5.2），新建条目从 draft 重新走 9.1；只追加变体时可保持 approved，但新变体要单独走一次第 2–5 步（抽检时新变体必抽）。

---

## 10. 与润色接口的约定

- 素材的 `polish_allowed` 只能在槽位允许的前提下关闭，不能打开槽位禁止的润色。
- 有 quote 的条目，quote 永远不送润色。
- 润色结果不回写素材库；素材库永远是唯一的权威文本。

---

## 11. 本轮样板

- `ch01_strength.yaml`：第 1 章 5 条（CH1-DAYMASTER 乙、戊；CH1-BALANCE 得令却身弱、兜底；CH1-CONCLUSION 身弱）。
- `ch02_yongshen.yaml`：第 2 章 5 条（CH2-METHOD 杀重用印、比劫重用食伤、从财；CH2-SWAP 通用；CH2-TIAOHOU 冬季调候一致）。
- 全部为 `status: draft`，引用的古籍原文 `verified: false`，上线前需逐字对照底本。
- 可以拿 cases.json 的 C01（得令却身弱、冬季调候一致、戊日主）、C12（杀重、用神缺位互换）、C14（从财）、C04/C05（比劫重用食伤、乙日主）做拼装联调。
