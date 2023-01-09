/* @flow */

import Regexp from 'path-to-regexp'
import { cleanPath } from './util/path'
import { assert, warn } from './util/warn'

// 初始化时：   createRouteMap(routes)
// 添加路由时： createRouteMap(routes, pathList, pathMap, nameMap)
// createRouteMap([route || parentOrRoute], pathList, pathMap, nameMap, parent)
// createRouteMap( parent.alias.map(alias => ({ path: alias, children: [route] })),
//  pathList, pathMap, nameMap, parent)

export function createRouteMap (
  routes: Array<RouteConfig>,
  oldPathList?: Array<string>,
  oldPathMap?: Dictionary<RouteRecord>,
  oldNameMap?: Dictionary<RouteRecord>,
  parentRoute?: RouteRecord
): {
  pathList: Array<string>,
  pathMap: Dictionary<RouteRecord>,
  nameMap: Dictionary<RouteRecord>
} {
  // 传入旧的路由记录时沿用旧的
  // the path list is used to control path matching priority
  // pathList存放所有路由的路径的数组
  const pathList: Array<string> = oldPathList || []
  // pathMap存放所有路由的记录
  const pathMap: Dictionary<RouteRecord> = oldPathMap || Object.create(null)
  // nameMap用于存放所有命名路由
  const nameMap: Dictionary<RouteRecord> = oldNameMap || Object.create(null)

  routes.forEach(route => {
    addRouteRecord(pathList, pathMap, nameMap, route, parentRoute)
  })

  // ensure wildcard routes are always at the end
  // 存在通配符路由*的情况，放到队列的末尾
  for (let i = 0, l = pathList.length; i < l; i++) {
    if (pathList[i] === '*') {
      pathList.push(pathList.splice(i, 1)[0])
      l--
      i--
    }
  }

  // 警告路由没有以/开头的
  if (process.env.NODE_ENV === 'development') {
    // warn if routes do not include leading slashes
    const found = pathList
    // check for missing leading slash
      .filter(path => path && path.charAt(0) !== '*' && path.charAt(0) !== '/')

    if (found.length > 0) {
      const pathNames = found.map(path => `- ${path}`).join('\n')
      warn(false, `Non-nested routes must include a leading slash character. Fix the following routes: \n${pathNames}`)
    }
  }

  return {
    pathList,
    pathMap,
    nameMap
  }
}

