/**
 * 中文词典：以中文原文作为 key，因此无需翻译映射。
 * 翻译函数在词典中找不到 key 时会原样返回 key，即中文原文。
 */
export const zh: Record<string, string> = {};
