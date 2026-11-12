# HANDOFF —— 交接与待决事项

> 用途：换新的对话窗口时，Claude 先读本文件，就能接上进度。
> 维护：每完成一个阶段、或有新的待决事项 / 用户拍板后，更新本文件并提交。
> 最后更新：2026-11-12（E 阶段完成后，最新提交 `31f4722`）

---

## 1. 当前进度

| 阶段 | 任务 | 状态 |
|---|---|---|
| A 脚手架 | T01–T02 | ✅ |
| B 排盘引擎 | T03–T13 | ✅ |
| C 规则引擎 | T14–T21 | ✅ cases.json 20 个案例零差异 |
| D 素材库工具链 | T22–T26 | ✅ lint L1–L12、批次抽检 |
| E 拼装引擎 | T27–T38 | ✅ 能拼出完整 9 章报告；预览、覆盖率、发布流程就绪 |
| **F 出生信息与订单** | **T39–T42** | ⏸ **下一步。E 阶段已汇报，等用户确认后开始 T39** |
| G 免费流程（首页、结果页） | T43–T46 | 未开始 |
| H 支付 | T47–T52 | 未开始 |
| I 报告页 | T53–T58 | 未开始 |
| J 上线准备 | T59–T65 | 未开始 |

- 开发任务：38 / 65 完成（以 `docs/TASKS.md` 的勾选为准）。
- 素材：第 1 批（第 1、2、6 章）274 条，状态全部是 **draft**；第 2 批（第 3、5、7 章）、第 3 批（第 4 章、第 8 章、免费页、glossary、词表）**未写**。
- 用户 2026-11-11 问过「网站什么时候搭」，并确认**按原计划顺序**做（不提前做页面）。

---

## 2. 工作方式（用户定的规矩，必须遵守）

1. **红线：禁止多 agent / 子 agent**，全部在主会话里做（也写在 CLAUDE.md 和记忆里）。
2. **分段推进**：连续约 15 次工具调用或约 10 分钟就停下，汇报进度、剩余工作，问是否继续。原因：用户担心长时间无人值守运行有封号风险。
3. 每个任务单独一个 git commit。用户的裁定单独提交，不和代码混在一起。
4. **先在 TASKS.md 勾选任务，再跑全部测试，最后提交**。`rules-registry.test.ts` 会检查「已勾选的任务名下不能还挂着待实现的规则编号」。
5. 提交前全部检查必须看**退出码**，不要把结果接给 `head` / `grep` 再判断：
   `npm test`、`npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run texts:lint`。
6. 改代码优先用精确的 Edit。用 Python / sed 做字符串替换容易因 Prettier 改了排版而匹配失败，或误删代码，T35–T37 都出过这类问题。
7. 每个阶段结束必须停下汇报，等用户确认。
8. 规则或素材有歧义时，不自己定口径：写进本文件第 3 节或 `docs/QUESTIONS.md`，给出建议，等用户拍板。原先由 mingli-expert（命理专家）裁定的事，现在由用户拍板。
9. 涉及付费、生产环境、删除数据、打 git tag、对外发布的操作，先问用户。
10. 用中文沟通。

---

## 3. 待用户拍板的问题

> 拍板后：按决定落实 → 在本节把该条移到第 4 节「已拍板」并写明日期与结论 → 提交。

### D1 素材发布标准与「跨年重复段落」冲突（阻塞：第 1 批正式发布 `texts:release`）
- 背景：report-sections.md §5.1 要求发布时 R-CHECK 全部通过。用户 2026-10-30 决定变体公式不改，所以同一条素材跨年再次命中时，可能选到同一个变体，这会触发段落相似度（> 0.5）报警。第 1 批草稿约 95% 的报告会报。
- 选项：
  - (a) 给第 6 章高频条目（四领域、DO、WATCH、HEAD）补第 3 个变体，降低重复概率，这是素材作者原来的建议；
  - (b) 发布时把 SIMILARITY 降为警告，不阻断；
  - (c) 两者都做。
- Claude 建议：(c)。

### D2 第 8 章的代码文字待审定（阻塞：上线；不阻塞开发）
第 8 章正式固定文本（`ch08_fixed.yaml`）属于第 3 批素材，还没写。目前用下面这些代码常量（`packages/core/src/report/assemble.ts`）：
1. 免责声明 `DISCLAIMER`：「本报告是传统命理文化的参考与娱乐内容，不构成医疗、投资、法律或其他任何专业建议；重要决定请以现实情况和专业意见为准。」
2. 子时口径：「子时口径：采用早晚子时派，23:00–23:59 出生日柱仍按当天、时干按次日日干起。」
3. 真太阳时状态（三选一）：「本份报告已按你选择的出生地做了真太阳时校正。」／「本份报告未做真太阳时校正（未选择出生地），时辰按北京时间排定。」／「未提供出生时辰，本份报告按三柱分析，不涉及真太阳时校正。」
4. 「已知局限」现在原样取自 strength.md §8 前 4 条，是技术表述，如「不计合化、刑冲对力量的影响（v1）」。建议写第 3 批素材时改成白话。

### D3 CH4-NOTE 与禁用词「开运」冲突（阻塞：写第 3 批 CH4-NOTE）
- report-sections.md 要求 CH4-NOTE 写「不推荐购买开运物品」，但「开运」在禁用词表里，lint 和 R-CHECK 都会拦。
- 选项：(a) 白名单加「不推荐购买开运物品」；(b) 换说法，如「不推荐购买任何声称能改运的物品」。
- Claude 建议：(b)。

