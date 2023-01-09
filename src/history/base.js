/* @flow */

import { _Vue } from '../install'
import type Router from '../index'
import { inBrowser } from '../util/dom'
import { runQueue } from '../util/async'
import { warn } from '../util/warn'
import { START, isSameRoute, handleRouteEntered } from '../util/route'
import {
  flatten,
  flatMapComponents,
  resolveAsyncComponents
} from '../util/resolve-components'
import {
  createNavigationDuplicatedError,
  createNavigationCancelledError,
  createNavigationRedirectedError,
  createNavigationAbortedError,
  isError,
  isNavigationFailure,
  NavigationFailureType
} from '../util/errors'
import { handleScroll } from '../util/scroll'

export class History {
  router: Router
  base: string
  current: Route
  pending: ?Route
  cb: (r: Route) => void
  ready: boolean
  readyCbs: Array<Function>
  readyErrorCbs: Array<Function>
  errorCbs: Array<Function>
  listeners: Array<Function>
  cleanupListeners: Function

  // implemented by sub-classes
  +go: (n: number) => void
  +push: (loc: RawLocation, onComplete?: Function, onAbort?: Function) => void
  +replace: (
    loc: RawLocation,
    onComplete?: Function,
    onAbort?: Function
  ) => void
  +ensureURL: (push?: boolean) => void
  +getCurrentLocation: () => string
  +setupListeners: Function

  constructor (router: Router, base: ?string) {
    this.router = router
    this.base = normalizeBase(base)
    // start with a route object that stands for "nowhere"
    this.current = START
    this.pending = null
    this.ready = false
    this.readyCbs = []
    this.readyErrorCbs = []
    this.errorCbs = []
    this.listeners = []
  }

  // 将传入的函数放入cb字段，cb字段中存入的函数会在更新路由的时候调用
  listen (cb: Function) {
    this.cb = cb
  }

  // 向readyCbs推入第一个参数函数，向readyErrorCbs推入第二个参数函数
  // 如果路由已经启动，则直接调用一个参数而不推入
  onReady (cb: Function, errorCb: ?Function) {
    if (this.ready) {
      cb()
    } else {
      this.readyCbs.push(cb)
      if (errorCb) {
        this.readyErrorCbs.push(errorCb)
      }
    }
  }

  // 向errorCbs数组推入
  onError (errorCb: Function) {
    this.errorCbs.push(errorCb)
  }

  // history.transitionTo( history.getCurrentLocation(), setupListeners, setupListeners )
  // 路由跳转主逻辑
  transitionTo (
    location: RawLocation,
    onComplete?: Function,
    onAbort?: Function
  ) {
    let route
    // catch redirect option https://github.com/vuejs/vue-router/issues/3201
    // 获取路由对象
    try {
      route = this.router.match(location, this.current)
    } catch (e) {
      this.errorCbs.forEach(cb => {
        cb(e)
      })
      // Exception should still be thrown
      throw e
    }
    const prev = this.current
    this.confirmTransition(
      route,
      // onComplete函数，异步调用了所有守卫函数后调用
      () => {
        // 将新路由对象挂载在history.current字段
        this.updateRoute(route)
        // 调用外部的onComplete函数
        onComplete && onComplete(route)
        // 修改url地址
        this.ensureURL()
        // 全局后置钩子，参数中不再有next
        this.router.afterHooks.forEach(hook => {
          hook && hook(route, prev)
        })

        // fire ready cbs once
        if (!this.ready) {
          this.ready = true
          this.readyCbs.forEach(cb => {
            cb(route)
          })
        }
      },
      err => {
        if (onAbort) {
          onAbort(err)
        }
        if (err && !this.ready) {
          // Initial redirection should not mark the history as ready yet
          // because it's triggered by the redirection instead
          // https://github.com/vuejs/vue-router/issues/3225
          // https://github.com/vuejs/vue-router/issues/3331
          if (!isNavigationFailure(err, NavigationFailureType.redirected) || prev !== START) {
            this.ready = true
            this.readyErrorCbs.forEach(cb => {
              cb(err)
            })
          }
        }
      }
    )
  }

