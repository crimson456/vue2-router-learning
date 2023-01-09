/* @flow */

import type Router from '../index'
import { History } from './base'
import { cleanPath } from '../util/path'
import { START } from '../util/route'
import { setupScroll, handleScroll } from '../util/scroll'
import { pushState, replaceState, supportsPushState } from '../util/push-state'

export class HTML5History extends History {
  _startLocation: string

  constructor (router: Router, base: ?string) {
    super(router, base)
    // 获取基础路径
    this._startLocation = getLocation(this.base)
  }

  // 设置监视路由改变的处理函数 主要是 前进、后退键、修改地址栏地址触发
  setupListeners () {
    if (this.listeners.length > 0) {
      return
    }

    const router = this.router
    const expectScroll = router.options.scrollBehavior
    const supportsScroll = supportsPushState && expectScroll

    if (supportsScroll) {
      this.listeners.push(setupScroll())
    }

    const handleRoutingEvent = () => {
      const current = this.current

      // Avoiding first `popstate` event dispatched in some browsers but first
      // history route not updated since async guard at the same time.
      const location = getLocation(this.base)
      // 某些浏览器的第一次pospstate事件触发但是第一次用异步守卫的历史记录的路由不会更新
      if (this.current === START && location === this._startLocation) {
        return
      }

      this.transitionTo(location, route => {
        // 处理滚动
        if (supportsScroll) {
          handleScroll(router, route, current, true)
        }
      })
    }
    // 添加事件
    window.addEventListener('popstate', handleRoutingEvent)
    // 将取消事件的执行函数放入listeners字段上
    this.listeners.push(() => {
      window.removeEventListener('popstate', handleRoutingEvent)
    })
  }

  // 调用history API处理前进后退
  go (n: number) {
    window.history.go(n)
  }

  // 跳转路由，推入新地址
  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(location, route => {
      pushState(cleanPath(this.base + route.fullPath))
      handleScroll(this.router, route, fromRoute, false)
      onComplete && onComplete(route)
    }, onAbort)
  }

  // 跳转路由，更改新地址
  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(location, route => {
      replaceState(cleanPath(this.base + route.fullPath))
      handleScroll(this.router, route, fromRoute, false)
      onComplete && onComplete(route)
    }, onAbort)
  }

  // 获取当前的地址栏路径并修改状态
  ensureURL (push?: boolean) {
    // 判断原因：同hash模式一样
    if (getLocation(this.base) !== this.current.fullPath) {
      const current = cleanPath(this.base + this.current.fullPath)
      push ? pushState(current) : replaceState(current)
    }
  }

  // 对于history模式，当前地址为去掉基础路径的路径
  getCurrentLocation (): string {
    return getLocation(this.base)
  }
}

// 返回去掉基础路径的路径拼接上query参数和hash值的路径
export function getLocation (base: string): string {
  // 将当前的路径截取掉前面的基础路径部分
  let path = window.location.pathname
  const pathLowerCase = path.toLowerCase()
  const baseLowerCase = base.toLowerCase()
  // base="/a" shouldn't turn path="/app" into "/a/pp"
  // https://github.com/vuejs/vue-router/issues/3555
  // so we ensure the trailing slash in the base
  if (base && ((pathLowerCase === baseLowerCase) ||
    (pathLowerCase.indexOf(cleanPath(baseLowerCase + '/')) === 0))) {
    path = path.slice(base.length)
  }
  // 此处返回的是去掉基础路径的路径拼接上query参数和hash值
  return (path || '/') + window.location.search + window.location.hash
}
