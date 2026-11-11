/**
 * ③a 素材库运行时：schema、条件求值、字段字典、槽位注册表。
 * YAML 解析（./yaml）只给构建脚本与测试用，不从这里导出（运行时加载编译好的 JSON，T38）。
 */
export * from './fields';
export * from './schema';
