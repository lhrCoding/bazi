# packages/core/test/fixtures 约定

测试专用的静态数据，只给 `packages/core/test/` 下的测试读取，**不被 `src/` 引用、不进入产物**。

## 目录

| 目录 | 用途 | 引入任务 |
| --- | --- | --- |
| `texts/` | 引擎测试专用小素材库（含 rules/texts 的样板），不依赖正式素材进度 | T22 起 |
| `examples/` | 测试基础设施自身的示例数据（T02） | T02 |
| `hko-solar-terms/` | 香港天文台公布的节气时刻（权威抽查，来源见目录内 README） | T12 |
| 其他 | 按用途新建子目录，名字用小写 + 连字符，如 `diff-samples/` | 按需 |

## 规则

1. **只读、确定性**：fixture 一经提交即视为不可变输入；测试不得在运行时写入或修改 fixtures 目录。需要临时文件用系统临时目录。
2. **不复制 rules/**：`rules/cases.json`、`rules/*.md` 等由命理专家维护的文件，测试直接从仓库 `rules/` 读取（`helpers/fixtures.ts` 的 `readRulesFile`），不要拷贝到这里，以免漂移。只有「为测试裁剪或构造」的数据才放 fixtures。
3. **不放真实个人信息**：出生信息只用 cases.json 里的公开案例或明显虚构的值；不放任何密钥。
4. **格式**：JSON / YAML / 纯文本，UTF-8、LF 换行。每个子目录如数据来源不明显，附一个 `README.md` 说明来源与用途。
5. **读取方式**：统一用 `test/helpers/fixtures.ts` 的 `fixturePath` / `readFixtureText` / `readFixtureJson`，路径相对 `test/fixtures/`，不要在测试里手写 `__dirname` 拼路径。
6. **Node IO 只在测试中出现**：`src/` 仍禁止 `node:*`（ESLint 边界规则）；`test/` 与 `vitest.config.ts` 允许使用 Node 内置模块读取 fixture。
