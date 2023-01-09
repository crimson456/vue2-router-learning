/* @flow */

import type Router from '../index'
import { assert } from './warn'
import { getStateKey, setStateKey } from './state-key'
import { extend } from './misc'

// 用于存储不同路由离开时的滑动位置
const positionStore = Object.create(null)

// 添加一个跳转的事件，当路由跳转时页面保存当前state的滚动值，并添加到下一个state的key值置为全局_key值
// 返回移除事件监听的函数
export function setupScroll () {
  // Prevent browser scroll behavior on History popstate
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual'
  }
  // Fix for #1585 for Firefox
  // Fix for #2195 Add optional third attribute to workaround a bug in safari https://bugs.webkit.org/show_bug.cgi?id=182678
  // Fix for #2774 Support for apps loaded from Windows file shares not mapped to network drives: replaced location.origin with
  // window.location.protocol + '//' + window.location.host
  // location.host contains the port and location.hostname doesn't
  const protocolAndPath = window.location.protocol + '//' + window.location.host
  const absolutePath = window.location.href.replace(protocolAndPath, '')
  // preserve existing history state as it could be overriden by the user
  // 设置state上的key值
  const stateCopy = extend({}, window.history.state)
  stateCopy.key = getStateKey()
  window.history.replaceState(stateCopy, '', absolutePath)
  window.addEventListener('popstate', handlePopState)
  return () => {
    window.removeEventListener('popstate', handlePopState)
  }
}

// 处理窗口滚动的位置
// 首次:handleScroll(this, routeOrError, from, false)
// 其他:handleScroll(this.router, route, current, true)
export function handleScroll (
  router: Router,
  to: Route,
  from: Route,
  isPop: boolean                //此参数用于处理是否使用存储在状态上对应key值的位置
) {
  // 根元素不存在则直接返回
  if (!router.app) {
    return
  }

  // 获取自定义的滚动函数
  const behavior = router.options.scrollBehavior
  if (!behavior) {
    return
  }

  // 警告定义不为函数
  if (process.env.NODE_ENV !== 'production') {
    assert(typeof behavior === 'function', `scrollBehavior must be a function`)
  }

  // wait until re-render finishes before scrolling
  // 在vue的nextTick中执行滚动的操作
  router.app.$nextTick(() => {
    // 获取当前_key值对应的滚动位置
    const position = getScrollPosition()
    // 调用自定义的滚动函数，获取到当前应该滚动到的位置或者一个promise对象用于异步滚动
    const shouldScroll = behavior.call(
      router,
      to,
      from,
      isPop ? position : null
    )
    
    // 不存在应该滚动到的位置直接返回
    if (!shouldScroll) {
      return
    }

    // promise对象异步滚动的情况
    if (typeof shouldScroll.then === 'function') {
      shouldScroll
        .then(shouldScroll => {
          // 滑动到对应位置
          scrollToPosition((shouldScroll: any), position)
        })
        .catch(err => {
          if (process.env.NODE_ENV !== 'production') {
            assert(false, err.toString())
          }
        })
    } 
    // 直接滚动的情况
    else {
      // 滑动到对应位置
      scrollToPosition(shouldScroll, position)
    }
  })
}

// 根据key值保存窗口的滑动位置
export function saveScrollPosition () {
  // 获取全局_key值
  const key = getStateKey()
  if (key) {
    positionStore[key] = {
      x: window.pageXOffset,
      y: window.pageYOffset
    }
  }
}

// 跳转路由时的事件处理：保存当前滚动位置、全局_key值更新
function handlePopState (e) {
  // 将通过全局_key值保存当前的滚动位置
  saveScrollPosition()
  // 将全局_key值置为新state上的key字段
  if (e.state && e.state.key) {
    setStateKey(e.state.key)
  }
}

// 获取当前_key值对应的滚动位置
function getScrollPosition (): ?Object {
  const key = getStateKey()
  if (key) {
    return positionStore[key]
  }
}

// 根据元素和偏移量计算出需要滑动到的坐标  (偏移量偏移的正方向是左上)
function getElementPosition (el: Element, offset: Object): Object {
  const docEl: any = document.documentElement
  const docRect = docEl.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  return {
    x: elRect.left - docRect.left - offset.x,
    y: elRect.top - docRect.top - offset.y
  }
}

// 是否为有效的需要滑动到的坐标:x,y任意一个为数字     比如只有x的情况也是可以验证通过的
function isValidPosition (obj: Object): boolean {
  return isNumber(obj.x) || isNumber(obj.y)
}

// 规范化需要滑动到的坐标，处理不是数字的情况     比如只写了x，填充y
function normalizePosition (obj: Object): Object {
  return {
    x: isNumber(obj.x) ? obj.x : window.pageXOffset,
    y: isNumber(obj.y) ? obj.y : window.pageYOffset
  }
}

// 规范化偏移量，处理不是数字的情况
function normalizeOffset (obj: Object): Object {
  return {
    x: isNumber(obj.x) ? obj.x : 0,
    y: isNumber(obj.y) ? obj.y : 0
  }
}

function isNumber (v: any): boolean {
  return typeof v === 'number'
}

const hashStartsWithNumberRE = /^#\d/

// 滑动到对应位置       （传入第二个position参数的意义：shouldScroll无效时，滑动到上一次离开时保存的位置）
function scrollToPosition (shouldScroll, position) {
  const isObject = typeof shouldScroll === 'object'
  // 存在锚点的情况
  if (isObject && typeof shouldScroll.selector === 'string') {
    // getElementById would still fail if the selector contains a more complicated query like #main[data-attr]
    // but at the same time, it doesn't make much sense to select an element with an id and an extra selector
    // 获取锚点元素，以 # + 数字 开头的选择器会直接使用getElementById
    const el = hashStartsWithNumberRE.test(shouldScroll.selector) // $flow-disable-line
      ? document.getElementById(shouldScroll.selector.slice(1)) // $flow-disable-line
      : document.querySelector(shouldScroll.selector)

    // 存在锚点元素
    if (el) {
      // 获取自定义的偏移量
      let offset =shouldScroll.offset && typeof shouldScroll.offset === 'object' ? shouldScroll.offset : {}
      // 规范化偏移量，处理不为数字的情况
      offset = normalizeOffset(offset)
      // 根据自定义的偏移量得到需要滑动到到的坐标
      position = getElementPosition(el, offset)
    } 
    // 不存在锚点元素，和普通情况相同
    else if (isValidPosition(shouldScroll)) {
      // 规范化需要滑动到到的坐标
      position = normalizePosition(shouldScroll)
    }
  } 
  // 不存在锚点的情况
  else if (isObject && isValidPosition(shouldScroll)) {
    // 规范化需要滑动到到的坐标
    position = normalizePosition(shouldScroll)
  }

  // 调用DOM滑动到对应位置
  if (position) {
    // $flow-disable-line
    if ('scrollBehavior' in document.documentElement.style) {
      window.scrollTo({
        left: position.x,
        top: position.y,
        // $flow-disable-line
        behavior: shouldScroll.behavior
      })
    } else {
      window.scrollTo(position.x, position.y)
    }
  }
}
