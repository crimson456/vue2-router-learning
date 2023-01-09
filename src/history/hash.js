/* @flow */

import type Router from '../index'
import { History } from './base'
import { cleanPath } from '../util/path'
import { getLocation } from './html5'
import { setupScroll, handleScroll } from '../util/scroll'
import { pushState, replaceState, supportsPushState } from '../util/push-state'

export class HashHistory extends History {
  constructor (router: Router, base: ?string, fallback: boolean) {
    super(router, base)
    // check history fallback deeplinking
    // 如果是通过回退到hash模式的基础路径需要到此分支
    // 网上解释：IE9 下以 Hash 方式的 url 切换路由会使得整个页面进行刷新，后面的监听 hashchange 不会起作用，所以直接 return 跳出
    if (fallback && checkFallback(this.base)) {
      return
    }
    // 确保#后的hash值是以/开始
    ensureSlash()
  }

  // this is delayed until the app mounts
  // to avoid the hashchange listener being fired too early
  // 设置监视路由改变的处理函数 主要是 前进、后退键、修改地址栏地址触发
  setupListeners () {
    // 防止重复调用
    if (this.listeners.length > 0) {
      return
    }

    const router = this.router
    const expectScroll = router.options.scrollBehavior
    const supportsScroll = supportsPushState && expectScroll

    if (supportsScroll) {
      // setupScroll中会添加一个跳转的事件，当路由跳转时保存当前滚动值，并更新全局_key值，并返回此事件的移除函数
      this.listeners.push(setupScroll())
    }

    // 路由跳转的事件处理
    const handleRoutingEvent = () => {
      const current = this.current
      // hash值不以 / 开头则添加 / ，并直接返回 (似乎此时因为修改了hash值会以新的hash值重新触发此事件)
      if (!ensureSlash()) {
        return
      }
      // 以hash值为路径，处理跳转逻辑
      this.transitionTo(getHash(), route => {
        // 处理滚动
        if (supportsScroll) {
          handleScroll(this.router, route, current, true)
        }
        // pushstate降级处理，此处只会走调用window.location.replace的分支
        if (!supportsPushState) {
          replaceHash(route.fullPath)
        }
      })
    }
    const eventType = supportsPushState ? 'popstate' : 'hashchange'
    // 添加事件
    window.addEventListener( eventType, handleRoutingEvent )
    // 将取消事件的执行函数放入listeners字段上
    this.listeners.push(() => {
      window.removeEventListener(eventType, handleRoutingEvent)
    })
  }

  // 跳转路由，推入新hash
  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(
      location,
      route => {
        pushHash(route.fullPath)
        handleScroll(this.router, route, fromRoute, false)
        onComplete && onComplete(route)
      },
      onAbort
    )
  }

  // 跳转路由，更改hash
  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(
      location,
      route => {
        replaceHash(route.fullPath)
        handleScroll(this.router, route, fromRoute, false)
        onComplete && onComplete(route)
      },
      onAbort
    )
  }

  // 调用history API处理前进后退
  go (n: number) {
    window.history.go(n)
  }

  // 获取当前的地址栏路径并修改状态
  ensureURL (push?: boolean) {
    // 获取当前路由
    const current = this.current.fullPath
    // 对比的原因:开启页面时会重复触发和通过修改地址栏从而触发事件来改变路由时会重复触发
    if (getHash() !== current) {
      push ? pushHash(current) : replaceHash(current)
    }
  }

  // 对于hash模式，当前地址为不带#的hash值
  getCurrentLocation () {
    return getHash()
  }
}

// 替换对应的地址为hash值
function checkFallback (base) {
  // 获取当前路径
  const location = getLocation(base)
  // 如果当前地址为哈希值，则将跳转到为带有hash值地址
  if (!/^\/#/.test(location)) {
    window.location.replace(cleanPath(base + '/#' + location))
    return true
  }
}

// 处理hash值开头的 /
function ensureSlash (): boolean {
  // 获得hash值
  const path = getHash()
  // 如果hash值以 / 开头，则返回true
  if (path.charAt(0) === '/') {
    return true
  }
  // 如果hash值不以 / 开头
  // 则添加 / 后，重新调用 history API 重定向到添加 / 后的新地址
  replaceHash('/' + path)
  // 最后返回false
  return false
}

// 获取hash值(不包含#号)
// 通过window.location.href获取hash值的兼容处理
export function getHash (): string {
  // We can't use window.location.hash here because it's not
  // consistent across browsers - Firefox will pre-decode it!
  let href = window.location.href
  const index = href.indexOf('#')
  // empty path
  if (index < 0) return ''

  href = href.slice(index + 1)

  return href
}

// 将hash值拼接到原地址上得到完整路径
// 通过window.location.href的兼容处理
function getUrl (path) {
  const href = window.location.href
  const i = href.indexOf('#')
  const base = i >= 0 ? href.slice(0, i) : href
  return `${base}#${path}`
}

function pushHash (path) {
  if (supportsPushState) {
    pushState(getUrl(path))
  } else {
    window.location.hash = path
  }
}

// 重定向到添加了/的地址
function replaceHash (path) {
  if (supportsPushState) {
    replaceState(getUrl(path))
  } else {
    window.location.replace(getUrl(path))
  }
}