  // 确认跳转  主要是守卫函数的执行，因为守卫函数中可能有各种跳转到别的路由或者阻止跳转的逻辑，所以此处是确认
  confirmTransition (route: Route, onComplete: Function, onAbort?: Function) {
    const current = this.current
    this.pending = route
    const abort = err => {
      // changed after adding errors with
      // https://github.com/vuejs/vue-router/pull/3047 before that change,
      // redirect and aborted navigation would produce an err == null
      if (!isNavigationFailure(err) && isError(err)) {
        if (this.errorCbs.length) {
          this.errorCbs.forEach(cb => {
            cb(err)
          })
        } else {
          if (process.env.NODE_ENV !== 'production') {
            warn(false, 'uncaught error during route navigation:')
          }
          console.error(err)
        }
      }
      onAbort && onAbort(err)
    }
    const lastRouteIndex = route.matched.length - 1
    const lastCurrentIndex = current.matched.length - 1
    // 匹配的路由相同的情况，则终止路由
    if (
      isSameRoute(route, current) &&
      // in the case the route map has been dynamically appended to
      lastRouteIndex === lastCurrentIndex &&
      route.matched[lastRouteIndex] === current.matched[lastCurrentIndex]
    ) {
      this.ensureURL()
      // 如果存在hash值，重新处理窗口滚动 ???
      if (route.hash) {
        handleScroll(this.router, current, route, false)
      }
      // 抛出错误并调用终止的回调 ???
      return abort(createNavigationDuplicatedError(current, route))
    }

    // 对比当前路由和将要跳转路由的matched数组，获取到需要跳转的路由记录
    // updated        需更新的记录，不需要替换        因为相当于子组件会变化，所以是需更新
    // activated      新生成的记录，需要替换
    // deactivated    消除的记录
    const { updated, deactivated, activated } = resolveQueue( this.current.matched, route.matched )

    // 用于存储守卫函数的队列，用于异步依次执行
    const queue: Array<?NavigationGuard> = [].concat(
      // in-component leave guards
      // 失活组件内的beforeRouteLeave守卫函数组成的数组
      extractLeaveGuards(deactivated),
      // global before hooks
      // 全局前置守卫beforeEach
      this.router.beforeHooks,
      // in-component update hooks
      // 需更新组件内的beforeRouteUpdate守卫函数组成的数组
      extractUpdateHooks(updated),
      // in-config enter guards
      // 路由独享守卫beforeEnter
      activated.map(m => m.beforeEnter),
      // async components
      // 解析新生成记录中异步路由组件
      resolveAsyncComponents(activated)
    )
    
    // 执行传入的守卫函数
    const iterator = (hook: NavigationGuard, next) => {
      if (this.pending !== route) {
        return abort(createNavigationCancelledError(current, route))
      }
      // 执行守卫函数
      try {
        // router.beforeEach((to, from, next) =>{       next(xxx) })
        // 前两个参数为两个相关路由，第三个参数为决定路由行为的函数
        hook(route, current, (to: any) => {
          // 对next函数调用中的参数进行处理
          // 如果为false，终止路由
          if (to === false) {
            // next(false) -> abort navigation, ensure current URL
            this.ensureURL(true)
            abort(createNavigationAbortedError(current, route))
          } 
          // 如果为错误对象，终止路由
          else if (isError(to)) {
            this.ensureURL(true)
            abort(to)
          } 
          // 如果是路由对象，终止路由并重定向
          else if (
            typeof to === 'string' ||
            (typeof to === 'object' &&
              (typeof to.path === 'string' || typeof to.name === 'string'))
          ) {
            // next('/') or next({ path: '/' }) -> redirect
            abort(createNavigationRedirectedError(current, route))
            if (typeof to === 'object' && to.replace) {
              this.replace(to)
            } else {
              this.push(to)
            }
          } 
          // 其他情况进入下一个守卫
          else {
            // confirm transition and pass on the value
            // 这里似乎可以不加形参 
            next(to)
          }
        })
      } catch (e) {
        abort(e)
      }
    }

    // 执行队列中所有的守卫函数，然后执行第三个参数的回调
    runQueue(queue, iterator, () => {
      // wait until async components are resolved before
      // extracting in-component enter guards
      // 前面所有守卫函数执行结束后，调用此回调，主要是为了等待异步组件解析完毕，再获取异步组件中钩子
      // 新生成组件内的beforeRouteEnter
      const enterGuards = extractEnterGuards(activated)
      // 全局解析守卫beforeResolve
      const queue = enterGuards.concat(this.router.resolveHooks)
      // 此处的queue为新增的两个守卫的执行函数的数组
      runQueue(queue, iterator, () => {
        if (this.pending !== route) {
          return abort(createNavigationCancelledError(current, route))
        }
        this.pending = null
        // 调用上一层传入的参数函数
        onComplete(route)
        // 此处似乎是调用beforeRouteEnter路由守卫中传入next()的函数
        if (this.router.app) {
          this.router.app.$nextTick(() => {
            handleRouteEntered(route)
          })
        }
      })
    })
  }

  // 更新当前路由
  updateRoute (route: Route) {
    // 更新当前路由
    this.current = route
    // 调用cb中的函数，触发了响应式
    this.cb && this.cb(route)
  }

  setupListeners () {
    // Default implementation is empty
  }

