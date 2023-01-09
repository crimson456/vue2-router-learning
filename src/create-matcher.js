/* @flow */

import type VueRouter from './index'
import { resolvePath } from './util/path'
import { assert, warn } from './util/warn'
import { createRoute } from './util/route'
import { fillParams } from './util/params'
import { createRouteMap } from './create-route-map'
import { normalizeLocation } from './util/location'
import { decode } from './util/query'

export type Matcher = {
  match: (raw: RawLocation, current?: Route, redirectedFrom?: Location) => Route;
  addRoutes: (routes: Array<RouteConfig>) => void;
  addRoute: (parentNameOrRoute: string | RouteConfig, route?: RouteConfig) => void;
  getRoutes: () => Array<RouteRecord>;
};

export function createMatcher (
  routes: Array<RouteConfig>,
  router: VueRouter
): Matcher {
  // 闭包保存这三个对象
  // pathList为路径数组
  // pathMap为所有路径的{path：record,...}对象
  // nameMap为命名路由的{name：record,...}对象
  const { pathList, pathMap, nameMap } = createRouteMap(routes)

  // 将新的路由规则添加到记录中
  function addRoutes (routes) {
    // 重复调用createRouteMap()相同路径的路由不会再进行处理
    createRouteMap(routes, pathList, pathMap, nameMap)
  }

  // 添加单条路由规则到记录中
  function addRoute (parentOrRoute, route) {
    // 查询父命名路由的记录
    const parent = (typeof parentOrRoute !== 'object') ? nameMap[parentOrRoute] : undefined
    // $flow-disable-line
    // 添加路由
    createRouteMap([route || parentOrRoute], pathList, pathMap, nameMap, parent)

    // add aliases of parent
    // 处理父路由存在别名的情况：以父路由为路径，子路由为当前路由调用createRouteMap，对应别名已经创建过记录不会重新创建，直接进入子路由记录的创建
    if (parent && parent.alias.length) {
      createRouteMap(
        // $flow-disable-line route is defined if parent is
        parent.alias.map(alias => ({ path: alias, children: [route] })),
        pathList,
        pathMap,
        nameMap,
        parent
      )
    }
  }

  // 返回所有路由记录
  function getRoutes () {
    return pathList.map(path => pathMap[path])
  }

  // 目前结果是返回一个route
  function match (
    raw: RawLocation,                              //可以为路径字符串，也可以是一个Location对象
    currentRoute?: Route,                          
    redirectedFrom?: Location                      
  ): Route {
    // 根据当前路径，解析出raw中的真实路径、query参数和hash值
    const location = normalizeLocation(raw, currentRoute, false, router)
    const { name } = location

    // 定位中存在name字段，匹配的是命名路由，其中主要做的是params参数拼接入路径
    if (name) {
      const record = nameMap[name]

      // 警告命名路由不存在
      if (process.env.NODE_ENV !== 'production') {
        warn(record, `Route with name '${name}' does not exist`)
      }
      // 创建并返回一个以空record创建的路由
      if (!record) return _createRoute(null, location)

      // 通过path-to-regexp库中的函数获取路由记录中param参数的名字的数组（动态路由参数名数组）
      const paramNames = record.regex.keys
        .filter(key => !key.optional)
        .map(key => key.name)

      // 传入的选项中的params参数如果不为则置为空对象
      if (typeof location.params !== 'object') {
        location.params = {}
      } 
      // 此处似乎是使用当前路由的params田中location中需要且没有的params ???
      if (currentRoute && typeof currentRoute.params === 'object') {
        for (const key in currentRoute.params) {
          if (!(key in location.params) && paramNames.indexOf(key) > -1) {
            location.params[key] = currentRoute.params[key]
          }
        }
      }
      // 用location中的params填充到命名路由记录下的path中的动态路由形成完整路径
      location.path = fillParams(record.path, location.params, `named route "${name}"`)
      // 创建route对象
      return _createRoute(record, location, redirectedFrom)
    } 
    // 通过路径匹配
    else if (location.path) {
      location.params = {}
      // 遍历pathMap中所有record记录，根据第一个匹配的记录创建路由
      for (let i = 0; i < pathList.length; i++) {
        const path = pathList[i]
        const record = pathMap[path]
        if (matchRoute(record.regex, location.path, location.params)) {
          return _createRoute(record, location, redirectedFrom)
        }
      }
    }
    // no match
    return _createRoute(null, location)
  }

  // 创建重定向的路由
  function redirect (
    record: RouteRecord,
    location: Location
  ): Route {
    const originalRedirect = record.redirect
    // 处理重定向的函数写法
    let redirect = typeof originalRedirect === 'function'
      ? originalRedirect(createRoute(record, location, null, router))
      : originalRedirect

    // 整理为对象形式
    if (typeof redirect === 'string') {
      redirect = { path: redirect }
    }

    // 处理重定向不存在或者为其他参数的情况
    if (!redirect || typeof redirect !== 'object') {
      if (process.env.NODE_ENV !== 'production') {
        warn(
          false, `invalid redirect option: ${JSON.stringify(redirect)}`
        )
      }
      return _createRoute(null, location)
    }

    const re: Object = redirect
    const { name, path } = re
    let { query, hash, params } = location
    query = re.hasOwnProperty('query') ? re.query : query
    hash = re.hasOwnProperty('hash') ? re.hash : hash
    params = re.hasOwnProperty('params') ? re.params : params

    // 命名匹配
    if (name) {
      // resolved named direct
      const targetRecord = nameMap[name]
      if (process.env.NODE_ENV !== 'production') {
        assert(targetRecord, `redirect failed: named route "${name}" not found.`)
      }
      return match({
        _normalized: true,
        name,
        query,
        hash,
        params
      }, undefined, location)
    } 
    // 路径匹配
    else if (path) {
      // 1. resolve relative redirect
      const rawPath = resolveRecordPath(path, record)
      // 2. resolve params
      const resolvedPath = fillParams(rawPath, params, `redirect route with path "${rawPath}"`)
      // 3. rematch with existing query and hash
      return match({
        _normalized: true,
        path: resolvedPath,
        query,
        hash
      }, undefined, location)
    } 
    // 匹配失败
    else {
      if (process.env.NODE_ENV !== 'production') {
        warn(false, `invalid redirect option: ${JSON.stringify(redirect)}`)
      }
      return _createRoute(null, location)
    }
  }

  // 创建别名的路由
  function alias (
    record: RouteRecord,
    location: Location,
    matchAs: string
  ): Route {
    const aliasedPath = fillParams(matchAs, location.params, `aliased route with path "${matchAs}"`)
    // 获得别名对应路径的路由
    const aliasedMatch = match({
      _normalized: true,
      path: aliasedPath
    })
    // 如果对应路径能匹配到
    // 以别名对应路由匹配到的路由记录来创建路由
    if (aliasedMatch) {
      const matched = aliasedMatch.matched
      const aliasedRecord = matched[matched.length - 1]
      location.params = aliasedMatch.params
      return _createRoute(aliasedRecord, location)
    }
    return _createRoute(null, location)
  }

  // _createRoute(null, location)
  // 创建路由的前项处理，处理重定向和别名
  function _createRoute (
    record: ?RouteRecord,
    location: Location,
    redirectedFrom?: Location
  ): Route {
    // 重定向的情况
    if (record && record.redirect) {
      return redirect(record, redirectedFrom || location)
    }
    // 别名的情况
    if (record && record.matchAs) {
      return alias(record, location, record.matchAs)
    }
    return createRoute(record, location, redirectedFrom, router)
  }

  return {
    match,
    addRoute,
    getRoutes,
    addRoutes
  }
}

// matchRoute(record.regex, location.path, location.params)
// 根据传入的路径正则和路径进行匹配，返回布尔值，并处理路径正则params参数 
// eg.   /user/:id   +   /user/123   --->   {id:123}
function matchRoute (
  regex: RouteRegExp,
  path: string,
  params: Object
): boolean {
  const m = path.match(regex)

  if (!m) {
    return false
  } else if (!params) {
    return true
  }

  for (let i = 1, len = m.length; i < len; ++i) {
    const key = regex.keys[i - 1]
    if (key) {
      // Fix #1994: using * with props: true generates a param named 0
      params[key.name || 'pathMatch'] = typeof m[i] === 'string' ? decode(m[i]) : m[i]
    }
  }

  return true
}

function resolveRecordPath (path: string, record: RouteRecord): string {
  return resolvePath(path, record.parent ? record.parent.path : '/', true)
}
