/* @flow */

import { install } from './install'
import { START } from './util/route'
import { assert, warn } from './util/warn'
import { inBrowser } from './util/dom'
import { cleanPath } from './util/path'
import { createMatcher } from './create-matcher'
import { normalizeLocation } from './util/location'
import { supportsPushState } from './util/push-state'
import { handleScroll } from './util/scroll'
import { isNavigationFailure, NavigationFailureType } from './util/errors'

import { HashHistory } from './history/hash'
import { HTML5History } from './history/html5'
import { AbstractHistory } from './history/abstract'

import type { Matcher } from './create-matcher'

export default class VueRouter {
  static install: () => void
  static version: string
  static isNavigationFailure: Function
  static NavigationFailureType: any
  static START_LOCATION: Route

  app: any
  apps: Array<any>
  ready: boolean
  readyCbs: Array<Function>
  options: RouterOptions
  mode: string
  history: HashHistory | HTML5History | AbstractHistory
  matcher: Matcher
  fallback: boolean
  beforeHooks: Array<?NavigationGuard>
  resolveHooks: Array<?NavigationGuard>
  afterHooks: Array<?AfterNavigationHook>

  constructor (options: RouterOptions = {}) {
    if (process.env.NODE_ENV !== 'production') {
      warn(this instanceof VueRouter, `Router must be called with the new operator.`)
    }
    this.app = null
    this.apps = []
    this.options = options
    this.beforeHooks = []
    this.resolveHooks = []
    this.afterHooks = []
    // 创建一个matcher
    this.matcher = createMatcher(options.routes || [], this)

    // 处理模式mode
    let mode = options.mode || 'hash'
    // 如果不支持html5的pushState事件的history模式，则为回退为hash模式
    this.fallback =
      mode === 'history' && !supportsPushState && options.fallback !== false
    if (this.fallback) {
      mode = 'hash'
    }
    
    if (!inBrowser) {
      mode = 'abstract'
    }
    this.mode = mode

    // 根据模式挂载不同history字段
    switch (mode) {
      case 'history':
        this.history = new HTML5History(this, options.base)
        break
      case 'hash':
        this.history = new HashHistory(this, options.base, this.fallback)
        break
      case 'abstract':
        this.history = new AbstractHistory(this, options.base)
        break
      default:
        if (process.env.NODE_ENV !== 'production') {
          assert(false, `invalid mode: ${mode}`)
        }
    }
  }

  // 调用matcher上的match方法，返回一个路由对象
  match (raw: RawLocation, current?: Route, redirectedFrom?: Location): Route {
    return this.matcher.match(raw, current, redirectedFrom)
  }

  // 获取当前路由
  get currentRoute (): ?Route {
    return this.history && this.history.current
  }

  // 初始化，跳转到初始路由位置，并开始监听地址变化
  init (app: any /* Vue component instance */) {
    // 提醒没有调用install方法的情况
    process.env.NODE_ENV !== 'production' &&
      assert(
        install.installed,
        `not installed. Make sure to call \`Vue.use(VueRouter)\` ` +
          `before creating root instance.`
      )

    this.apps.push(app)

    // set up app destroyed handler
    // https://github.com/vuejs/vue-router/issues/2639
    app.$once('hook:destroyed', () => {
      // clean out app from this.apps array once destroyed
      const index = this.apps.indexOf(app)
      if (index > -1) this.apps.splice(index, 1)
      // ensure we still have a main app or null if no apps
      // we do not release the router so it can be reused
      if (this.app === app) this.app = this.apps[0] || null

      if (!this.app) this.history.teardown()
    })

    // main app previously initialized
    // return as we don't need to set up new history listener
    if (this.app) {
      return
    }

    this.app = app

    const history = this.history

    if (history instanceof HTML5History || history instanceof HashHistory) {
      // 处理首屏的滚动
      const handleInitialScroll = routeOrError => {
        const from = history.current
        // scrollBehavior字段没有定义时，不会进行滚动处理
        const expectScroll = this.options.scrollBehavior
        const supportsScroll = supportsPushState && expectScroll

        if (supportsScroll && 'fullPath' in routeOrError) {
          // 处理滚动
          handleScroll(this, routeOrError, from, false)
        }
      }

      // 跳转和错误回调，开始对修改地址的事件监听
      const setupListeners = routeOrError => {
        // 监听路由变化
        history.setupListeners()
        // 处理首屏滚动
        handleInitialScroll(routeOrError)
      }
      // 跳转到初始路由，后两个参数为跳转后的回调和错误回调
      history.transitionTo( history.getCurrentLocation(), setupListeners, setupListeners )
    }

    // 将更新路由触发响应式的函数挂载在history.cb上
    history.listen(route => {
      this.apps.forEach(app => {
        app._route = route
      })
    })
  }

  // 创建全局beforeEach钩子，并返回移除钩子的函数
  beforeEach (fn: Function): Function {
    return registerHook(this.beforeHooks, fn)
  }

