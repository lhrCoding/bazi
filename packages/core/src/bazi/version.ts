/**
 * 排盘引擎版本（ARCHITECTURE §3.4 第 7 条：同输入两次深度相等；engineVersion 不变时快照不变）。
 *
 * 规则：任何会改变 computeChart 输出的修改（字段增删、取值口径、依赖库升级导致的秒级差异等）都必须提升本版本号，
 * 并更新快照（test/__snapshots__/chart-snapshot.test.ts.snap）与版本摘要表（test/fixtures/engine-version-digests.json）。
 * 快照测试会检查「同一版本号对应同一份输出摘要」：只更新快照而不改版本号，测试仍然失败。
 *
 * 格式：主版本.次版本.修订号。破坏字段结构升主版本；口径修正（同输入结果可能不同）升次版本；
 * 仅修正展示字符串格式升修订号。
 */
export const ENGINE_VERSION = '1.0.0';