// 初始化时：addRouteRecord([], [], [], route, undefined)
// 添加子路由时：addRouteRecord(pathList, pathMap, nameMap, child, record, childMatchAs)
// 命名路由时：addRouteRecord( pathList, pathMap, nameMap, aliasRoute, parent, record.path || '/')
function addRouteRecord (
  pathList: Array<string>,
  pathMap: Dictionary<RouteRecord>,
  nameMap: Dictionary<RouteRecord>,
  route: RouteConfig,
  parent?: RouteRecord,
  matchAs?: string
) {
  const { path, name } = route
  // 检查单条route的路径和组件
  if (process.env.NODE_ENV !== 'production') {
    // 不传入路径则报错
    assert(path != null, `"path" is required in a route configuration.`)
    // 组件为字符串则报错
    assert(
      typeof route.component !== 'string',
      `route config "component" for path: ${String(
        path || name
      )} cannot be a ` + `string id. Use an actual component instead.`
    )
    // 警告错误的路由路径
    warn(
      // eslint-disable-next-line no-control-regex
      !/[^\u0000-\u007F]+/.test(path),
      `Route with path "${path}" contains unencoded characters, make sure ` +
        `your path is correctly encoded before passing it to the router. Use ` +
        `encodeURI to encode static segments of your path.`
    )
  }
  // 编译正则的选项
  const pathToRegexpOptions: PathToRegexpOptions = route.pathToRegexpOptions || {}
  // 拼接父路由
  const normalizedPath = normalizePath(path, parent, pathToRegexpOptions.strict)

  // 将选项中的配置项加入正则匹配的配置项中
  if (typeof route.caseSensitive === 'boolean') {
    pathToRegexpOptions.sensitive = route.caseSensitive
  }

  // 创建单条路由的记录
  const record: RouteRecord = {
    path: normalizedPath,
    regex: compileRouteRegex(normalizedPath, pathToRegexpOptions),
    components: route.components || { default: route.component },
    // 别名可能是数组形式，表示多个别名
    alias: route.alias
      ? typeof route.alias === 'string'
        ? [route.alias]
        : route.alias
      : [],
    instances: {},
    enteredCbs: {},
    name,
    parent,
    matchAs,
    redirect: route.redirect,
    beforeEnter: route.beforeEnter,
    meta: route.meta || {},
    props:
      route.props == null
        ? {}
        : route.components
          ? route.props
          : { default: route.props }
  }

  if (route.children) {
    // Warn if route is named, does not redirect and has a default child route.
    // If users navigate to this route by name, the default child will
    // not be rendered (GH Issue #629)
    // 警告命名路由没有重定向且子路由存在空或者/的情况
    // 这种情况使用命名路由，默认的子路由不会被渲染
    if (process.env.NODE_ENV !== 'production') {
      if (
        route.name &&
        !route.redirect &&
        route.children.some(child => /^\/?$/.test(child.path))
      ) {
        warn(
          false,
          `Named Route '${route.name}' has a default child route. ` +
            `When navigating to this named route (:to="{name: '${
              route.name
            }'}"), ` +
            `the default child route will not be rendered. Remove the name from ` +
            `this route and use the name of the default child route for named ` +
            `links instead.`
        )
      }
    }
    // 
    route.children.forEach(child => {
      // matchAs为父路由别名的处理方式
      const childMatchAs = matchAs
        ? cleanPath(`${matchAs}/${child.path}`)
        : undefined
      // 对子节点递归调用
      addRouteRecord(pathList, pathMap, nameMap, child, record, childMatchAs)
    })
  }
  // 将路径存入pathList、记录存入pathMap
  // 重复的路径则舍弃
  if (!pathMap[record.path]) {
    pathList.push(record.path)
    pathMap[record.path] = record
  }

  // 处理别名，为别名也生成路由的记录
  if (route.alias !== undefined) {
    // 将别名处理为数组格式
    const aliases = Array.isArray(route.alias) ? route.alias : [route.alias]
    // 遍历每个别名
    for (let i = 0; i < aliases.length; ++i) {
      const alias = aliases[i]
      // 警告alias和path相同的无效写法
      if (process.env.NODE_ENV !== 'production' && alias === path) {
        warn(
          false,
          `Found an alias with the same value as the path: "${path}". You have to remove that alias. It will be ignored in development.`
        )
        // skip in dev to make it work
        continue
      }
      // 以别名为路径创建路由，用于生成记录
      const aliasRoute = {
        path: alias,
        children: route.children
      }
      // 递归调用，添加路由的记录，并将当前路由记录的路径作为新添加路由的matchAs字段前半部分
      addRouteRecord( pathList, pathMap, nameMap, aliasRoute, parent,
        record.path || '/' // matchAs
      )
    }
  }
  // 命名路由，存放到nameMap字段
  if (name) {
    if (!nameMap[name]) {
      nameMap[name] = record
    } 
    // 警告重名的情况
    else if (process.env.NODE_ENV !== 'production' && !matchAs) {
      warn(
        false,
        `Duplicate named routes definition: ` +
          `{ name: "${name}", path: "${record.path}" }`
      )
    }
  }
}

function compileRouteRegex (
  path: string,
  pathToRegexpOptions: PathToRegexpOptions
): RouteRegExp {
  const regex = Regexp(path, [], pathToRegexpOptions)
  if (process.env.NODE_ENV !== 'production') {
    const keys: any = Object.create(null)
    regex.keys.forEach(key => {
      warn(
        !keys[key.name],
        `Duplicate param keys in route with path: "${path}"`
      )
      keys[key.name] = true
    })
  }
  return regex
}

// 拼接父路由
function normalizePath (
  path: string,
  parent?: RouteRecord,
  strict?: boolean
): string {
  // 不是严格匹配则去掉末尾的/
  if (!strict) path = path.replace(/\/$/, '')
  // 如果以/开头，表示根路径，直接返回
  if (path[0] === '/') return path
  // 没有父路由也直接返回
  if (parent == null) return path
  // 拼接父路由路径
  return cleanPath(`${parent.path}/${path}`)
}