  // 创建全局beforeResolve钩子，并返回移除钩子的函数
  beforeResolve (fn: Function): Function {
    return registerHook(this.resolveHooks, fn)
  }

  // 创建全局afterEach钩子，并返回移除钩子的函数
  // 调用时机：执行完所有守卫(confirmTransition)后，在回调中修改完路由后执行
  afterEach (fn: Function): Function {
    return registerHook(this.afterHooks, fn)
  }

  // 调用history上onReady方法
  onReady (cb: Function, errorCb?: Function) {
    this.history.onReady(cb, errorCb)
  }

  // 调用history上onError方法
  onError (errorCb: Function) {
    this.history.onError(errorCb)
  }

  // 调用history上push方法
  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    // $flow-disable-line‘
    // 没有onComplete和onAbort回调时的降级处理
    if (!onComplete && !onAbort && typeof Promise !== 'undefined') {
      return new Promise((resolve, reject) => {
        this.history.push(location, resolve, reject)
      })
    } else {
      this.history.push(location, onComplete, onAbort)
    }
  }

  // 调用history上replace方法
  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    // $flow-disable-line
    // 没有onComplete和onAbort回调时的降级处理
    if (!onComplete && !onAbort && typeof Promise !== 'undefined') {
      return new Promise((resolve, reject) => {
        this.history.replace(location, resolve, reject)
      })
    } else {
      this.history.replace(location, onComplete, onAbort)
    }
  }

  // 调用history上的go方法
  go (n: number) {
    this.history.go(n)
  }

  // 后退1步
  back () {
    this.go(-1)
  }

  // 前进1步
  forward () {
    this.go(1)
  }

  // 获取路由对应的所有组件
  getMatchedComponents (to?: RawLocation | Route): Array<any> {
    // 获取to的路由对象，不存在则优先使用当前路由
    const route: any = to
      ? to.matched
        ? to
        : this.resolve(to).route
      : this.currentRoute
    if (!route) {
      return []
    }
    // 获取路由对象所对应的所有组件组成的数组
    return [].concat.apply(
      [],
      route.matched.map(m => {
        return Object.keys(m.components).map(key => {
          return m.components[key]
        })
      })
    )
  }

  // 解析跳转的路由和地址，返回一个对象
  resolve (
    to: RawLocation,
    current?: Route,
    append?: boolean
  ): {
    location: Location,
    route: Route,
    href: string,
    // for backwards compat
    normalizedTo: Location,
    resolved: Route
  } {
    current = current || this.history.current
    // 解析出location对象，包含解析后的path、query、hash
    const location = normalizeLocation(to, current, append, this)
    // 根据location对象，创建要跳转的路由
    const route = this.match(location, current)
    const fullPath = route.redirectedFrom || route.fullPath
    const base = this.history.base
    // href为完整的链接地址
    const href = createHref(base, fullPath, this.mode)
    return {
      location,
      route,
      href,
      // for backwards compat
      normalizedTo: location,
      resolved: route
    }
  }

  // 调用matcher上的getRoutes方法
  getRoutes () {
    return this.matcher.getRoutes()
  }

  // 调用matcher上的getRoute方法
  addRoute (parentOrRoute: string | RouteConfig, route?: RouteConfig) {
    this.matcher.addRoute(parentOrRoute, route)
    // 如果不是起始路由，则重新跳转到当前路由  ???似乎是添加路由后重新刷新
    if (this.history.current !== START) {
      this.history.transitionTo(this.history.getCurrentLocation())
    }
  }

  // 调用matcher上的getRoutes方法
  addRoutes (routes: Array<RouteConfig>) {
    // 警告弃用
    if (process.env.NODE_ENV !== 'production') {
      warn(false, 'router.addRoutes() is deprecated and has been removed in Vue Router 4. Use router.addRoute() instead.')
    }
    this.matcher.addRoutes(routes)
    // 如果不是起始路由，则重新跳转到当前路由  ???似乎是添加路由后重新刷新
    if (this.history.current !== START) {
      this.history.transitionTo(this.history.getCurrentLocation())
    }
  }
}

// 注册钩子，并返回移除钩子的函数
function registerHook (list: Array<any>, fn: Function): Function {
  list.push(fn)
  return () => {
    const i = list.indexOf(fn)
    if (i > -1) list.splice(i, 1)
  }
}

// 创建链接地址
function createHref (base: string, fullPath: string, mode) {
  var path = mode === 'hash' ? '#' + fullPath : fullPath
  return base ? cleanPath(base + '/' + path) : path
}

// We cannot remove this as it would be a breaking change
// 用于Vue.use(VueRouter)中挂载插件
VueRouter.install = install
VueRouter.version = '__VERSION__'
VueRouter.isNavigationFailure = isNavigationFailure
VueRouter.NavigationFailureType = NavigationFailureType
VueRouter.START_LOCATION = START

if (inBrowser && window.Vue) {
  window.Vue.use(VueRouter)
}
