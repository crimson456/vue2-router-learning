/* @flow */

import { createRoute, isSameRoute, isIncludedRoute } from '../util/route'
import { extend } from '../util/misc'
import { normalizeLocation } from '../util/location'
import { warn } from '../util/warn'

// work around weird flow bug
const toTypes: Array<Function> = [String, Object]
const eventTypes: Array<Function> = [String, Array]

const noop = () => {}

let warnedCustomSlot
let warnedTagProp
let warnedEventProp

export default {
  name: 'RouterLink',
  props: {
    to: {
      type: toTypes,
      required: true
    },
    tag: {
      type: String,
      default: 'a'
    },
    custom: Boolean,
    exact: Boolean,
    exactPath: Boolean,
    append: Boolean,
    replace: Boolean,
    activeClass: String,
    exactActiveClass: String,
    ariaCurrentValue: {
      type: String,
      default: 'page'
    },
    event: {
      type: eventTypes,
      default: 'click'
    }
  },
  render (h: Function) {
    const router = this.$router
    const current = this.$route
    // location对象，包含解析后的path、query、hash
    // route为新创建的路由
    // href完整的链接地址
    const { location, route, href } = router.resolve(
      this.to,
      current,
      this.append
    )

    const classes = {}
    // router-link标签活跃状态时的普通、精确类名
    const globalActiveClass = router.options.linkActiveClass
    const globalExactActiveClass = router.options.linkExactActiveClass
    // Support global empty active class
    const activeClassFallback = globalActiveClass == null ? 'router-link-active' : globalActiveClass
    const exactActiveClassFallback = globalExactActiveClass == null ? 'router-link-exact-active' : globalExactActiveClass
    const activeClass = this.activeClass == null ? activeClassFallback : this.activeClass
    const exactActiveClass = this.exactActiveClass == null ? exactActiveClassFallback : this.exactActiveClass

    const compareTarget = route.redirectedFrom
      ? createRoute(null, normalizeLocation(route.redirectedFrom), null, router)
      : route
    
    // class对象下添加对应类名的成员，成员值为布尔值，用于挂载在data.class下
    // 此处将判断如果对应路由是激活状态将设置的类名的成员置为true
    classes[exactActiveClass] = isSameRoute(current, compareTarget, this.exactPath)
    classes[activeClass] = this.exact || this.exactPath
      ? classes[exactActiveClass]
      : isIncludedRoute(current, compareTarget)

    const ariaCurrentValue = classes[exactActiveClass] ? this.ariaCurrentValue : null

    const handler = e => {
      // guardEvent函数的目的是处理：事件触发不能附带控制键，不能使用右键等等，且阻止默认行为
      if (guardEvent(e)) {
        // 根据replace字段选择跳转还是替换
        if (this.replace) {
          router.replace(location, noop)
        } else {
          router.push(location, noop)
        }
      }
    }

    // 这样写后面不是覆盖了吗，而且click事件一直存在
    // click点击事件不能附带控制键，不能使用右键等等，且阻止默认行为
    const on = { click: guardEvent }

    if (Array.isArray(this.event)) {
      this.event.forEach(e => {
        on[e] = handler
      })
    } else {
      on[this.event] = handler
    }

    const data: any = { class: classes }

    // 处理新语法v-slot作用域插槽
    const scopedSlot =
      !this.$scopedSlots.$hasNormal &&
      this.$scopedSlots.default &&
      this.$scopedSlots.default({
        href,
        route,
        navigate: handler,
        isActive: classes[activeClass],
        isExactActive: classes[exactActiveClass]
      })
    if (scopedSlot) {
      if (process.env.NODE_ENV !== 'production' && !this.custom) {
        !warnedCustomSlot && warn(false, 'In Vue Router 4, the v-slot API will by default wrap its content with an <a> element. Use the custom prop to remove this warning:\n<router-link v-slot="{ navigate, href }" custom></router-link>\n')
        warnedCustomSlot = true
      }
      if (scopedSlot.length === 1) {
        return scopedSlot[0]
      } else if (scopedSlot.length > 1 || !scopedSlot.length) {
        if (process.env.NODE_ENV !== 'production') {
          warn(
            false,
            `<router-link> with to="${
              this.to
            }" is trying to use a scoped slot but it didn't provide exactly one child. Wrapping the content with a span element.`
          )
        }
        return scopedSlot.length === 0 ? h() : h('span', {}, scopedSlot)
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      if ('tag' in this.$options.propsData && !warnedTagProp) {
        warn(
          false,
          `<router-link>'s tag prop is deprecated and has been removed in Vue Router 4. Use the v-slot API to remove this warning: https://next.router.vuejs.org/guide/migration/#removal-of-event-and-tag-props-in-router-link.`
        )
        warnedTagProp = true
      }
      if ('event' in this.$options.propsData && !warnedEventProp) {
        warn(
          false,
          `<router-link>'s event prop is deprecated and has been removed in Vue Router 4. Use the v-slot API to remove this warning: https://next.router.vuejs.org/guide/migration/#removal-of-event-and-tag-props-in-router-link.`
        )
        warnedEventProp = true
      }
    }

    // <a>标签直接将事件和属性绑定在标签上
    if (this.tag === 'a') {
      data.on = on
      data.attrs = { href, 'aria-current': ariaCurrentValue }
    } 
    // 其他标签
    else {
      // find the first <a> child and apply listener and href
      // 找到第一个子<a>标签，将事件和属性绑定在此标签上
      const a = findAnchor(this.$slots.default)
      if (a) {
        // in case the <a> is a static node
        a.isStatic = false
        const aData = (a.data = extend({}, a.data))
        aData.on = aData.on || {}
        // transform existing events in both objects into arrays so we can push later
        for (const event in aData.on) {
          const handler = aData.on[event]
          if (event in on) {
            aData.on[event] = Array.isArray(handler) ? handler : [handler]
          }
        }
        // append new listeners for router-link
        for (const event in on) {
          if (event in aData.on) {
            // on[event] is always a function
            aData.on[event].push(on[event])
          } else {
            aData.on[event] = handler
          }
        }

        const aAttrs = (a.data.attrs = extend({}, a.data.attrs))
        aAttrs.href = href
        aAttrs['aria-current'] = ariaCurrentValue
      } 
      // 没有子<a>标签，只绑定事件，不绑定href属性和aria-current属性
      else {
        // doesn't have <a> child, apply listener to self
        data.on = on
      }
    }
    // 根据标签创建节点
    return h(this.tag, data, this.$slots.default)
  }
}

export function guardEvent (e: any) {
  // don't redirect with control keys
  if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
  // don't redirect when preventDefault called
  if (e.defaultPrevented) return
  // don't redirect on right click
  if (e.button !== undefined && e.button !== 0) return
  // don't redirect if `target="_blank"`
  if (e.currentTarget && e.currentTarget.getAttribute) {
    const target = e.currentTarget.getAttribute('target')
    if (/\b_blank\b/i.test(target)) return
  }
  // this may be a Weex event which doesn't have this method
  if (e.preventDefault) {
    e.preventDefault()
  }
  return true
}

function findAnchor (children) {
  if (children) {
    let child
    for (let i = 0; i < children.length; i++) {
      child = children[i]
      if (child.tag === 'a') {
        return child
      }
      if (child.children && (child = findAnchor(child.children))) {
        return child
      }
    }
  }
}
