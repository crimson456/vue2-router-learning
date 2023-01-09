/* @flow */

import type VueRouter from '../index'
import { parsePath, resolvePath } from './path'
import { resolveQuery } from './query'
import { fillParams } from './params'
import { warn } from './warn'
import { extend } from './misc'

// normalizeLocation(raw, currentRoute, false, router)
// 返回一个对象，包含解析后的path、query、hash
export function normalizeLocation (
  raw: RawLocation,                       //可以为路径字符串，也可以是一个Location对象
  current: ?Route,
  append: ?boolean,                       //跳转时是否将当前路径作为相对路径的基路径
  router: ?VueRouter
): Location {
  // 将raw处理为Location对象
  let next: Location = typeof raw === 'string' ? { path: raw } : raw
  // named target
  // 如果传入的Location对象已经处理过则直接沿用
  if (next._normalized) {
    return next
  } 
  // 如果如果传入的Location对象存在name字段，则深复制后使用 ???
  else if (next.name) {
    next = extend({}, raw)
    const params = next.params
    if (params && typeof params === 'object') {
      next.params = extend({}, params)
    }
    return next
  }

  // relative params
  // 如果传入的Location对象不存在path，且存在params且存在当前路由 ???
  if (!next.path && next.params && current) {
    next = extend({}, next)
    next._normalized = true
    const params: any = extend(extend({}, current.params), next.params)
    if (current.name) {
      next.name = current.name
      next.params = params
    } else if (current.matched.length) {
      const rawPath = current.matched[current.matched.length - 1].path
      next.path = fillParams(rawPath, params, `path ${current.path}`)
    } else if (process.env.NODE_ENV !== 'production') {
      warn(false, `relative params navigation requires a current route.`)
    }
    return next
  }

  // 将next中路径处理为{ path, query, hash }的路径对象
  const parsedPath = parsePath(next.path || '')
  // basePath为基础路径
  const basePath = (current && current.path) || '/'
  // 根据当前位置解析为绝对路径
  const path = parsedPath.path
    ? resolvePath(parsedPath.path, basePath, append || next.append)
    : basePath
  // 合并参数中给的query和路径中存在的query参数，参数中给定的优先级更高
  const query = resolveQuery( parsedPath.query, next.query, router && router.options.parseQuery )

  // 哈希值以Location对象中给定的hash值为主
  let hash = next.hash || parsedPath.hash
  // 首位添加 #
  if (hash && hash.charAt(0) !== '#') {
    hash = `#${hash}`
  }
  
  return {
    _normalized: true,
    path,
    query,
    hash
  }
}
