/* @flow */
// 不满足第一个参数的条件则抛出错误
export function assert (condition: any, message: string) {
  if (!condition) {
    throw new Error(`[vue-router] ${message}`)
  }
}
// 不满足第一个参数的条件则控制台警告
export function warn (condition: any, message: string) {
  if (!condition) {
    typeof console !== 'undefined' && console.warn(`[vue-router] ${message}`)
  }
}

