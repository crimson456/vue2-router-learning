/* @flow */

import { _Vue } from '../install'
import { warn } from './warn'
import { isError } from '../util/errors'

// 返回一个钩子用于解析路由记录数组中的异步组件
export function resolveAsyncComponents (matched: Array<RouteRecord>): Function {
  return (to, from, next) => {
    let hasAsync = false
    let pending = 0
    let error = null

    // 对路由记录中的每一个组件调用第二个函数
    flatMapComponents(matched, (def, _, match, key) => {
      // if it's a function and doesn't have cid attached,
      // assume it's an async component resolve function.
      // we are not using Vue's default async resolving mechanism because
      // we want to halt the navigation until the incoming component has been
      // resolved.
      // 判断是否为异步组件
      if (typeof def === 'function' && def.cid === undefined) {
        hasAsync = true
        pending++

        // 异步组件解析成功则调用此函数
        const resolve = once(resolvedDef => {
          if (isESModule(resolvedDef)) {
            resolvedDef = resolvedDef.default
          }
          // save resolved on async factory in case it's used elsewhere
          // 将解析成功后的组件挂载在构造函数的resolved字段上
          def.resolved = typeof resolvedDef === 'function'
            ? resolvedDef
            : _Vue.extend(resolvedDef)
          // 将解析成功后的组件挂载在路由记录视图的对应字段上
          match.components[key] = resolvedDef
          pending--
          if (pending <= 0) {
            next()
          }
        })

        // 异步组件解析失败则调用此函数
        const reject = once(reason => {
          const msg = `Failed to resolve async component ${key}: ${reason}`
          process.env.NODE_ENV !== 'production' && warn(false, msg)
          if (!error) {
            error = isError(reason)
              ? reason
              : new Error(msg)
            next(error)
          }
        })

        // 适配异步组件的几种写法，逻辑和vue2中基本相同
        let res
        try {
          res = def(resolve, reject)
        } catch (e) {
          reject(e)
        }
        if (res) {
          if (typeof res.then === 'function') {
            res.then(resolve, reject)
          } else {
            // new syntax in Vue 2.3
            const comp = res.component
            if (comp && typeof comp.then === 'function') {
              comp.then(resolve, reject)
            }
          }
        }
      }
    })

    if (!hasAsync) next()
  }
}

// 将路由记录数组的所有 视图组件 名 取出，并对每个组件名调用第二参数的函数，传入的参数依次是，组件定义，组件实例，路由记录，视图(组件)名
export function flatMapComponents (
  matched: Array<RouteRecord>,
  fn: Function
): Array<?Function> {
  return flatten(matched.map(m => {
    return Object.keys(m.components).map(key => fn( m.components[key], m.instances[key], m, key ))
  }))
}

// 扁平化二维数组
export function flatten (arr: Array<any>): Array<any> {
  return Array.prototype.concat.apply([], arr)
}

const hasSymbol =
  typeof Symbol === 'function' &&
  typeof Symbol.toStringTag === 'symbol'

function isESModule (obj) {
  return obj.__esModule || (hasSymbol && obj[Symbol.toStringTag] === 'Module')
}

// in Webpack 2, require.ensure now also returns a Promise
// so the resolve/reject functions may get called an extra time
// if the user uses an arrow function shorthand that happens to
// return that Promise.
function once (fn) {
  let called = false
  return function (...args) {
    if (called) return
    called = true
    return fn.apply(this, args)
  }
}