  teardown () {
    // clean up event listeners
    // https://github.com/vuejs/vue-router/issues/2341
    this.listeners.forEach(cleanupListener => {
      cleanupListener()
    })
    this.listeners = []

    // reset current history route
    // https://github.com/vuejs/vue-router/issues/3294
    this.current = START
    this.pending = null
  }
}

// 设置基础路径
function normalizeBase (base: ?string): string {
  // 没有用户设置的基础路径的默认设置
  if (!base) {
    // 浏览器中使用<base>标签的href属性去掉开头的通信协议或者 /
    if (inBrowser) {
      // respect <base> tag
      const baseEl = document.querySelector('base')
      base = (baseEl && baseEl.getAttribute('href')) || '/'
      // strip full URL origin
      base = base.replace(/^https?:\/\/[^\/]+/, '')
    } 
    // 其他环境默认使用 /
    else {
      base = '/'
    }
  }
  // make sure there's the starting slash
  // 确保用户设置的字符串前为 /，没有则添加
  if (base.charAt(0) !== '/') {
    base = '/' + base
  }
  // remove trailing slash
  // 去掉末尾的 /
  return base.replace(/\/$/, '')
}

// resolveQueue( this.current.matched, route.matched )
// 对比两个mathced数组，返回数组中不变的，新增的和减少的路由记录
function resolveQueue (
  current: Array<RouteRecord>,
  next: Array<RouteRecord>
): {
  updated: Array<RouteRecord>,
  activated: Array<RouteRecord>,
  deactivated: Array<RouteRecord>
} {
  let i
  const max = Math.max(current.length, next.length)
  for (i = 0; i < max; i++) {
    if (current[i] !== next[i]) {
      break
    }
  }
  return {
    updated: next.slice(0, i),
    activated: next.slice(i),
    deactivated: current.slice(i)
  }
}

// extractGuards(deactivated, 'beforeRouteLeave', bindGuard, true)
function extractGuards (
  records: Array<RouteRecord>,
  name: string,
  bind: Function,
  reverse?: boolean
): Array<?Function> {
  // fn( m.components[key], m.instances[key], m, key )
  // 此函数作用会调用路由记录数组中所有的视图组件，并执行第二个参数的函数
  // 传入的参数依次是，组件定义，组件实例，路由记录，视图(组件)名
  const guards = flatMapComponents(records, (def, instance, match, key) => {
    // 从组件的options上获取对应的守卫
    const guard = extractGuard(def, name)
    // 对每条守卫函数都调用第三个参数的函数
    // beforeRouteLeave和beforeRouteUpdate调用bindGuard
    if (guard) {
      return Array.isArray(guard)
        ? guard.map(guard => bind(guard, instance, match, key))
        : bind(guard, instance, match, key)
    }
  })
  // 调整正反向序
  return flatten(reverse ? guards.reverse() : guards)
}

// 返回组件构造函数options上的对应字段，用于提取守卫
function extractGuard (
  def: Object | Function,
  key: string
): NavigationGuard | Array<NavigationGuard> {
  if (typeof def !== 'function') {
    // extend now so that global mixins are applied.
    def = _Vue.extend(def)
  }
  return def.options[key]
}
// extractLeaveGuards(deactivated)
// 获取所有beforeRouteLeave守卫函数
function extractLeaveGuards (deactivated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(deactivated, 'beforeRouteLeave', bindGuard, true)
}

// 获取所有beforeRouteUpdate守卫函数
function extractUpdateHooks (updated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(updated, 'beforeRouteUpdate', bindGuard)
}

// 返回绑定实例的守卫函数
function bindGuard (guard: NavigationGuard, instance: ?_Vue): ?NavigationGuard {
  if (instance) {
    return function boundRouteGuard () {
      return guard.apply(instance, arguments)
    }
  }
}

// 获取所有beforeRouteEnter守卫函数，单独处理是特殊语法，需要将next(somefunction)函数中的传入的函数放到路由完成后执行
function extractEnterGuards (
  activated: Array<RouteRecord>
): Array<?Function> {
  return extractGuards(
    activated,
    'beforeRouteEnter',
    (guard, _, match, key) => {
      return bindEnterGuard(guard, match, key)
    }
  )
}

// 主要是包装beforeRouteEnter的守卫函数
function bindEnterGuard (
  guard: NavigationGuard,
  match: RouteRecord,
  key: string
): NavigationGuard {

  // 把 将next后传入的函数推入到enteredCbs的函数 作为参数传入守卫函数中调用
  // beforeRouteEnter守卫函数的执行会将next后传入的函数推入到enteredCbs
  return function routeEnterGuard (to, from, next) {
    return guard(to, from, cb => {
      if (typeof cb === 'function') {
        if (!match.enteredCbs[key]) {
          match.enteredCbs[key] = []
        }
        match.enteredCbs[key].push(cb)
      }
      next(cb)
    })
  }
}