### D4 第 1 批素材自审与抽检的时机（阻塞：第 1 批批准 → CI 开始强制第 1、2、6 章覆盖率 → 第 1 批发布）
- 工具已就绪：`npm run texts:preview` 看成品；`npm run texts:batch -- sample B1` 生成抽检单，抽 28 条，附触发案例与原段落、覆盖率表。
- 流程（README §9.1）：Claude 按 report-sections.md §10 清单自审 → 改为 reviewed → sample → 用户抽检 → approve / reject。
- 待定：现在就做，还是等 F / G 阶段之后再做；是否先处理 D1 的补变体再抽检。

### D5 喜神 / 忌神槽位只写第一项（batches.yaml open_issue #7）
- report-sections.md 写「喜 1–2、忌 1–2」，但字段只有 `xi1_god` / `ji1_god`，第 1 批每槽只写第一项，完整列表用 `{yongshen.xi}` / `{yongshen.ji}` 带出。
- 若要写第二项，需新增 `xi2_god` / `ji2_god` 字段和第二次循环。Claude 建议 MVP 保持现状。

### D6 健康段不送润色（batches.yaml open_issue #8）
- report-sections.md §3 第 6 章表格写四领域润色「可」，§9 写健康段一律不送。代码和第 1 批都已按 §9 执行，CH6-HEALTH 不送润色。
- 待确认后，把 §3 表格里 CH6-HEALTH 改为「否」，需同步 `slots.ts` 与 RULES_VERSION。Claude 建议确认。

### D7 L6 是否把 `when` 中的锁定视同 asserts（batches.yaml open_issue #5）
- 作者希望「`when` 里 `day.element eq 木`」也算锁定了「木」，否则第 1 批 25 条 CH1-MONTH 都要补 asserts。
- 现状：L6 只认 asserts，以及 `power_pct.<五行>` 断言；第 1 批在现行规则下已全部通过 lint，所以暂无影响。
- Claude 建议：同意作者的做法。`when` 成立本身就保证了这个事实，可以写进 README §7 L6。

### D8 网站改名（PRD 9.3，阻塞：U03 买域名、备案）
- 暂名「一元知命」已和 ¥9.9 定价不符，需要新名字和域名。

---

## 4. 已拍板（备查，最近的在前）

- 2026-11-12：README §8「通关」释义由「化解」改为「连接」；`texts:lint` 同时检查术语释义（T35）。
- 2026-11-11：第 1 批 6 个槽位字数下限放宽、新建白名单「不一定 / 一定的 / 一定强度」（T25）。
- 2026-11-11：Q5 新增 `wealth.*`、`dayun_summary.*` 字段（T28）。
- 2026-11-11：cases.json 15 处起运差异按代码值更新；calendar.md 口径 ①–④；QUESTIONS Q1–Q4 全部按当前实现（T21）。
- 2026-11-11：禁止多 agent、分段推进。
- 更早的决定见 `docs/QUESTIONS.md`、`rules/texts/batches.yaml` open_issues、各 rules/*.md 版本说明。

---

## 5. 用户的线下事项（TASKS.md U01–U09，进度 Claude 无法得知）

- **U01（最急）**：咨询微信支付、支付宝、备案服务商对「八字 / 传统文化分析」类目是否接受，以及是否需要经营性 ICP 许可证。这决定网站能不能收款。
- U02 营业执照 → U03 定名、域名、服务器、ICP 备案 → U04 服务号 → U05 微信商户号 → U06 支付宝 → U07 COS 存储桶 → U09 素材批次抽检。
- 新窗口里可以问一句用户进度。

---

## 6. 留到后面的技术债（已知、有计划）

| 事项 | 计划处理时间 |
|---|---|
| `scripts/` 不在 lint / typecheck 范围内（只有被测试引用的部分才会被类型检查） | T63 CI 门禁完善 |
| `scripts/` 引用了 `packages/core/test/helpers/cases.ts` 的 `toBirthInput` | T63 时移到共享位置 |
| `apps/web/server/texts-store.ts` 的 `initTextsStoreOrExit` 未接入 Next 启动流程（现在没有发布快照，接入后生产无法启动） | T53 报告 API |
| 第 5 章依据需要的起运信息已在 ctx（`qiyun`）；第 3、4、5、7、8 章素材未写，报告这些章节为空或为测试素材 | 素材第 2、3 批（K09–K15） |
| `glossary.yaml`、`wordlists/{forbidden,disease,finance}.txt` 未建，暂用 README §8 示例和 report-sections.md §7 禁用词表 | K01 |
| README §4.1 尚未写明 `contains` 可匹配对象（代码已支持，CH6-REL 在用） | 随下次改 README |
| npm audit 提示 8 个 moderate（项目原有依赖，非 yaml / tsx / noble） | J 阶段上线前 |

---

## 7. 常用命令

```
npm test / npm run typecheck / npm run lint / npm run format:check   # 提交前必跑，看退出码
npm run texts:lint        # 素材 L1–L12
npm run texts:coverage    # 静态覆盖率（缺口清单）
npm run texts:sample      # 动态抽样 10,000 + 字数分布（约 80 秒）
npm run texts:preview     # 生成 preview/index.html（不提交）
npm run texts:batch -- sample|approve|reject B1 [--fail id,…]
npm run texts:release [--dry-run]   # 只收 approved；不会自动打 tag
```
