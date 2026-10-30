/**
 * 规则版本 rulesVersion（ARCHITECTURE §4.2：rules/ 下规则文件内容的 SHA-256 前 8 位，写进报告第 8 章）。
 *
 * - 参与计算的「规则文件」= RULES_FILES：rules/ 根目录下除 README.md 外的全部 .md（即定义 CAL / S / Y / SS / R 编号的 5 份文件）。
 *   不含 README.md（目录说明）、cases.json（测试案例，不改变任何规则）、texts/（素材库另有 textsVersion）。
 * - 算法：文件按文件名升序，依次拼接 `文件名 + "\0" + 内容（换行统一为 \n） + "\0"` 的 UTF-8 字节，取 SHA-256 十六进制前 8 位。
 * - core 不做文件 IO，这里只保存结果常量；test/rules-params.test.ts 读取 rules/ 实时计算并与常量比对。
 *   rules/ 任一规则文件改动后测试失败，需按 rules/README.md 重跑 cases.json、记录结论变化后再更新本常量
 *   （失败信息会给出新值）。
 */
export const RULES_FILES = [
  'calendar.md',
  'report-sections.md',
  'shensha.md',
  'strength.md',
  'yongshen.md',
] as const;

export const RULES_VERSION = 'bd813c69';
